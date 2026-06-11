"""
Beacon Agents Views — /api/v1/agents/
"""
import logging
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.auth_rbac.permissions import IsAdministrator, IsAdminOrReadOnly, IsViewer
from apps.audit.utils import audit_log
from .models import Agent, AgentStatus, CollectorHealth, CollectorStatus
from .serializers import (
    AgentSerializer,
    AgentRegisterSerializer,
    AgentRenameSerializer,
    CollectorHealthUpdateSerializer,
)

logger = logging.getLogger("beacon")

VALID_STATUSES = [s.value for s in AgentStatus]


class AgentListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request):
        agents = Agent.objects.prefetch_related("collector_health").all()
        tag    = request.query_params.get("tag")
        if tag:
            agents = agents.filter(tags__contains=[tag])
        status_filter = request.query_params.get("status")
        if status_filter:
            agents = agents.filter(status=status_filter)
        return Response(AgentSerializer(agents, many=True).data)


class AgentDetailView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get_agent(self, agent_id):
        try:
            return Agent.objects.prefetch_related("collector_health").get(agent_id=agent_id)
        except Agent.DoesNotExist:
            return None

    def get(self, request, agent_id):
        agent = self.get_agent(agent_id)
        if not agent:
            return Response({"detail": "Agent not found."}, status=404)
        return Response(AgentSerializer(agent).data)

    def delete(self, request, agent_id):
        agent = self.get_agent(agent_id)
        if not agent:
            return Response({"detail": "Agent not found."}, status=404)
        agent.delete()
        audit_log(request, action="AGENT_REMOVE", resource="agents", resource_id=agent_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AgentEnableDisableView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, agent_id, action):
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        if action == "enable":
            agent.is_active = True
        elif action == "disable":
            agent.is_active = False
        else:
            return Response({"detail": "Action must be enable or disable."}, status=400)
        agent.save(update_fields=["is_active"])
        audit_log(request, action=f"AGENT_{action.upper()}", resource="agents", resource_id=agent_id)
        return Response(AgentSerializer(agent).data)


class AgentRenameView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, agent_id):
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        serializer = AgentRenameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        old_name      = agent.hostname
        agent.hostname = serializer.validated_data["hostname"]
        agent.save(update_fields=["hostname"])
        audit_log(request, action="AGENT_RENAME", resource="agents", resource_id=agent_id,
                  details={"old": old_name, "new": agent.hostname})
        return Response(AgentSerializer(agent).data)


class AgentRegenerateIdView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, agent_id):
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        import secrets
        new_id     = f"regen-{secrets.token_hex(16)}"
        old_id     = agent.agent_id
        agent.agent_id = new_id
        agent.save(update_fields=["agent_id"])
        audit_log(request, action="AGENT_REGEN_ID", resource="agents", resource_id=old_id,
                  details={"new_agent_id": new_id})
        return Response({"agent_id": new_id, "warning": "Update the agent configuration with the new ID."})


class AgentRegisterView(APIView):
    permission_classes = []

    def post(self, request):
        serializer = AgentRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        agent, created = Agent.objects.update_or_create(
            agent_id=data["agent_id"],
            defaults={
                "hostname":     data["hostname"],
                "os":           data["os"],
                "architecture": data["architecture"],
                "version":      data["version"],
                "tags":         data["tags"],
                "metadata":     data["metadata"],
                "status":       AgentStatus.ONLINE,
                "last_seen":    timezone.now(),
            },
        )
        if data.get("secret"):
            agent.set_secret(data["secret"])

        action = "AGENT_REGISTER" if created else "AGENT_RECONNECT"
        audit_log(request, action=action, resource="agents", resource_id=data["agent_id"])
        return Response(AgentSerializer(agent).data, status=201 if created else 200)


class AgentHeartbeatView(APIView):
    permission_classes = []

    def post(self, request, agent_id):
        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found or disabled."}, status=404)
        agent.touch()
        new_status = request.data.get("status")
        if new_status and new_status in VALID_STATUSES:
            agent.status = new_status
            agent.save(update_fields=["status", "last_seen"])
        return Response({"ack": True, "server_time": timezone.now().isoformat()})


class AgentCollectorHealthView(APIView):
    permission_classes = []

    def post(self, request, agent_id):
        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
        except Agent.DoesNotExist:
            return Response({"detail": "Agent not found."}, status=404)
        serializer = CollectorHealthUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        CollectorHealth.objects.update_or_create(
            agent=agent, collector=d["collector"],
            defaults={k: v for k, v in d.items() if k != "collector"},
        )
        return Response({"ack": True})
