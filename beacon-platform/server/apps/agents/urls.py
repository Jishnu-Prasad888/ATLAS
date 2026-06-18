"""
Beacon Agents URLs — /api/v1/agents/
"""
from django.urls import path
from .views import (
    AgentListView,
    AgentDetailView,
    AgentEnableDisableView,
    AgentRenameView,
    AgentRegenerateIdView,
    AgentRegisterView,
    AgentHeartbeatView,
    AgentCollectorHealthView,
    AgentKillProcessView,
    AgentKillProcessResultView,
)

urlpatterns = [
    path("",                                     AgentListView.as_view(),            name="agent-list"),
    path("register/",                            AgentRegisterView.as_view(),         name="agent-register"),
    path("<str:agent_id>/",                      AgentDetailView.as_view(),           name="agent-detail"),
    path("<str:agent_id>/heartbeat/",            AgentHeartbeatView.as_view(),        name="agent-heartbeat"),
    path("<str:agent_id>/rename/",               AgentRenameView.as_view(),           name="agent-rename"),
    path("<str:agent_id>/regenerate-id/",        AgentRegenerateIdView.as_view(),     name="agent-regen-id"),
    path("<str:agent_id>/kill_process/",         AgentKillProcessView.as_view(),      name="agent-kill-process"),
    path("<str:agent_id>/kill_process_result/",  AgentKillProcessResultView.as_view(),name="agent-kill-process-result"),
    path("<str:agent_id>/collectors/health/",    AgentCollectorHealthView.as_view(),  name="agent-collector-health"),
    path("<str:agent_id>/<str:action>/",         AgentEnableDisableView.as_view(),    name="agent-enable-disable"),
]
