"""
Beacon Logs Views — /api/v1/logs/
"""
import logging
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.auth_rbac.permissions import IsAdminOrReadOnly, IsViewer, IsAdministrator
from apps.audit.utils import audit_log
from .models import LogEntry, LogSeverity
from .serializers import (
    LogEntrySerializer,
    LogBatchIngestSerializer,
    LogQuerySerializer,
)

logger = logging.getLogger("beacon")
channel_layer = get_channel_layer()


def broadcast_log(agent_id: str, log_data: dict):
    try:
        async_to_sync(channel_layer.group_send)(
            f"logs_{agent_id}",
            {"type": "log.entry", "data": log_data},
        )
    except Exception as e:
        logger.warning(f"Log broadcast failed: {e}")


class LogIngestView(APIView):
    """POST /api/v1/logs/ingest/ — Agent posts log batches."""
    permission_classes = []

    def post(self, request):
        serializer = LogBatchIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data     = serializer.validated_data
        agent_id = data["agent_id"]

        # Sanitize messages (prevent log injection)
        objects = []
        for log in data["logs"]:
            msg = log["message"].replace("\x00", "").replace("\r", "")[:8192]
            objects.append(LogEntry(
                agent_id        = agent_id,
                source          = log["source"],
                severity        = log["severity"],
                message         = msg,
                timestamp       = log["timestamp"],
                schema_version  = log.get("schema_version", "1.0"),
                extra           = log.get("extra", {}),
                sequence_number = log.get("sequence_number"),
            ))

        LogEntry.objects.bulk_create(objects, batch_size=500)

        # Broadcast last log to WebSocket subscribers
        if objects:
            broadcast_log(agent_id, LogEntrySerializer(objects[-1]).data)

        return Response({"ingested": len(objects)}, status=status.HTTP_201_CREATED)


class LogListView(APIView):
    """GET /api/v1/logs/ — Query logs."""
    permission_classes = [IsViewer]

    def get(self, request):
        qs_s = LogQuerySerializer(data=request.query_params)
        qs_s.is_valid(raise_exception=True)
        p = qs_s.validated_data

        qs = LogEntry.objects.all()
        if p.get("agent_id"):
            qs = qs.filter(agent_id=p["agent_id"])
        if p.get("source"):
            qs = qs.filter(source=p["source"])
        if p.get("severity"):
            qs = qs.filter(severity=p["severity"])
        if p.get("search"):
            qs = qs.filter(message__icontains=p["search"])
        if p.get("start"):
            qs = qs.filter(timestamp__gte=p["start"])
        if p.get("end"):
            qs = qs.filter(timestamp__lte=p["end"])

        qs = qs.order_by("-timestamp")[: p.get("limit", 500)]
        return Response(LogEntrySerializer(qs, many=True).data)


class LogExportView(APIView):
    """GET /api/v1/logs/export/ — Export logs as JSON."""
    permission_classes = [IsViewer]

    def get(self, request):
        from django.http import JsonResponse
        import json
        qs_s = LogQuerySerializer(data=request.query_params)
        qs_s.is_valid(raise_exception=True)
        p  = qs_s.validated_data
        qs = LogEntry.objects.all()
        if p.get("agent_id"):
            qs = qs.filter(agent_id=p["agent_id"])
        if p.get("severity"):
            qs = qs.filter(severity=p["severity"])
        data = LogEntrySerializer(qs.order_by("-timestamp")[:10000], many=True).data
        response = JsonResponse({"logs": data, "count": len(data)})
        response["Content-Disposition"] = 'attachment; filename="beacon_logs_export.json"'
        return response


class LogClearView(APIView):
    """POST /api/v1/logs/clear/ — Clear logs (Admin only)."""
    permission_classes = [IsAdministrator]

    def post(self, request):
        agent_id = request.data.get("agent_id")
        severity = request.data.get("severity")
        qs = LogEntry.objects.all()
        if agent_id:
            qs = qs.filter(agent_id=agent_id)
        if severity:
            if severity not in dict(LogSeverity.choices):
                return Response({"detail": "Invalid severity."}, status=400)
            qs = qs.filter(severity=severity)
        deleted, _ = qs.delete()
        audit_log(request, action="LOG_CLEAR", resource="logs", details={"deleted": deleted})
        return Response({"deleted": deleted})
