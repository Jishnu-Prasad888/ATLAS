"""
Beacon Config Views — /api/v1/config/
"""
import logging
from rest_framework import serializers, status
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.auth_rbac.permissions import IsAdministrator
from apps.audit.utils import audit_log
from .models import ServerConfig

logger = logging.getLogger("beacon")


class ServerConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model        = ServerConfig
        fields       = ["key", "value", "encrypted", "updated_by", "updated_at", "description"]
        read_only_fields = ["updated_by", "updated_at"]


class ConfigListView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        logger.debug("ConfigListView GET — user=%s", request.user)
        configs = ServerConfig.objects.all()
        logger.debug("ConfigListView returning %d configs", configs.count())
        return Response(ServerConfigSerializer(configs, many=True).data)

    def post(self, request):
        logger.debug("ConfigListView POST — data=%s user=%s", request.data, request.user)
        serializer = ServerConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        config = serializer.save(updated_by=request.user.username)
        logger.debug("ConfigListView config key=%s created", config.key)
        audit_log(request, action="CONFIG_SET", resource="config", resource_id=config.key)
        return Response(ServerConfigSerializer(config).data, status=status.HTTP_201_CREATED)


class ConfigDetailView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request, key):
        logger.debug("ConfigDetailView GET — key=%s user=%s", key, request.user)
        try:
            config = ServerConfig.objects.get(key=key)
        except ServerConfig.DoesNotExist:
            logger.debug("ConfigDetailView key not found: %s", key)
            return Response({"detail": "Key not found."}, status=404)
        return Response(ServerConfigSerializer(config).data)

    def put(self, request, key):
        logger.debug("ConfigDetailView PUT — key=%s data=%s user=%s", key, request.data, request.user)
        config, created = ServerConfig.objects.get_or_create(key=key)
        serializer = ServerConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user.username)
        logger.debug("ConfigDetailView key=%s %s", key, "created" if created else "updated")
        audit_log(request, action="CONFIG_UPDATE", resource="config", resource_id=key)
        return Response(serializer.data)

    def delete(self, request, key):
        logger.debug("ConfigDetailView DELETE — key=%s user=%s", key, request.user)
        try:
            config = ServerConfig.objects.get(key=key)
        except ServerConfig.DoesNotExist:
            logger.debug("ConfigDetailView key not found: %s", key)
            return Response({"detail": "Key not found."}, status=404)
        config.delete()
        logger.debug("ConfigDetailView key=%s deleted", key)
        audit_log(request, action="CONFIG_DELETE", resource="config", resource_id=key)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RetentionConfigView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        logger.debug("RetentionConfigView GET — user=%s", request.user)
        config, _ = ServerConfig.objects.get_or_create(
            key="retention_policy",
            defaults={"value": {"raw_hours": 24, "rollup_1m_days": 30, "rollup_1h_days": 365}}
        )
        return Response(config.value)

    def put(self, request):
        logger.debug("RetentionConfigView PUT — data=%s user=%s", request.data, request.user)
        config, _ = ServerConfig.objects.get_or_create(key="retention_policy", defaults={"value": {}})
        config.value      = request.data
        config.updated_by = request.user.username
        config.save()
        logger.debug("RetentionConfigView retention policy updated")
        audit_log(request, action="RETENTION_UPDATE", resource="config")
        return Response(config.value)
