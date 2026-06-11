from django.urls import path
from .views import HealthStatusView, AgentHealthView

urlpatterns = [
    path("",                       HealthStatusView.as_view(), name="health-status"),
    path("agents/<str:agent_id>/", AgentHealthView.as_view(),  name="health-agent"),
]
