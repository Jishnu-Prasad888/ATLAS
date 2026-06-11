"""
ASGI configuration for Beacon Server.
Handles both HTTP (Django) and WebSocket (Channels) traffic.
"""
import os
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "beacon_server.settings")

# Must call get_asgi_application() before importing channels/consumers
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from apps.websocket.middleware import JWTAuthMiddlewareStack
from apps.websocket import routing as ws_routing

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": AllowedHostsOriginValidator(
            JWTAuthMiddlewareStack(
                URLRouter(ws_routing.websocket_urlpatterns)
            )
        ),
    }
)
