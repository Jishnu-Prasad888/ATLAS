"""
Metrics Config URLs — /api/v1/metrics/
"""
from django.urls import path
from .views import MetricConfigView

urlpatterns = [
    path("config/<str:agent_id>/", MetricConfigView.as_view(), name="metric-config"),
]
