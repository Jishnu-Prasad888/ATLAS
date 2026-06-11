"""
Beacon RBAC Permission Classes.
Enforced at every boundary: CLI, TUI, REST API, WebSocket, DB Actions.
"""
from rest_framework.permissions import BasePermission
from .models import Role


class IsAdministrator(BasePermission):
    """Only Administrator role can access."""
    message = "Administrator role required."

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role == Role.ADMINISTRATOR
        )


class IsViewer(BasePermission):
    """Viewer or Administrator can access (read-only operations)."""
    message = "Authentication required."

    def has_permission(self, request, view):
        return (
            request.user
            and request.user.is_authenticated
            and request.user.role in (Role.VIEWER, Role.ADMINISTRATOR)
        )


class IsAdminOrReadOnly(BasePermission):
    """
    Administrators get full access.
    Viewers get read-only (GET, HEAD, OPTIONS).
    """
    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in self.SAFE_METHODS:
            return True
        return request.user.role == Role.ADMINISTRATOR


class IsAgentAuthenticated(BasePermission):
    """
    Special permission for agent WebSocket / ingest connections.
    Validated by agent_id + agent_secret header.
    """
    message = "Agent authentication required."

    def has_permission(self, request, view):
        agent_id     = request.headers.get("X-Agent-ID")
        agent_secret = request.headers.get("X-Agent-Secret")
        if not agent_id or not agent_secret:
            return False
        from apps.agents.models import Agent
        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
            return agent.verify_secret(agent_secret)
        except Agent.DoesNotExist:
            return False
