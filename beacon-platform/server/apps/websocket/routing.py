"""
Beacon WebSocket URL Routing
"""
from django.urls import re_path
from .consumers import AgentIngestConsumer, ClientSubscribeConsumer

websocket_urlpatterns = [
    re_path(r"^ws/ingest/$",    AgentIngestConsumer.as_asgi(),    name="ws-agent-ingest"),
    re_path(r"^ws/subscribe/$", ClientSubscribeConsumer.as_asgi(), name="ws-client-subscribe"),
]
