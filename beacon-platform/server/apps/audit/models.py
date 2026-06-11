"""
Beacon Audit Models
Immutable audit trail — every action is traceable.
Records cannot be deleted through the normal API.
"""
from django.db import models


class AuditLog(models.Model):
    """
    Immutable audit record. No update or delete through API.
    """
    timestamp   = models.DateTimeField(auto_now_add=True, db_index=True)
    user        = models.CharField(max_length=150, db_index=True)  # username snapshot
    ip_address  = models.GenericIPAddressField(null=True, blank=True)
    action      = models.CharField(max_length=64, db_index=True)  # LOGIN, AGENT_REMOVE, etc.
    resource    = models.CharField(max_length=64, db_index=True)  # agents, logs, users, auth
    resource_id = models.CharField(max_length=256, blank=True)    # entity identifier
    details     = models.JSONField(default=dict, blank=True)       # extra context
    success     = models.BooleanField(default=True)

    class Meta:
        db_table = "beacon_audit_log"
        ordering = ["-timestamp"]
        # Prevent any accidental updates at DB level
        managed  = True

    def __str__(self):
        return f"{self.timestamp} | {self.user} | {self.action} | {self.resource}"

    def save(self, *args, **kwargs):
        # Immutable: allow only INSERT (pk is None means new record)
        if self.pk:
            raise ValueError("Audit log records are immutable and cannot be updated.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Audit log records are immutable and cannot be deleted.")
