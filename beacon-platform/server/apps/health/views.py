"""
Beacon Health Views — /api/v1/health/
"""
import logging
from rest_framework import serializers
from rest_framework.views import APIView
from rest_framework.response import Response
from django.utils import timezone

from apps.auth_rbac.permissions import IsViewer
from .models import ServerHealth

logger = logging.getLogger("beacon")


class ServerHealthSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ServerHealth
        fields = "__all__"


class HealthStatusView(APIView):
    permission_classes = [IsViewer]

    def get(self, request):
        logger.debug("HealthStatusView GET — user=%s", request.user)
        from apps.agents.models import Agent, AgentStatus
        total    = Agent.objects.count()
        online   = Agent.objects.filter(status=AgentStatus.ONLINE).count()
        degraded = Agent.objects.filter(status=AgentStatus.DEGRADED).count()
        offline  = Agent.objects.filter(status=AgentStatus.OFFLINE).count()
        logger.debug("HealthStatusView agents total=%s online=%s degraded=%s offline=%s", total, online, degraded, offline)

        try:
            latest   = ServerHealth.objects.latest()
            snapshot = ServerHealthSerializer(latest).data
        except ServerHealth.DoesNotExist:
            snapshot = {}

        return Response({
            "server_status": "ONLINE",
            "timestamp":     timezone.now().isoformat(),
            "agents": {
                "total":    total,
                "online":   online,
                "degraded": degraded,
                "offline":  offline,
            },
            "latest_snapshot": snapshot,
        })


class AgentHealthView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id):
        logger.debug("AgentHealthView GET — agent_id=%s user=%s", agent_id, request.user)
        from apps.agents.models import Agent
        try:
            agent = Agent.objects.prefetch_related("collector_health").get(agent_id=agent_id)
        except Agent.DoesNotExist:
            logger.debug("AgentHealthView agent not found: %s", agent_id)
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
        logger.debug("AgentHealthView returning health for %s with %d collectors", agent_id, len(collectors))
        return Response({
            "agent_id":   agent.agent_id,
            "hostname":   agent.hostname,
            "status":     agent.status,
            "last_seen":  agent.last_seen,
            "is_stale":   agent.is_stale,
            "collectors": collectors,
        })
