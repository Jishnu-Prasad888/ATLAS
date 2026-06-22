from django.urls import path
from .views import AuditLogListView, AuditLogExportView, AuditLogIngestView

urlpatterns = [
    path("",        AuditLogListView.as_view(),    name="audit-list"),
    path("ingest/", AuditLogIngestView.as_view(),  name="audit-ingest"),
    path("export/", AuditLogExportView.as_view(),  name="audit-export"),
]
