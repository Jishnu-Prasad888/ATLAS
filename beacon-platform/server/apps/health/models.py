"""
Beacon Health Models
"""
from django.db import models


class ServerHealth(models.Model):
    """Beacon server self-reported health snapshot."""
    timestamp       = models.DateTimeField(auto_now_add=True)
    status          = models.CharField(max_length=32, default="ONLINE")
    agents_online   = models.IntegerField(default=0)
    agents_total    = models.IntegerField(default=0)
    metrics_rate    = models.FloatField(default=0.0)
    logs_rate       = models.FloatField(default=0.0)
    db_size_bytes   = models.BigIntegerField(default=0)
    details         = models.JSONField(default=dict)

    class Meta:
        db_table    = "beacon_server_health"
        ordering    = ["-timestamp"]
        get_latest_by = "timestamp"
