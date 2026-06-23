"""
Atlas AI thread + message endpoints — /api/v1/atlas-ai/
"""
import logging
from typing import Iterable, List

from django.db.models import Count
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.audit.utils import audit_log
from .models import AtlasAiMessage, AtlasAiThread
from .serializers import (
    AtlasAiMessageCreateSerializer,
    AtlasAiMessageSerializer,
    AtlasAiThreadSerializer,
)

logger = logging.getLogger("beacon")


class AtlasAiThreadListCreateView(APIView):
    """List a user's threads or create a new empty one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        threads = (
            AtlasAiThread.objects.filter(user=request.user, deleted_at__isnull=True)
            .annotate(message_count=Count("messages"))
            .order_by("-updated_at")
        )
        logger.debug("AtlasAiThreadListCreateView list for user=%s count=%d", request.user, threads.count())
        return Response(AtlasAiThreadSerializer(threads, many=True).data)

    def post(self, request):
        title = (request.data.get("title") or "").strip()
        thread = AtlasAiThread.objects.create(user=request.user, title=title[:255])
        # annotate for serializer compatibility
        thread.message_count = 0
        audit_log(
            request,
            action="ATLAS_AI_THREAD_CREATE",
            resource="atlas_ai",
            resource_id=str(thread.id),
            details={"title": thread.title},
        )
        logger.debug("AtlasAiThreadListCreateView created thread=%s user=%s", thread.id, request.user)
        return Response(AtlasAiThreadSerializer(thread).data, status=status.HTTP_201_CREATED)


class AtlasAiThreadDetailView(APIView):
    """Delete (soft) a thread that belongs to the user."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, thread_id):
        try:
            thread = AtlasAiThread.objects.get(id=thread_id, user=request.user, deleted_at__isnull=True)
        except AtlasAiThread.DoesNotExist:
            return Response({"detail": "Thread not found."}, status=status.HTTP_404_NOT_FOUND)

        message_count = thread.messages.count()
        thread.mark_deleted()
        audit_log(
            request,
            action="ATLAS_AI_THREAD_DELETE",
            resource="atlas_ai",
            resource_id=str(thread.id),
            details={"messages": message_count},
        )
        logger.debug(
            "AtlasAiThreadDetailView deleted thread=%s user=%s messages=%d",
            thread.id,
            request.user,
            message_count,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def patch(self, request, thread_id):
        try:
            thread = AtlasAiThread.objects.get(id=thread_id, user=request.user, deleted_at__isnull=True)
        except AtlasAiThread.DoesNotExist:
            return Response({"detail": "Thread not found."}, status=status.HTTP_404_NOT_FOUND)

        title = (request.data.get("title") or "").strip()
        if not title:
            return Response({"detail": "Title is required."}, status=status.HTTP_400_BAD_REQUEST)

        thread.title = title[:255]
        thread.save(update_fields=["title", "updated_at"])
        thread.refresh_from_db()
        thread.message_count = thread.messages.count()

        audit_log(
            request,
            action="ATLAS_AI_THREAD_RENAME",
            resource="atlas_ai",
            resource_id=str(thread.id),
            details={"title": thread.title},
        )
        logger.debug("AtlasAiThreadDetailView renamed thread=%s user=%s", thread.id, request.user)
        return Response(AtlasAiThreadSerializer(thread).data)


class AtlasAiThreadMessagesView(APIView):
    """List or append messages for a thread (user-scoped)."""

    permission_classes = [IsAuthenticated]

    def _get_thread(self, request, thread_id):
        try:
            return AtlasAiThread.objects.get(id=thread_id, user=request.user, deleted_at__isnull=True)
        except AtlasAiThread.DoesNotExist:
            return None

    def get(self, request, thread_id):
        thread = self._get_thread(request, thread_id)
        if not thread:
            return Response({"detail": "Thread not found."}, status=status.HTTP_404_NOT_FOUND)

        limit_param = request.query_params.get("limit")
        qs = thread.messages.all().order_by("created_at")
        if limit_param:
            try:
                limit = max(1, min(int(limit_param), 500))
                qs = qs[:limit]
            except ValueError:
                pass

        logger.debug("AtlasAiThreadMessagesView list thread=%s user=%s count=%d", thread.id, request.user, qs.count())
        return Response({"thread": str(thread.id), "messages": AtlasAiMessageSerializer(qs, many=True).data})

    def post(self, request, thread_id):
        thread = self._get_thread(request, thread_id)
        if not thread:
            return Response({"detail": "Thread not found."}, status=status.HTTP_404_NOT_FOUND)

        payload = request.data
        many_payload = payload.get("messages") if isinstance(payload, dict) else None

        if many_payload is not None:
            serializer = AtlasAiMessageCreateSerializer(data=many_payload, many=True)
        else:
            serializer = AtlasAiMessageCreateSerializer(data=payload)

        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        created_messages: List[AtlasAiMessage] = []

        def _coerce_sequence(data) -> Iterable[dict]:
            if isinstance(data, list):
                return data
            return [data]

        now = timezone.now()
        new_title = None
        for msg_data in _coerce_sequence(validated):
            msg = AtlasAiMessage.objects.create(thread=thread, **msg_data)
            created_messages.append(msg)
            if not thread.title and msg.role == "user":
                new_title = (msg.content or "").strip()[:120]

        updates = {"updated_at": now}
        if new_title is not None:
            updates["title"] = new_title
        AtlasAiThread.objects.filter(id=thread.id).update(**updates)

        audit_log(
            request,
            action="ATLAS_AI_MESSAGE_STORE",
            resource="atlas_ai",
            resource_id=str(thread.id),
            details={"count": len(created_messages), "roles": [m.role for m in created_messages]},
        )
        logger.debug(
            "AtlasAiThreadMessagesView stored %d messages thread=%s user=%s",
            len(created_messages),
            thread.id,
            request.user,
        )
        return Response(AtlasAiMessageSerializer(created_messages, many=True).data, status=status.HTTP_201_CREATED)
