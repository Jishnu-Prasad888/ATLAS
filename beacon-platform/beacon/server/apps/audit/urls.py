from django.urls import path
from .views import AuditLogListView, AuditLogExportView

urlpatterns = [
    path("",       AuditLogListView.as_view(),   name="audit-list"),
    path("export/", AuditLogExportView.as_view(), name="audit-export"),
]
