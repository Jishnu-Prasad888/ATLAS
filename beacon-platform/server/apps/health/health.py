"""
Beacon Health App
Server-side health tracking and status aggregation.
"""
from django.db import models
from django.apps import AppConfig
from django.urls import path
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import serializers
from django.utils import timezone

from apps.auth_rbac.permissions import IsViewer


# ─── Models ───────────────────────────────────────────────────────────────────

class ServerHealth(models.Model):
    """Beacon server self-reported health snapshot."""
    timestamp       = models.DateTimeField(auto_now_add=True)
    status          = models.CharField(max_length=32, default="ONLINE")
    agents_online   = models.IntegerField(default=0)
    agents_total    = models.IntegerField(default=0)
    metrics_rate    = models.FloatField(default=0.0)   # metrics/sec
    logs_rate       = models.FloatField(default=0.0)   # logs/sec
    db_size_bytes   = models.BigIntegerField(default=0)
    details         = models.JSONField(default=dict)

    class Meta:
        db_table = "beacon_server_health"
        ordering = ["-timestamp"]
        get_latest_by = "timestamp"


# ─── Serializers ──────────────────────────────────────────────────────────────

class ServerHealthSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ServerHealth
        fields = "__all__"


# ─── Views ────────────────────────────────────────────────────────────────────

class HealthStatusView(APIView):
    permission_classes = [IsViewer]

    def get(self, request):
        from apps.agents.models import Agent, AgentStatus
        total   = Agent.objects.count()
        online  = Agent.objects.filter(status=AgentStatus.ONLINE).count()
        degraded = Agent.objects.filter(status=AgentStatus.DEGRADED).count()
        offline  = Agent.objects.filter(status=AgentStatus.OFFLINE).count()

        try:
            latest = ServerHealth.objects.latest()
            snapshot = ServerHealthSerializer(latest).data
        except ServerHealth.DoesNotExist:
            snapshot = {}

        return Response({
            "server_status":    "ONLINE",
            "timestamp":        timezone.now().isoformat(),
            "agents": {
                "total":   total,
                "online":  online,
                "degraded": degraded,
                "offline": offline,
            },
            "latest_snapshot": snapshot,
        })


class AgentHealthView(APIView):
    """GET /api/v1/health/agents/<agent_id>/"""
    permission_classes = [IsViewer]

    def get(self, request, agent_id):
        from apps.agents.models import Agent, CollectorHealth
        try:
            agent = Agent.objects.prefetch_related("collector_health").get(agent_id=agent_id)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)

        collectors = {
            ch.collector: {
                "status":        ch.status,
                "last_run":      ch.last_run,
                "last_success":  ch.last_success,
                "failure_count": ch.failure_count,
            }
            for ch in agent.collector_health.all()
        }
        return Response({
            "agent_id":   agent.agent_id,
            "hostname":   agent.hostname,
            "status":     agent.status,
            "last_seen":  agent.last_seen,
            "is_stale":   agent.is_stale,
            "collectors": collectors,
        })


# ─── URLs ─────────────────────────────────────────────────────────────────────

urlpatterns = [
    path("",                        HealthStatusView.as_view(), name="health-status"),
    path("agents/<str:agent_id>/",  AgentHealthView.as_view(),  name="health-agent"),
]


# ─── App Config ───────────────────────────────────────────────────────────────

class HealthConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.health"
    label = "health"
    verbose_name = "Beacon Health"
