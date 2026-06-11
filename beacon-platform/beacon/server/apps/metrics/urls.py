"""
Metrics URLs — /api/v1/telemetry/
"""
from django.urls import path
from .views import MetricIngestView, MetricListView, MetricLatestView, MetricPruneView

urlpatterns = [
    path("",                          MetricListView.as_view(),    name="metric-list"),
    path("ingest/",                   MetricIngestView.as_view(),  name="metric-ingest"),
    path("prune/",                    MetricPruneView.as_view(),   name="metric-prune"),
    path("latest/<str:agent_id>/",    MetricLatestView.as_view(),  name="metric-latest"),
]
