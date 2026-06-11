"""
Beacon Log Models
Stores structured log events from agents (journald, syslog, kernel, docker, k8s, internal).
"""
from django.db import models


class LogSeverity(models.TextChoices):
    TRACE    = "Trace",    "Trace"
    DEBUG    = "Debug",    "Debug"
    INFO     = "Info",     "Info"
    WARNING  = "Warning",  "Warning"
    ERROR    = "Error",    "Error"
    CRITICAL = "Critical", "Critical"


class LogSource(models.TextChoices):
    JOURNALD = "systemd-journald", "Systemd Journald"
    SYSLOG   = "syslog",           "Syslog"
    KERNEL   = "kernel",           "Kernel"
    DOCKER   = "docker",           "Docker"
    K8S      = "kubernetes",       "Kubernetes"
    INTERNAL = "internal",         "Beacon Internal"


class LogEntry(models.Model):
    """
    Immutable structured log record from an agent.
    Schema: { timestamp, agent_id, source, severity, message }
    """
    agent_id       = models.CharField(max_length=128, db_index=True)
    source         = models.CharField(max_length=64,  choices=LogSource.choices, db_index=True)
    severity       = models.CharField(max_length=16,  choices=LogSeverity.choices, db_index=True)
    message        = models.TextField()
    timestamp      = models.DateTimeField(db_index=True)
    schema_version = models.CharField(max_length=16,  default="1.0")
    # Extra structured fields (unit name, container id, pod name, etc.)
    extra          = models.JSONField(default=dict, blank=True)
    sequence_number = models.BigIntegerField(null=True, blank=True)

    class Meta:
        db_table = "beacon_logs"
        indexes  = [
            models.Index(fields=["agent_id", "severity", "timestamp"]),
            models.Index(fields=["agent_id", "source",   "timestamp"]),
        ]
        ordering = ["-timestamp"]

    def __str__(self):
        return f"[{self.severity}] {self.agent_id[:8]} | {self.message[:60]}"
