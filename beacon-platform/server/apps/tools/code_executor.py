"""Sandboxed code executor using Docker SDK.

Runs user-provided Python code against provided JSON input inside a hardened
container. Intended for agent-driven, short-lived tasks.
"""

from __future__ import annotations

import json
import os
import tempfile
import uuid
from typing import Any, Dict, Optional

import docker
from docker.errors import APIError, ContainerError

from apps.tools.ast_lint import lint_code

SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "sandbox-python:1.0")
SANDBOX_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "15"))
SANDBOX_MEM_LIMIT = os.environ.get("SANDBOX_MEM_LIMIT", "256m")
SANDBOX_CPU_QUOTA = int(os.environ.get("SANDBOX_CPU_QUOTA", "50000"))  # ~0.5 CPU


class SandboxError(Exception):
    pass


def _wrap_user_code(user_code: str) -> str:
    return f"""
import json
import sys

with open("input.json") as f:
    input_data = json.load(f)

# --- user code starts ---
{user_code}
# --- user code ends ---

# If user defines `result`, persist it for structured retrieval
if 'result' in globals():
    with open('output.json', 'w') as f:
        json.dump(result, f)
"""


def run_in_sandbox(
    code: str,
    input_data: Dict[str, Any],
    *,
    image: str = SANDBOX_IMAGE,
    timeout_s: int = SANDBOX_TIMEOUT,
    mem_limit: str = SANDBOX_MEM_LIMIT,
    cpu_quota: int = SANDBOX_CPU_QUOTA,
    retries: int = 1,
) -> Dict[str, Any]:
    """Execute code inside sandbox container.

    Returns dict with exit_code, stdout, stderr (combined), output_json (optional), duration_ms.
    """

    lint_code(code)
    client = docker.from_env()
    attempt = 0
    last_error: Optional[Exception] = None

    while attempt <= retries:
        attempt += 1
        try:
            return _run_once(
                client,
                code=code,
                input_data=input_data,
                image=image,
                timeout_s=timeout_s,
                mem_limit=mem_limit,
                cpu_quota=cpu_quota,
            )
        except (APIError, ContainerError) as exc:  # transient docker issues
            last_error = exc
            if attempt > retries:
                raise SandboxError(f"Docker error: {exc}")
        except Exception as exc:  # user/runtime errors
            raise SandboxError(str(exc))

    # should not reach
    raise SandboxError(str(last_error) if last_error else "Unknown sandbox error")


def _run_once(
    client: docker.DockerClient,
    *,
    code: str,
    input_data: Dict[str, Any],
    image: str,
    timeout_s: int,
    mem_limit: str,
    cpu_quota: int,
) -> Dict[str, Any]:
    job_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory(prefix=f"sandbox-{job_id}-") as tmp:
        code_path = os.path.join(tmp, "main.py")
        input_path = os.path.join(tmp, "input.json")
        output_path = os.path.join(tmp, "output.json")

        with open(code_path, "w", encoding="utf-8") as f:
            f.write(_wrap_user_code(code))
        with open(input_path, "w", encoding="utf-8") as f:
            json.dump(input_data, f)

        container = client.containers.run(
            image,
            command="python main.py",
            volumes={tmp: {"bind": "/app", "mode": "rw"}},
            working_dir="/app",
            detach=True,
            network_disabled=True,
            mem_limit=mem_limit,
            cpu_quota=cpu_quota,
            stderr=True,
            stdout=True,
            read_only=True,
            security_opt=["no-new-privileges"],
            cap_drop=["ALL"],
            pids_limit=64,
        )

        try:
            result = container.wait(timeout=timeout_s)
            exit_code = result.get("StatusCode", 1)
            logs = container.logs(stdout=True, stderr=True).decode(errors="replace")

            output_json = None
            if os.path.exists(output_path):
                try:
                    with open(output_path, "r", encoding="utf-8") as f:
                        output_json = json.load(f)
                except Exception:
                    output_json = None

            if exit_code != 0:
                raise SandboxError(f"Non-zero exit ({exit_code}): {logs[:4000]}")

            return {
                "exit_code": exit_code,
                "stdout": logs,
                "output_json": output_json,
            }
        finally:
            try:
                container.remove(force=True)
            except Exception:
                pass
