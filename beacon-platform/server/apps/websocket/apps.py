from django.apps import AppConfig

class WebsocketConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.websocket"
    label = "websocket"
    verbose_name = "Beacon WebSocket"
