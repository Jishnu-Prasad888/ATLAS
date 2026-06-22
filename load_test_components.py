#!/usr/bin/env python3
"""
System Load Tester
===================
A GUI tool for generating controllable CPU, RAM, and GPU load, so you can
test a monitoring/alerting setup.

How it works
------------
Each resource (CPU / RAM / GPU) has a slider and three HOLD buttons.
Nothing happens unless you are actively pressing a button:

  - HOLD: LOAD   -> applies the slider's target load while held.
  - HOLD: PULSE  -> slams that resource to 100% while held (sudden spike).
  - HOLD: STOP   -> forces that resource to 0% while held, even if LOAD
                     or PULSE is also being held (sudden drop).

Release every button for a resource and its load goes back to 0 - nothing
keeps running in the background for that resource.

All three panels (CPU/RAM/GPU) are always interactive. If GPU load
generation can't actually happen on this machine (no supported library
or no GPU found), the panel still works, but the status line tells you
exactly why nothing is moving, instead of just doing nothing silently.

Any worker error (allocation failure, GPU error, a worker process dying
unexpectedly, etc.) is shown in the on-screen "Errors / Status Log" panel
at the bottom of the window, not just printed to a console you might not
see.

Install dependencies
---------------------
    pip install psutil

For real GPU load generation, install ONE of these (script auto-detects
whichever is available, in this order):
    pip install torch --index-url https://download.pytorch.org/whl/cu121   # NVIDIA CUDA
    pip install pyopencl                                                   # NVIDIA / AMD / Intel

If neither is installed, or no GPU is found, GPU sliders/buttons still
work but the status line will tell you nothing is actually being loaded.

Notes / safety
---------------
- RAM load is capped at RAM_SAFETY_CAP percent of total system RAM to
  reduce (not eliminate) the risk of the OS killing this process or
  other programs for using too much memory. If that happens anyway,
  it'll show up in the Errors/Status log and the worker auto-restarts.
- This burns real CPU cycles / real RAM / real GPU cycles - it doesn't
  fake the numbers. Don't run PULSE on a machine you care about being
  responsive.
"""

import os
import sys
import time
import queue
import shutil
import subprocess
import multiprocessing as mp
import tkinter as tk
from tkinter import ttk, messagebox

# ---------------------------------------------------------------------------
# Required dependency check - show a real GUI error, not just a console print
# ---------------------------------------------------------------------------
try:
    import psutil
except ImportError:
    _root = tk.Tk()
    _root.withdraw()
    messagebox.showerror(
        "Missing dependency",
        "This script requires the 'psutil' package.\n\n"
        "Install it with:\n    pip install psutil",
    )
    sys.exit(1)

CYCLE_PERIOD = 0.1       # seconds; duty-cycle window used by load workers
TICK_MS = 100            # GUI refresh / target-recalculation rate (ms)
PULSE_LOAD_PERCENT = 100.0
RAM_SAFETY_CAP = 90.0    # never try to commit more than this % of total RAM
MIN_RESTART_INTERVAL = 2.0  # seconds between auto-restart attempts per worker


# ---------------------------------------------------------------------------
# GPU backend detection. IMPORTANT: this must only ever run in the real main
# process, and only ONCE, before any worker process exists. NVIDIA's CUDA /
# OpenCL driver does not support being touched in the parent and then used
# by a forked child - the child inherits a half-initialized handle and every
# GPU call fails with INVALID_DEVICE. So detection is wrapped in functions
# and only called from the `if __name__ == "__main__":` guard below, and we
# force the "spawn" start method so child processes never inherit any
# driver state from the parent in the first place.
# ---------------------------------------------------------------------------
GPU_BACKEND = None        # "torch" | "opencl" | None
GPU_BACKEND_DETAIL = ""   # human-readable detail / reason
PYNVML_AVAILABLE = False
NVIDIA_SMI_AVAILABLE = False


