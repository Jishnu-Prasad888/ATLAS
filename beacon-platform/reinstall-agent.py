#!/usr/bin/env python3
import subprocess
import sys
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
BINARY_SRC = PROJECT_ROOT / "agent" / "target" / "release" / "beacon-agent"
BINARY_DST = Path("/usr/local/bin/beacon-agent")
CONFIG_DST = Path("/etc/beacon/agent.toml")
CONFIG_EXAMPLE = PROJECT_ROOT / "agent" / "agent.toml.example"
STORAGE_DIR = Path("/var/lib/beacon/agent")

actions = []

def confirm(prompt):
    while True:
        ans = input(f"{prompt} [y/n/q] ").strip().lower()
        if ans == "y":
            return True
        elif ans == "n":
            return False
        elif ans == "q":
            print("\nExecuting all confirmed actions before exit...")
            run_all()
            sys.exit(0)


def run_all():
    for desc, fn in actions:
        print(f"\n=== {desc} ===")
        try:
            fn()
        except Exception as e:
            print(f"  FAILED: {e}")


print("Beacon Agent Reinstall Script")
print("=============================\n")

# --- Stop & delete binary ---
def stop_and_delete():
    subprocess.run(["pkill", "-f", "beacon-agent"], capture_output=True)
    if BINARY_DST.exists():
        BINARY_DST.unlink()
        print(f"  Deleted {BINARY_DST}")
    else:
        print("  Binary not found, skipping")

if confirm("Stop existing beacon-agent and delete the binary?"):
    actions.append(("Stop & delete binary", stop_and_delete))

# --- Delete agent database ---
def delete_db():
    if STORAGE_DIR.exists():
        shutil.rmtree(STORAGE_DIR)
        print(f"  Deleted {STORAGE_DIR}")
    else:
        print("  Database directory not found, skipping")

if confirm("Delete the beacon-agent database?"):
    actions.append(("Delete database", delete_db))

# --- Copy binary ---
def copy_binary():
    if not BINARY_SRC.exists():
        raise FileNotFoundError(f"Release binary not found at {BINARY_SRC}")
    shutil.copy2(BINARY_SRC, BINARY_DST)
    BINARY_DST.chmod(0o755)
    print(f"  Copied {BINARY_SRC} -> {BINARY_DST}")

if confirm("Copy beacon-agent from release directory to /usr/local/bin/?"):
    actions.append(("Copy binary", copy_binary))

# --- Overwrite config ---
def overwrite_config():
    if not CONFIG_EXAMPLE.exists():
        raise FileNotFoundError(f"Config example not found at {CONFIG_EXAMPLE}")
    CONFIG_DST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(CONFIG_EXAMPLE, CONFIG_DST)
    print(f"  Copied {CONFIG_EXAMPLE} -> {CONFIG_DST}")

if confirm("Overwrite /etc/beacon/agent.toml with a fresh copy from agent.toml.example?"):
    actions.append(("Overwrite config", overwrite_config))

# --- Execute ---
if not actions:
    print("\nNo actions selected. Exiting.")
    sys.exit(0)

print("\n" + "=" * 50)
print("Executing all confirmed actions:")
run_all()
print("\nDone.")
