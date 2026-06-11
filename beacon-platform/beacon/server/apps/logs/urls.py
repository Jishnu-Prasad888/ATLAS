"""
Logs URLs — /api/v1/logs/
"""
from django.urls import path
from .views import LogListView, LogIngestView, LogExportView, LogClearView

urlpatterns = [
    path("",        LogListView.as_view(),   name="log-list"),
    path("ingest/", LogIngestView.as_view(), name="log-ingest"),
    path("export/", LogExportView.as_view(), name="log-export"),
    path("clear/",  LogClearView.as_view(),  name="log-clear"),
]
