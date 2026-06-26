"""
Beacon WebSocket URL Routing
"""
from django.urls import re_path
from .consumers import ClientSubscribeConsumer

websocket_urlpatterns = [
    re_path(r"^ws/subscribe/$", ClientSubscribeConsumer.as_asgi(), name="ws-client-subscribe"),
]
