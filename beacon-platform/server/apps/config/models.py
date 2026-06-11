"""
Beacon Config Models
"""
from django.db import models


class ServerConfig(models.Model):
    """Key/value server configuration store."""
    key         = models.CharField(max_length=128, unique=True)
    value       = models.JSONField()
    encrypted   = models.BooleanField(default=False)
    updated_by  = models.CharField(max_length=150, blank=True)
    updated_at  = models.DateTimeField(auto_now=True)
    description = models.TextField(blank=True)

    class Meta:
        db_table = "beacon_server_config"
        ordering = ["key"]

    def __str__(self):
        return f"{self.key} = {self.value}"
