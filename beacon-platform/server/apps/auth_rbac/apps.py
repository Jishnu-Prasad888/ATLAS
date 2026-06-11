from django.apps import AppConfig

class AuthRbacConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name  = "apps.auth_rbac"
    label = "auth_rbac"
    verbose_name = "Beacon Auth & RBAC"
