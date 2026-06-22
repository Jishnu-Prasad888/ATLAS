"""
Beacon Agents Views — /api/v1/agents/
"""
import logging
from django.conf import settings
from django.utils import timezone
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.auth_rbac.permissions import (
    AgentSharedSecretPermission,
    IsAdministrator,
    IsAdminOrReadOnly,
    IsViewer,
    IsModeratorOrAdmin,
)
from apps.audit.utils import audit_log
from apps.auth_rbac.models import UserAgentAccess, OrganizationAgent, UserOrganizationAccess
from .models import Agent, AgentStatus, CollectorHealth, CollectorStatus, ProcessKillRequest
from .serializers import (
    AgentSerializer,
    AgentRegisterSerializer,
    AgentRenameSerializer,
    CollectorHealthUpdateSerializer,
)

logger = logging.getLogger("beacon")
channel_layer = get_channel_layer()

VALID_STATUSES = [s.value for s in AgentStatus]


def _allowed_agent_ids(user):
    if not user or not getattr(user, "is_authenticated", False):
        return set()

    cached = getattr(user, "_allowed_agent_ids_cache", None)
    if cached is not None:
        return cached

    if user.role == "administrator" or getattr(user, "access_all_agents", False):
        user._allowed_agent_ids_cache = None
        return None  # None means all

    agent_ids = set(UserAgentAccess.objects.filter(user=user).values_list("agent_id", flat=True))
    org_ids = UserOrganizationAccess.objects.filter(user=user).values_list("organization_id", flat=True)
    if org_ids:
        agent_ids.update(OrganizationAgent.objects.filter(organization_id__in=org_ids).values_list("agent_id", flat=True))

    user._allowed_agent_ids_cache = agent_ids
    return agent_ids


class AgentListView(APIView):
    permission_classes = [IsViewer]

    def _filter_by_scope(self, request, qs):
        allowed = _allowed_agent_ids(request.user)
        if allowed is None:
            return qs
        return qs.filter(agent_id__in=allowed) if allowed else qs.none()

    def get(self, request):
        logger.debug("AgentListView GET — user=%s", request.user)
        agents = Agent.objects.prefetch_related("collector_health").all()
        agents = self._filter_by_scope(request, agents)
        tag    = request.query_params.get("tag")
        if tag:
            logger.debug("AgentListView filtering by tag=%s", tag)
            agents = agents.filter(tags__contains=[tag])
        status_filter = request.query_params.get("status")
        if status_filter:
            logger.debug("AgentListView filtering by status=%s", status_filter)
            agents = agents.filter(status=status_filter)
        logger.debug("AgentListView returning %d agents", agents.count())
        return Response(AgentSerializer(agents, many=True).data)


