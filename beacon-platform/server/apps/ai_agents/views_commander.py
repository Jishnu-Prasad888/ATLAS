from __future__ import annotations

import logging
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ai_agents.commander import run_commander_for_question
from apps.audit.utils import audit_log


class CommanderChatView(APIView):
    permission_classes = [IsAuthenticated]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ai_logger = logging.getLogger("ai")

    def post(self, request):
        question = request.data.get("question", "").strip()
        if not question:
            return Response({"detail": "question is required"}, status=400)

        api_key = request.data.get("api_key") or request.headers.get("X-OpenAI-Key")
        if api_key:
            api_key = str(api_key).strip()[:200]

        self.ai_logger.info(
            "ai.commander.request",
            extra={
                "user": getattr(request.user, "username", "anon"),
                "question_len": len(question),
                "provided_api_key": bool(api_key),
                "question": question[:2000],
            },
        )

        try:
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
