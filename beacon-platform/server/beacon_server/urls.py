"""
Beacon Server — Main URL Configuration
All REST endpoints are under /api/v1/
"""
from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse


def health_check(request):
    return JsonResponse({"status": "ok", "service": "beacon-server"})


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health"),

    # API v1
    path("api/v1/auth/",      include("apps.auth_rbac.urls")),
    path("api/v1/users/",     include("apps.auth_rbac.user_urls")),
    path("api/v1/agents/",    include("apps.agents.urls")),
    path("api/v1/telemetry/", include("apps.metrics.urls")),
    path("api/v1/logs/",      include("apps.logs.urls")),
    path("api/v1/metrics/",   include("apps.metrics.urls_metrics")),
    path("api/v1/audit/",     include("apps.audit.urls")),
    path("api/v1/config/",    include("apps.config.urls")),
    path("api/v1/health/",    include("apps.health.urls")),
]
