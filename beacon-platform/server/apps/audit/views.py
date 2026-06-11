"""
Beacon Audit Views — /api/v1/audit/
"""
from rest_framework import serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from django.http import JsonResponse

from apps.auth_rbac.permissions import IsAdministrator, IsViewer
from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AuditLog
        fields = ["id", "timestamp", "user", "ip_address", "action", "resource", "resource_id", "details", "success"]


class AuditLogListView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
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
        return Response(AuditLogSerializer(qs, many=True).data)


class AuditLogExportView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        qs   = AuditLog.objects.all().order_by("-timestamp")[:50000]
        data = AuditLogSerializer(qs, many=True).data
        response = JsonResponse({"audit_logs": data, "count": len(data)})
        response["Content-Disposition"] = 'attachment; filename="beacon_audit_export.json"'
        return response
