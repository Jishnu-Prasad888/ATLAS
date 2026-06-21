from django.apps import AppConfig

class AgentsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.agents"
    label = "agents"
    verbose_name = "Beacon Agents"

    def ready(self):  # pragma: no cover - import side-effects only
        # Register signal handlers
        import apps.agents.signals  # noqa: F401
