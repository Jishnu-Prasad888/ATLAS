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
        user = getattr(request, "user", None)
        return _is_active_and_approved(user) and user.role == Role.ADMINISTRATOR


def _is_active_and_approved(user):
    return (
        user
        and getattr(user, "is_authenticated", False)
        and getattr(user, "is_active", False)
        and getattr(user, "approval_status", "approved") == "approved"
    )


class IsModeratorOrAdmin(BasePermission):
    """Allow moderators and administrators who are active and approved."""
    message = "Moderator or administrator role required."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return _is_active_and_approved(user) and user.role in (Role.ADMINISTRATOR, Role.MODERATOR)


class IsViewer(BasePermission):
    """Approved, active users with viewer/guest or higher roles."""
    message = "Authentication required."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return _is_active_and_approved(user) and user.role in (Role.VIEWER, Role.ADMINISTRATOR, Role.MODERATOR, Role.GUEST)


class IsApproved(BasePermission):
    """Require approved users (pending/rejected blocked)."""
    message = "Account pending approval."

    def has_permission(self, request, view):
        user = getattr(request, "user", None)
        return _is_active_and_approved(user)


class IsAdminOrReadOnly(BasePermission):
    """
    Administrators get full access.
    Viewers get read-only (GET, HEAD, OPTIONS).
    """
    SAFE_METHODS = ("GET", "HEAD", "OPTIONS")

    def has_permission(self, request, view):
        if not _is_active_and_approved(getattr(request, "user", None)):
            return False
        if request.method in self.SAFE_METHODS:
            return True
        return request.user.role in (Role.ADMINISTRATOR,)


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


class AgentSharedSecretPermission(BasePermission):
    """Validates X-Beacon-Agent-Secret against server and agent secrets."""
    message = "Agent shared secret required."

    def has_permission(self, request, view):  # noqa: PLR0911 - simple branching
        from django.conf import settings
        from apps.agents.models import Agent

        provided = request.headers.get("X-Beacon-Agent-Secret", "").strip()
        if not provided:
            return False

        expected = getattr(settings, "BEACON_AGENT_SECRET", "").strip()
        if expected and provided == expected:
            return True

        agent_id = request.headers.get("X-Agent-ID", "").strip()
        if not agent_id:
            return False

        try:
            agent = Agent.objects.get(agent_id=agent_id, is_active=True)
            return agent.secret_hash != "" and agent.verify_secret(provided)
        except Agent.DoesNotExist:
            return False
