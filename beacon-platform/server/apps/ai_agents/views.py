from __future__ import annotations

import logging
import time

from django.conf import settings
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from typing import Any, Dict

from apps.ai_agents.graph import run_graph
from apps.ai_agents.serializers import AiRunRequestSerializer
from apps.audit.utils import audit_log

ai_logger = logging.getLogger("ai")


def _truncate(text: str, limit: int = 8000) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "...<truncated>"


class AiRunGraphView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AiRunRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data: Dict[str, Any] = serializer.validated_data  # type: ignore[assignment]

        # Force caller token into fetch spec to respect scope; ignore client-provided token unless admin
        fetch_spec_raw = data.get("fetch") or {}
        fetch_spec: Dict[str, Any] = dict(fetch_spec_raw)
        user_token = request.META.get("HTTP_AUTHORIZATION", "").replace("Bearer ", "").strip()
        fetch_spec["token"] = user_token or fetch_spec.get("token")

        ai_logger.info(
            "ai.run_graph.request",
            extra={
                "user": getattr(request.user, "username", "anon"),
                "fetch_url": fetch_spec.get("url"),
                "fetch_method": fetch_spec.get("method", "GET"),
                "has_token": bool(fetch_spec.get("token")),
                "fetch_params": _redact(fetch_spec.get("params")),
                "timeout_s": data.get("timeout_s", settings.SANDBOX_TIMEOUT),
                "mem_limit": data.get("mem_limit", settings.SANDBOX_MEM_LIMIT),
                "cpu_quota": data.get("cpu_quota", settings.SANDBOX_CPU_QUOTA),
                "code_len": len(data.get("code", "")),
                "code_preview": (data.get("code") or "")[:2000],
                "input_present": data.get("input_data") is not None,
                "input_preview": _redact(data.get("input_data")) if data.get("input_data") else None,
            },
        )

        start = time.time()
        try:
            result = run_graph(
                fetch=fetch_spec,
                code=data["code"],
                input_data=data.get("input_data"),
                timeout_s=data.get("timeout_s", settings.SANDBOX_TIMEOUT),
                mem_limit=data.get("mem_limit", settings.SANDBOX_MEM_LIMIT),
                cpu_quota=data.get("cpu_quota", settings.SANDBOX_CPU_QUOTA),
                retries=data.get("retries", 1),
            )
        except Exception as exc:
            duration_ms = int((time.time() - start) * 1000)
            ai_logger.error(
                "ai.run_graph.error",
                extra={
                    "user": getattr(request.user, "username", "anon"),
                    "duration_ms": duration_ms,
                    "error": str(exc),
                },
            )
            return Response({"detail": str(exc)}, status=502)
        duration_ms = int((time.time() - start) * 1000)

        fetch_result = result.get("fetch_result") or {}
        exec_result = result.get("exec_result") or {}

        ai_logger.info(
            "ai.run_graph.response",
            extra={
                "user": getattr(request.user, "username", "anon"),
                "duration_ms": duration_ms,
                "fetch_status": fetch_result.get("status"),
                "exec_exit": exec_result.get("exit_code"),
                "exec_stdout_len": len(str(exec_result.get("stdout", ""))),
                "exec_stdout_preview": str(exec_result.get("stdout", ""))[:2000],
            },
        )

        audit_log(
            request,
            action="AI_RUN_GRAPH",
            resource="ai",
            details={
                "duration_ms": duration_ms,
                "fetch_status": fetch_result.get("status"),
                "exec_exit": exec_result.get("exit_code"),
            },
        )

        if "stdout" in exec_result:
            exec_result["stdout"] = _truncate(exec_result["stdout"])

        return Response({
            "duration_ms": duration_ms,
            "fetch_result": fetch_result,
            "exec_result": exec_result,
        })
