from __future__ import annotations

import logging
from typing import Any, Dict
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai_agents.commander import run_commander_for_messages, run_commander_for_question
from apps.audit.utils import audit_log


class CommanderChatView(APIView):
    permission_classes = [IsAuthenticated]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ai_logger = logging.getLogger("ai")

    def post(self, request):
        payload_messages = request.data.get("messages")
        question = (request.data.get("question") or "").strip()

        def _sanitize_messages(raw_messages):
            if not isinstance(raw_messages, list):
                return []

            clean = []
            allowed_roles = {"system", "user", "assistant", "tool"}
            for item in raw_messages:
                if not isinstance(item, dict):
                    continue

                role = str(item.get("role", "")).strip().lower()
                if role not in allowed_roles:
                    continue

                content = item.get("content")
                serialized: Dict[str, Any] = {
                    "role": role,
                    "content": "" if content is None else str(content),
                }

                name = item.get("name")
                if name:
                    serialized["name"] = str(name)[:100]

                tool_call_id = item.get("tool_call_id")
                if role == "tool" and tool_call_id:
                    serialized["tool_call_id"] = str(tool_call_id)[:200]

                if role == "assistant" and item.get("tool_calls"):
                    calls = []
                    for raw_call in item["tool_calls"]:
                        if not isinstance(raw_call, dict):
                            continue
                        fn = raw_call.get("function")
                        if not isinstance(fn, dict):
                            continue

                        fn_name = str(fn.get("name", ""))[:100]
                        fn_args = str(fn.get("arguments", ""))
                        call_payload: Dict[str, Any] = {
                            "function": {
                                "name": fn_name,
                                "arguments": fn_args,
                            }
                        }

                        call_id = raw_call.get("id")
                        if call_id:
                            call_payload["id"] = str(call_id)[:200]

                        call_type = raw_call.get("type")
                        if call_type:
                            call_payload["type"] = str(call_type)[:50]

                        calls.append(call_payload)

                    if calls:
                        serialized["tool_calls"] = calls

                clean.append(serialized)

            return clean

        messages = _sanitize_messages(payload_messages)

        if messages and question:
            messages.append({"role": "user", "content": question})

        if not messages and not question:
            return Response({"detail": "question or messages are required"}, status=400)

        api_key = request.data.get("api_key") or request.headers.get("X-OpenAI-Key")
        if api_key:
            api_key = str(api_key).strip()[:200]

        preview_source = ""
        if messages:
            for existing in reversed(messages):
                if existing.get("role") == "user" and existing.get("content"):
                    preview_source = existing["content"]
                    break
        if not preview_source:
            preview_source = question

        self.ai_logger.info(
            "ai.commander.request",
            extra={
                "user": getattr(request.user, "username", "anon"),
                "question_len": len(preview_source),
                "provided_api_key": bool(api_key),
                "question": preview_source[:2000],
            },
        )

        try:
            if messages:
                trace = run_commander_for_messages(messages, api_key=api_key, request=request)
            else:
                trace = run_commander_for_question(question, api_key=api_key, request=request)
        except Exception as exc:  # tool/HTTP/OpenAI errors
            self.ai_logger.error(
                "ai.commander.error",
                extra={
                    "user": getattr(request.user, "username", "anon"),
                    "error": str(exc),
                    "question": question[:2000],
                },
            )
            return Response({"detail": str(exc)}, status=502)

        audit_log(request, action="AI_COMMANDER", resource="ai", details={"turns": len(trace)})

        last_msg = trace[-1]["content"] if trace and isinstance(trace[-1], dict) else None
        self.ai_logger.info(
            "ai.commander.response",
            extra={
                "user": getattr(request.user, "username", "anon"),
                "turns": len(trace),
                "last_msg_len": len(last_msg) if isinstance(last_msg, str) else None,
                "question": question[:2000],
                "last_msg_preview": last_msg[:2000] if isinstance(last_msg, str) else None,
            },
        )

        return Response({"transcript": trace})