def detect_gpu_backend():
    backend = None
    detail = ""

    try:
        import torch
        if torch.cuda.is_available():
            backend = "torch"
            try:
                detail = f"Using torch/CUDA: {torch.cuda.get_device_name(0)}"
            except Exception:
                detail = "Using torch/CUDA backend"
    except Exception:
        pass

    if backend is None:
        try:
            import pyopencl as cl
            found_device = None
            for plat in cl.get_platforms():
                for dev in plat.get_devices():
                    if dev.type & cl.device_type.GPU:
                        found_device = dev
                        break
                if found_device:
                    break
            if found_device is not None:
                backend = "opencl"
                detail = f"Using OpenCL: {found_device.name.strip()}"
            else:
                detail = "pyopencl is installed but no GPU device was found on any OpenCL platform."
        except Exception:
            pass

    if backend is None and not detail:
        detail = (
            "No GPU backend found. Install 'torch' with CUDA (NVIDIA) or "
            "'pyopencl' (NVIDIA/AMD/Intel) to enable real GPU load generation."
        )

    return backend, detail


def detect_pynvml():
    """Display-only GPU usage readout. Separate from load generation."""
    try:
        import pynvml
        pynvml.nvmlInit()
        return True
    except Exception:
        return False


def detect_nvidia_smi():
    """Fallback display-only GPU usage readout, used if pynvml isn't installed."""
    return shutil.which("nvidia-smi") is not None


_last_smi_check = 0.0
_last_smi_text = "--"


