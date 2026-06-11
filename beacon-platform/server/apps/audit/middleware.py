"""
Beacon Audit Middleware
Automatically logs write operations (POST, PUT, PATCH, DELETE).
"""
import logging
from .models import AuditLog

logger = logging.getLogger("beacon")

WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PATHS    = {"/health/", "/api/v1/auth/refresh/"}


class AuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if (
            request.method in WRITE_METHODS
            and request.path not in SKIP_PATHS
            and response.status_code < 500
        ):
            try:
                user = "anonymous"
                if hasattr(request, "user") and request.user and request.user.is_authenticated:
                    user = request.user.username

                ip = (
                    request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
                    or request.META.get("REMOTE_ADDR", "")
                ) or None

                # Derive resource from URL path
                parts    = [p for p in request.path.strip("/").split("/") if p]
                resource = parts[2] if len(parts) >= 3 else request.path

                AuditLog.objects.create(
                    user        = user,
                    ip_address  = ip,
                    action      = f"HTTP_{request.method}",
                    resource    = resource,
                    resource_id = parts[-1] if len(parts) > 3 else "",
                    details     = {"path": request.path, "status": response.status_code},
                    success     = response.status_code < 400,
                )
            except Exception as e:
                logger.debug(f"Middleware audit skip: {e}")

        return response