class AgentDetailView(APIView):
    permission_classes = [IsViewer]

    def get_agent(self, agent_id):
        try:
            return Agent.objects.prefetch_related("collector_health").get(agent_id=agent_id)
        except Agent.DoesNotExist:
            logger.debug("AgentDetailView agent not found: %s", agent_id)
            return None

    def get(self, request, agent_id):
        logger.debug("AgentDetailView GET — agent_id=%s user=%s", agent_id, request.user)
        agent = self.get_agent(agent_id)
        if not agent:
            return Response({"detail": "Agent not found."}, status=404)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        return Response(AgentSerializer(agent).data)

    def delete(self, request, agent_id):
        logger.debug("AgentDetailView DELETE — agent_id=%s user=%s", agent_id, request.user)
        if request.user.role not in ("administrator", "moderator"):
            return Response({"detail": "Insufficient permissions."}, status=403)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        agent = self.get_agent(agent_id)
        if not agent:
            return Response({"detail": "Agent not found."}, status=404)
        agent.delete()
        logger.debug("AgentDetailView agent %s deleted", agent_id)
        audit_log(request, action="AGENT_REMOVE", resource="agents", resource_id=agent_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class AgentEnableDisableView(APIView):
    permission_classes = [IsModeratorOrAdmin]

    def post(self, request, agent_id, action):
        logger.debug("AgentEnableDisableView POST — agent_id=%s action=%s user=%s", agent_id, action, request.user)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            logger.debug("AgentEnableDisableView agent not found: %s", agent_id)
            return Response({"detail": "Agent not found."}, status=404)
        if action == "enable":
            agent.is_active = True
        elif action == "disable":
            agent.is_active = False
        else:
            logger.debug("AgentEnableDisableView invalid action: %s", action)
            return Response({"detail": "Action must be enable or disable."}, status=400)
        agent.save(update_fields=["is_active"])
        logger.debug("AgentEnableDisableView agent %s is_active set to %s", agent_id, agent.is_active)
        audit_log(request, action=f"AGENT_{action.upper()}", resource="agents", resource_id=agent_id)
        return Response(AgentSerializer(agent).data)


class AgentRenameView(APIView):
    permission_classes = [IsModeratorOrAdmin]

    def post(self, request, agent_id):
        logger.debug("AgentRenameView POST — agent_id=%s user=%s", agent_id, request.user)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            logger.debug("AgentRenameView agent not found: %s", agent_id)
            return Response({"detail": "Agent not found."}, status=404)
        serializer = AgentRenameSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        old_name      = agent.hostname
        agent.hostname = serializer.validated_data["hostname"]
        agent.save(update_fields=["hostname"])
        logger.debug("AgentRenameView agent %s renamed from %s to %s", agent_id, old_name, agent.hostname)
        audit_log(request, action="AGENT_RENAME", resource="agents", resource_id=agent_id,
                  details={"old": old_name, "new": agent.hostname})
        return Response(AgentSerializer(agent).data)


class AgentRegenerateIdView(APIView):
    permission_classes = [IsModeratorOrAdmin]

    def post(self, request, agent_id):
        logger.debug("AgentRegenerateIdView POST — agent_id=%s user=%s", agent_id, request.user)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        try:
            agent = Agent.objects.get(agent_id=agent_id)
        except Agent.DoesNotExist:
            logger.debug("AgentRegenerateIdView agent not found: %s", agent_id)
            return Response({"detail": "Agent not found."}, status=404)
        import secrets
        new_id     = f"regen-{secrets.token_hex(16)}"
        old_id     = agent.agent_id
        agent.agent_id = new_id
        agent.save(update_fields=["agent_id"])
        logger.debug("AgentRegenerateIdView agent %s regenerated to %s", old_id, new_id)
        audit_log(request, action="AGENT_REGEN_ID", resource="agents", resource_id=old_id,
                  details={"new_agent_id": new_id})
        return Response({"agent_id": new_id, "warning": "Update the agent configuration with the new ID."})


class AgentRegisterView(APIView):
    permission_classes = []

    def post(self, request):
        expected_secret = getattr(settings, "BEACON_AGENT_SECRET", "").strip()
        provided_secret = str(request.data.get("secret", "")).strip()
        if not expected_secret or provided_secret != expected_secret:
            logger.debug("AgentRegisterView secret mismatch for agent_id=%s", request.data.get("agent_id"))
            return Response({"detail": "Invalid agent secret."}, status=403)

        serializer = AgentRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        logger.debug("AgentRegisterView POST — agent_id=%s hostname=%s", data["agent_id"], data["hostname"])
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
        logger.debug("AgentRegisterView action=%s for agent %s", action, data["agent_id"])
        audit_log(request, action=action, resource="agents", resource_id=data["agent_id"])
        return Response(AgentSerializer(agent).data, status=201 if created else 200)


class AgentHeartbeatView(APIView):
    permission_classes = [AgentSharedSecretPermission]

    def post(self, request, agent_id):
        logger.debug("AgentHeartbeatView POST — agent_id=%s", agent_id)
        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
        except Agent.DoesNotExist:
            logger.debug("AgentHeartbeatView agent not found or disabled: %s", agent_id)
            return Response({"detail": "Agent not found or disabled."}, status=404)
        agent.touch()
        new_status = request.data.get("status")
        if new_status and new_status in VALID_STATUSES:
            logger.debug("AgentHeartbeatView updating status to %s", new_status)
            agent.status = new_status
            agent.save(update_fields=["status", "last_seen"])
        logger.debug("AgentHeartbeatView ack for %s", agent_id)
        return Response({"ack": True, "server_time": timezone.now().isoformat()})


class AgentCollectorHealthView(APIView):
    permission_classes = [AgentSharedSecretPermission]

    def post(self, request, agent_id):
        logger.debug("AgentCollectorHealthView POST — agent_id=%s", agent_id)
        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
        except Agent.DoesNotExist:
            logger.debug("AgentCollectorHealthView agent not found: %s", agent_id)
            return Response({"detail": "Agent not found."}, status=404)
        serializer = CollectorHealthUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        d = serializer.validated_data
        logger.debug("AgentCollectorHealthView updating collector %s for agent %s", d.get("collector"), agent_id)
        CollectorHealth.objects.update_or_create(
            agent=agent, collector=d["collector"],
            defaults={k: v for k, v in d.items() if k != "collector"},
        )
        return Response({"ack": True})


class AgentKillProcessView(APIView):
    """POST /api/v1/agents/<agent_id>/kill_process/ { pid: int }
    Dispatches a kill command to the agent via WebSocket. Requires administrator.
    """
    permission_classes = [IsModeratorOrAdmin]

    def post(self, request, agent_id):
        logger.debug("AgentKillProcessView POST — agent_id=%s user=%s", agent_id, request.user)
        allowed = _allowed_agent_ids(request.user)
        if allowed is not None and agent_id not in allowed:
            return Response({"detail": "Not authorized for this agent."}, status=403)
        pid = request.data.get("pid")
        if pid is None:
            return Response({"error": "pid is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            pid_int = int(pid)
        except (TypeError, ValueError):
            return Response({"error": "pid must be an integer"}, status=status.HTTP_400_BAD_REQUEST)

        req = ProcessKillRequest.objects.create(agent_id=agent_id, pid=pid_int, status=ProcessKillRequest.Status.PENDING)
        safe_id = agent_id.replace(":", "_").replace("#", "_").replace(" ", "_")
        try:
            async_to_sync(channel_layer.group_send)(
                f"agent_{safe_id}",
                {
                    "type": "agent.command",
                    "data": {
                        "type": "process_kill",
                        "payload": {"pid": pid_int, "request_id": req.id},
                    },
                },
            )
            req.mark_dispatched()
            audit_log(request, action="AGENT_KILL_PROCESS", resource="agents", resource_id=agent_id,
                      details={"pid": pid_int, "request_id": req.id})
        except Exception as exc:  # pragma: no cover
            logger.warning("AgentKillProcessView failed to dispatch: %s", exc)
            req.mark_failed(str(exc))
            return Response({"error": "failed to dispatch"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"status": req.status, "pid": pid_int, "request_id": req.id}, status=status.HTTP_202_ACCEPTED)


class AgentKillProcessResultView(APIView):
    """POST /api/v1/agents/<agent_id>/kill_process_result/
    Payload: { pid: int, status: completed|failed, request_id?: int, error?: str }
    """
    permission_classes = [AgentSharedSecretPermission]  # trusted agent callback; network-controlled

    def post(self, request, agent_id):
        pid = request.data.get("pid")
        status_val = request.data.get("status")
        req_id = request.data.get("request_id")
        error_msg = request.data.get("error", "")

        if pid is None or status_val not in ProcessKillRequest.Status.values:
            return Response({"error": "pid and valid status are required"}, status=status.HTTP_400_BAD_REQUEST)

        req = None
        if req_id is not None:
            try:
                req = ProcessKillRequest.objects.get(id=req_id, agent_id=agent_id)
            except ProcessKillRequest.DoesNotExist:
                req = None

        if req is None:
            # Create a record if none exists to retain audit trail
            req = ProcessKillRequest.objects.create(
                agent_id=agent_id,
                pid=pid,
                status=ProcessKillRequest.Status.PENDING,
            )

        if status_val == ProcessKillRequest.Status.COMPLETED:
            req.mark_completed()
        elif status_val == ProcessKillRequest.Status.FAILED:
            req.mark_failed(error_msg or "failed")
        else:
            req.status = status_val
            req.save(update_fields=["status"])

        audit_log(request, action="AGENT_KILL_PROCESS_RESULT", resource="agents", resource_id=agent_id,
                  details={"pid": pid, "request_id": req.id, "status": status_val, "error": error_msg})

        return Response({"status": req.status, "request_id": req.id})
