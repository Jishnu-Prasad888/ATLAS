"""
Beacon Audit Views — /api/v1/audit/
"""
import logging
from rest_framework import serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.http import JsonResponse

from apps.auth_rbac.permissions import IsAdministrator, IsModeratorOrAdmin
from .models import AuditLog
from .utils import audit_log

logger = logging.getLogger("beacon")


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AuditLog
        fields = [
            "id",
            "timestamp",
            "user",
            "ip_address",
            "action",
            "resource",
            "resource_id",
            "details",
            "success",
            "user_agent",
            "device",
            "country",
            "region",
            "city",
            "latitude",
            "longitude",
            "path",
            "method",
            "session_id",
            "approved_by",
        ]


class AuditLogIngestSerializer(serializers.Serializer):
    action = serializers.CharField(max_length=64)
    resource = serializers.CharField(max_length=64, required=False, default="atlas_ai")
    resource_id = serializers.CharField(max_length=256, allow_blank=True, required=False, default="")
    details = serializers.DictField(required=False, default=dict)
    success = serializers.BooleanField(required=False, default=True)

    # Optional context fields that we merge into details so clients can send richer payloads
    status = serializers.ChoiceField(choices=["ok", "error"], required=False)
    error = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    timestamp = serializers.CharField(required=False, allow_blank=True)
    user_id = serializers.IntegerField(required=False)
    username = serializers.CharField(required=False, allow_blank=True)
    role = serializers.CharField(required=False, allow_blank=True)


class AuditLogListView(APIView):
    permission_classes = [IsModeratorOrAdmin]

    def get(self, request):
        logger.debug("AuditLogListView GET — user=%s params=%s", request.user, request.query_params)
        qs = AuditLog.objects.all()
        user     = request.query_params.get("user")
        action   = request.query_params.get("action")
        resource = request.query_params.get("resource")
        start    = request.query_params.get("start")
        end      = request.query_params.get("end")

        if user:
            qs = qs.filter(user=user)
        if action:
            qs = qs.filter(action=action)
        if resource:
            qs = qs.filter(resource=resource)
        if start:
            qs = qs.filter(timestamp__gte=start)
        if end:
            qs = qs.filter(timestamp__lte=end)

        limit = min(int(request.query_params.get("limit", 500)), 10000)
        qs    = qs.order_by("-timestamp")[:limit]
        logger.debug("AuditLogListView returning %d audit logs", len(qs))
        return Response(AuditLogSerializer(qs, many=True).data)


class AuditLogIngestView(APIView):
    """Allow authenticated users to record audit events (used by ATLAS-AI)."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = AuditLogIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Merge optional fields into details for traceability
        details = {**(data.get("details") or {})}
        for field in ["status", "error", "timestamp", "user_id", "username", "role"]:
            if field in data and data[field] is not None:
                details[field] = data[field]

        success = data.get("success")
        if success is None and "status" in data:
            success = data.get("status") != "error"

        audit_log(
            request,
            action=data["action"],
            resource=data.get("resource") or "atlas_ai",
            resource_id=data.get("resource_id", ""),
            details=details,
            success=True if success is None else success,
        )
        return Response({"ok": True}, status=201)


class AuditLogExportView(APIView):
    permission_classes = [IsModeratorOrAdmin]

    def get(self, request):
        logger.debug("AuditLogExportView GET — user=%s", request.user)
        qs   = AuditLog.objects.all().order_by("-timestamp")[:50000]
        data = AuditLogSerializer(qs, many=True).data
        logger.debug("AuditLogExportView exporting %d audit logs", len(data))
        response = JsonResponse({"audit_logs": data, "count": len(data)})
        response["Content-Disposition"] = 'attachment; filename="beacon_audit_export.json"'
        return response
