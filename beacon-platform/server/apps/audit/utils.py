"""
Beacon Audit Utility
Central function for recording audit events.
"""
import logging
from .models import AuditLog

logger = logging.getLogger("beacon")


def audit_log(
    request,
    action: str,
    resource: str,
    resource_id: str = "",
    details: dict = None,
    success: bool = True,
):
    """
    Record an immutable audit event.
    Should be called after every significant action.
    """
    try:
        user = "anonymous"
        if hasattr(request, "user") and request.user and request.user.is_authenticated:
            user = request.user.username

        ip = (
            request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
            or request.META.get("REMOTE_ADDR", "")
        ) or None

        ua = request.META.get("HTTP_USER_AGENT", "") if hasattr(request, "META") else ""
        session_id = ""
        try:
            if hasattr(request, "session"):
                session_id = request.session.session_key or ""
        except Exception:
            session_id = ""

        AuditLog.objects.create(
            user        = user,
            ip_address  = ip,
            action      = action,
            resource    = resource,
            resource_id = resource_id,
            details     = details or {},
            success     = success,
            user_agent  = ua,
            device      = ua[:128],
            path        = getattr(request, "path", ""),
            method      = getattr(request, "method", ""),
            session_id  = session_id,
            approved_by = details.get("approved_by") if details else "",
        )
    except Exception as e:
        # Audit failures must never break the main flow
        logger.error(f"Audit log write failed: {e}")