def get_gpu_percent_text():
    global _last_smi_check, _last_smi_text

    if PYNVML_AVAILABLE:
        try:
            import pynvml
            handle = pynvml.nvmlDeviceGetHandleByIndex(0)
            util = pynvml.nvmlDeviceGetUtilizationRates(handle)
            return f"{util.gpu}%"
        except Exception:
            pass  # fall through to nvidia-smi below

    if NVIDIA_SMI_AVAILABLE:
        now = time.time()
        if now - _last_smi_check >= 1.0:  # throttle: nvidia-smi is a subprocess, don't spawn it 10x/sec
            _last_smi_check = now
            try:
                out = subprocess.run(
                    ["nvidia-smi", "--query-gpu=utilization.gpu",
                     "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, timeout=1.0,
                )
                if out.returncode == 0 and out.stdout.strip():
                    _last_smi_text = f"{out.stdout.strip().splitlines()[0].strip()}%"
                else:
                    _last_smi_text = "--"
            except Exception:
                _last_smi_text = "--"
        return _last_smi_text

    return "--"


# ---------------------------------------------------------------------------
# Worker processes - each runs in its own process so a sudden STOP shows up
# immediately, and so a crash in one doesn't take down the GUI.
# ---------------------------------------------------------------------------

def cpu_worker(target, stop_event, error_queue, worker_id):
    try:
        while not stop_event.is_set():
            pct = max(0.0, min(100.0, target.value)) / 100.0
            busy = CYCLE_PERIOD * pct
            idle = CYCLE_PERIOD - busy

            start = time.perf_counter()
            if busy > 0:
                x = 0.0001
                while time.perf_counter() - start < busy:
                    x = x * 1.0000001 + 1.0  # throwaway math, just to burn cycles
            if idle > 0:
                time.sleep(idle)
    except Exception as e:
        error_queue.put(f"CPU worker #{worker_id} error: {e}")


def ram_worker(target, stop_event, error_queue, total_bytes):
    page = 4096
    buf = bytearray(0)
    current_size = 0
    touch_pos = 0
    last_warn_time = 0.0

    try:
        while not stop_event.is_set():
            pct = max(0.0, min(RAM_SAFETY_CAP, target.value)) / 100.0
            desired_size = int(total_bytes * pct)

            if abs(desired_size - current_size) > total_bytes * 0.01:
                try:
                    buf = bytearray(desired_size)
                    current_size = desired_size
                    touch_pos = 0
                except MemoryError:
                    now = time.time()
                    if now - last_warn_time > 5.0:
                        error_queue.put(
                            f"RAM worker: could not allocate "
                            f"{desired_size / (1024**3):.1f} GB (MemoryError) - "
                            f"system may be low on memory."
                        )
                        last_warn_time = now

            if current_size > 0:
                end = min(touch_pos + 8 * 1024 * 1024, current_size)
                for i in range(touch_pos, end, page):
                    buf[i] = (buf[i] + 1) % 256
                touch_pos = end if end < current_size else 0

            time.sleep(0.05)
    except Exception as e:
        error_queue.put(f"RAM worker error: {e}")


def gpu_worker_torch(target, stop_event, error_queue):
    try:
        import torch
        device = torch.device("cuda")
        size = 2048
        a = torch.randn((size, size), device=device)
        b = torch.randn((size, size), device=device)

        while not stop_event.is_set():
            pct = max(0.0, min(100.0, target.value)) / 100.0
            busy = CYCLE_PERIOD * pct
            idle = CYCLE_PERIOD - busy

            start = time.perf_counter()
            if busy > 0:
                while time.perf_counter() - start < busy:
                    c = torch.matmul(a, b)
                torch.cuda.synchronize()
            if idle > 0:
                time.sleep(idle)
    except Exception as e:
        error_queue.put(f"GPU (torch/CUDA) worker error: {e}")


def gpu_worker_opencl(target, stop_event, error_queue):
    try:
        os.environ.setdefault("PYOPENCL_COMPILER_OUTPUT", "0")
        import pyopencl as cl
        import numpy as np

        device = None
        for plat in cl.get_platforms():
            for dev in plat.get_devices():
                if dev.type & cl.device_type.GPU:
                    device = dev
                    break
            if device:
                break
        if device is None:
            raise RuntimeError("No OpenCL GPU device found")

        ctx = cl.Context([device])
        cq = cl.CommandQueue(ctx)
        n = 1 << 20

        a_np = np.random.rand(n).astype(np.float32)
        b_np = np.random.rand(n).astype(np.float32)
        mf = cl.mem_flags
        a_buf = cl.Buffer(ctx, mf.READ_ONLY | mf.COPY_HOST_PTR, hostbuf=a_np)
        b_buf = cl.Buffer(ctx, mf.READ_ONLY | mf.COPY_HOST_PTR, hostbuf=b_np)
        res_buf = cl.Buffer(ctx, mf.WRITE_ONLY, a_np.nbytes)

        prg = cl.Program(ctx, """
        __kernel void burn(__global const float *a, __global const float *b,
                            __global float *res, const int iters) {
            int gid = get_global_id(0);
            float x = a[gid];
            float y = b[gid];
            for (int i = 0; i < iters; i++) {
                x = x * y + 1.0f;
                y = y * x - 1.0f;
            }
            res[gid] = x + y;
        }
        """).build()
        burn_kernel = cl.Kernel(prg, "burn")  # build once, reuse - avoids RepeatedKernelRetrieval

        while not stop_event.is_set():
            pct = max(0.0, min(100.0, target.value)) / 100.0
            busy = CYCLE_PERIOD * pct
            idle = CYCLE_PERIOD - busy

            start = time.perf_counter()
            if busy > 0:
                while time.perf_counter() - start < busy:
                    burn_kernel(cq, (n,), None, a_buf, b_buf, res_buf, np.int32(200))
                    cq.finish()
            if idle > 0:
                time.sleep(idle)
    except Exception as e:
        error_queue.put(f"GPU (OpenCL) worker error: {e}")


# ---------------------------------------------------------------------------
# Worker supervision - restarts a worker process if it dies unexpectedly,
# and reports it through the error queue instead of failing silently.
# ---------------------------------------------------------------------------

class WorkerSupervisor:
    def __init__(self, name, target_func, args, error_queue):
        self.name = name
        self.target_func = target_func
        self.args = args
        self.error_queue = error_queue
        self.last_restart = 0.0
        self.process = self._spawn()

    def _spawn(self):
        p = mp.Process(target=self.target_func, args=self.args, daemon=True)
        p.start()
        return p

    def check(self, stop_event):
        """Call every GUI tick. Restarts the process if it died unexpectedly."""
        if stop_event.is_set():
            return
        if self.process.is_alive():
            return
        now = time.time()
        if now - self.last_restart < MIN_RESTART_INTERVAL:
            return
        exitcode = self.process.exitcode
        self.error_queue.put(
            f"{self.name} worker stopped unexpectedly (exit code {exitcode}) - restarting."
        )
        self.last_restart = now
        self.process = self._spawn()

    def join(self, timeout=1):
        self.process.join(timeout=timeout)


# ---------------------------------------------------------------------------
# GUI
# ---------------------------------------------------------------------------

class ResourcePanel:
    """Slider + LOAD/PULSE/STOP hold-buttons for one resource. Always interactive;
    `functional` controls whether load is actually being generated."""

    def __init__(self, parent, name, target_value, functional=True, note=""):
        self.name = name
        self.target = target_value
        self.functional = functional
        self.note = note
        self.load_held = False
        self.pulse_held = False
        self.stop_held = False

        self.frame = ttk.LabelFrame(parent, text=name, padding=10)

        self.slider_var = tk.DoubleVar(value=20.0)
        self.slider = ttk.Scale(
            self.frame, from_=0, to=100, orient="horizontal",
            variable=self.slider_var, command=self._on_slider,
        )
        self.slider.pack(fill="x", pady=(0, 4))

        self.slider_label = ttk.Label(self.frame, text="Target: 20%")
        self.slider_label.pack(anchor="w")

        btn_frame = ttk.Frame(self.frame)
        btn_frame.pack(fill="x", pady=(10, 4))

        self.load_btn = tk.Button(
            btn_frame, text="HOLD\nLOAD", bg="#2e7d32", fg="white",
            activebackground="#1b5e20", relief="raised",
        )
        self.load_btn.pack(side="left", expand=True, fill="both", padx=2, ipady=8)
        self.load_btn.bind("<ButtonPress-1>", lambda e: self._set("load_held", True))
        self.load_btn.bind("<ButtonRelease-1>", lambda e: self._set("load_held", False))

        self.pulse_btn = tk.Button(
            btn_frame, text="HOLD\nPULSE 100%", bg="#e65100", fg="white",
            activebackground="#bf360c", relief="raised",
        )
        self.pulse_btn.pack(side="left", expand=True, fill="both", padx=2, ipady=8)
        self.pulse_btn.bind("<ButtonPress-1>", lambda e: self._set("pulse_held", True))
        self.pulse_btn.bind("<ButtonRelease-1>", lambda e: self._set("pulse_held", False))

        self.stop_btn = tk.Button(
            btn_frame, text="HOLD\nSTOP", bg="#b71c1c", fg="white",
            activebackground="#7f0000", relief="raised",
        )
        self.stop_btn.pack(side="left", expand=True, fill="both", padx=2, ipady=8)
        self.stop_btn.bind("<ButtonPress-1>", lambda e: self._set("stop_held", True))
        self.stop_btn.bind("<ButtonRelease-1>", lambda e: self._set("stop_held", False))

        self.status_label = ttk.Label(self.frame, text="Applied: 0%   Actual: --", wraplength=240)
        self.status_label.pack(anchor="w", pady=(10, 0))

        if not self.functional:
            self.warn_label = ttk.Label(
                self.frame, text=f"\u26a0 {self.note}", foreground="#b71c1c", wraplength=240
            )
            self.warn_label.pack(anchor="w", pady=(6, 0))

    def _on_slider(self, _evt=None):
        self.slider_label.config(text=f"Target: {int(self.slider_var.get())}%")

    def _set(self, attr, value):
        setattr(self, attr, value)

    def tick(self, actual_text="--"):
        if self.stop_held:
            applied = 0.0
        elif self.pulse_held:
            applied = PULSE_LOAD_PERCENT
        elif self.load_held:
            applied = self.slider_var.get()
        else:
            applied = 0.0

        self.target.value = applied

        if self.functional:
            self.status_label.config(
                text=f"Applied: {int(applied)}%   Actual: {actual_text}",
                foreground="black",
            )
        else:
            self.status_label.config(
                text=f"Applied: {int(applied)}%   Actual: {actual_text}   "
                     f"(not generating load - see warning below)",
                foreground="#b71c1c",
            )


class App:
    def __init__(self, root):
        self.root = root
        root.title("System Load Tester")
        root.geometry("1000x560")
        root.minsize(860, 480)

        self.error_queue = mp.Queue()
        self.stop_event_cpu = mp.Event()
        self.stop_event_ram = mp.Event()
        self.stop_event_gpu = mp.Event()

        self.cpu_target = mp.Value("d", 0.0)
        self.ram_target = mp.Value("d", 0.0)
        self.gpu_target = mp.Value("d", 0.0)

        container = ttk.Frame(root, padding=14)
        container.pack(fill="both", expand=True)

        ttk.Label(
            container, text="System Load Tester", font=("Segoe UI", 16, "bold")
        ).pack(anchor="w")
        ttk.Label(
            container,
            text=("Hold LOAD to apply the slider's load. Hold PULSE to spike to 100%. "
                  "Hold STOP to force 0% (overrides the others). Release everything "
                  "and that resource goes back to idle."),
            wraplength=960,
        ).pack(anchor="w", pady=(2, 12))

        panels_frame = ttk.Frame(container)
        panels_frame.pack(fill="both", expand=False)

        # --- CPU ---
        self.cpu_panel = ResourcePanel(panels_frame, "CPU", self.cpu_target, functional=True)
        self.cpu_panel.frame.pack(side="left", fill="both", expand=True, padx=6)

        # --- RAM ---
        self.ram_panel = ResourcePanel(panels_frame, "RAM", self.ram_target, functional=True)
        self.ram_panel.frame.pack(side="left", fill="both", expand=True, padx=6)

        # --- GPU ---
        gpu_functional = GPU_BACKEND is not None
        self.gpu_panel = ResourcePanel(
            panels_frame, "GPU", self.gpu_target,
            functional=gpu_functional, note=GPU_BACKEND_DETAIL,
        )
        self.gpu_panel.frame.pack(side="left", fill="both", expand=True, padx=6)

        if gpu_functional:
            ttk.Label(
                container, text=f"GPU backend: {GPU_BACKEND_DETAIL}",
                foreground="#2e7d32",
            ).pack(anchor="w", pady=(8, 0))

        # --- Error / status log ---
        log_frame = ttk.LabelFrame(container, text="Errors / Status Log", padding=8)
        log_frame.pack(fill="both", expand=True, pady=(14, 0))

        log_inner = ttk.Frame(log_frame)
        log_inner.pack(fill="both", expand=True)

        self.log_text = tk.Text(
            log_inner, height=7, state="disabled", wrap="word",
            bg="#1e1e1e", fg="#e0e0e0", insertbackground="#e0e0e0",
        )
        self.log_text.tag_config("error", foreground="#ff6b6b")
        self.log_text.tag_config("warn", foreground="#ffb74d")
        self.log_text.tag_config("info", foreground="#81c784")
        scrollbar = ttk.Scrollbar(log_inner, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scrollbar.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        ttk.Button(log_frame, text="Clear Log", command=self._clear_log).pack(anchor="e", pady=(6, 0))

        # --- start worker processes (supervised, auto-restart on crash) ---
        self.cpu_supervisors = [
            WorkerSupervisor(
                f"CPU#{i}", cpu_worker,
                (self.cpu_target, self.stop_event_cpu, self.error_queue, i),
                self.error_queue,
            )
            for i in range(os.cpu_count() or 4)
        ]

        total_ram = psutil.virtual_memory().total
        self.ram_supervisor = WorkerSupervisor(
            "RAM", ram_worker,
            (self.ram_target, self.stop_event_ram, self.error_queue, total_ram),
            self.error_queue,
        )

        self.gpu_supervisor = None
        if GPU_BACKEND == "torch":
            self.gpu_supervisor = WorkerSupervisor(
                "GPU", gpu_worker_torch,
                (self.gpu_target, self.stop_event_gpu, self.error_queue),
                self.error_queue,
            )
        elif GPU_BACKEND == "opencl":
            self.gpu_supervisor = WorkerSupervisor(
                "GPU", gpu_worker_opencl,
                (self.gpu_target, self.stop_event_gpu, self.error_queue),
                self.error_queue,
            )

        if not gpu_functional:
            self._log(f"GPU load generation disabled: {GPU_BACKEND_DETAIL}", "warn")
        else:
            self._log(f"GPU load generation ready: {GPU_BACKEND_DETAIL}", "info")

        if PYNVML_AVAILABLE:
            self._log("GPU usage readout: using pynvml (NVML).", "info")
        elif NVIDIA_SMI_AVAILABLE:
            self._log("GPU usage readout: using nvidia-smi (pynvml not installed).", "info")
        else:
            self._log(
                "GPU usage readout unavailable - 'Actual' will show '--'. "
                "Install pynvml (pip install pynvml) or make sure nvidia-smi "
                "is on your PATH to see live GPU %.",
                "warn",
            )

        psutil.cpu_percent(interval=None)  # prime the reading
        root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.tick()

    def _log(self, message, level="error"):
        timestamp = time.strftime("%H:%M:%S")
        self.log_text.configure(state="normal")
        self.log_text.insert("end", f"[{timestamp}] {message}\n", level)
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _clear_log(self):
        self.log_text.configure(state="normal")
        self.log_text.delete("1.0", "end")
        self.log_text.configure(state="disabled")

    def _drain_errors(self):
        while True:
            try:
                msg = self.error_queue.get_nowait()
            except queue.Empty:
                break
            else:
                self._log(msg, "error")

    def tick(self):
        self._drain_errors()

        for sup in self.cpu_supervisors:
            sup.check(self.stop_event_cpu)
        self.ram_supervisor.check(self.stop_event_ram)
        if self.gpu_supervisor:
            self.gpu_supervisor.check(self.stop_event_gpu)

        cpu_actual = f"{psutil.cpu_percent(interval=None):.0f}%"
        ram_actual = f"{psutil.virtual_memory().percent:.0f}%"
        gpu_actual = get_gpu_percent_text()

        self.cpu_panel.tick(cpu_actual)
        self.ram_panel.tick(ram_actual)
        self.gpu_panel.tick(gpu_actual)

        self.root.after(TICK_MS, self.tick)

    def on_close(self):
        self.stop_event_cpu.set()
        self.stop_event_ram.set()
        self.stop_event_gpu.set()
        for sup in self.cpu_supervisors:
            sup.join(timeout=1)
        self.ram_supervisor.join(timeout=1)
        if self.gpu_supervisor:
            self.gpu_supervisor.join(timeout=1)
        self.root.destroy()


if __name__ == "__main__":
    mp.freeze_support()
    # Must be "spawn", not the Linux default "fork": NVIDIA's driver does not
    # support being used in a process forked after the driver was touched in
    # the parent. "spawn" gives every worker a clean process with no
    # inherited driver state, which is what fixes INVALID_DEVICE-type errors.
    mp.set_start_method("spawn", force=True)

    GPU_BACKEND, GPU_BACKEND_DETAIL = detect_gpu_backend()
    PYNVML_AVAILABLE = detect_pynvml()
    NVIDIA_SMI_AVAILABLE = detect_nvidia_smi()

    try:
        root = tk.Tk()
        App(root)
        root.mainloop()
    except Exception as exc:
        try:
            messagebox.showerror("System Load Tester - fatal error", str(exc))
        except Exception:
            print(f"Fatal error: {exc}", file=sys.stderr)
        sys.exit(1)