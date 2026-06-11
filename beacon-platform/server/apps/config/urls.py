from django.urls import path
from .views import ConfigListView, ConfigDetailView, RetentionConfigView

urlpatterns = [
    path("",             ConfigListView.as_view(),     name="config-list"),
    path("retention/",   RetentionConfigView.as_view(), name="config-retention"),
    path("<str:key>/",   ConfigDetailView.as_view(),   name="config-detail"),
]
