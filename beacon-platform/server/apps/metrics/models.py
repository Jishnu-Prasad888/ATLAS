"""
Beacon Metrics Models
Tiered retention:
  Raw    — 1s  interval, 24h  retention
  Rollup — 1m  interval, 30d  retention
  Rollup — 1h  interval, 365d retention
"""
from django.db import models


class MetricResolution(models.TextChoices):
    RAW    = "raw",    "Raw (1s)"
    MIN1   = "1min",   "1 Minute Rollup"
    HOUR1  = "1hour",  "1 Hour Rollup"


class MetricType(models.TextChoices):
    CPU         = "cpu",         "CPU"
    RAM         = "ram",         "RAM"
    STORAGE     = "storage",     "Storage"
    NETWORK     = "network",     "Network"
    PROCESS     = "process",     "Process"
    SYSTEMD     = "systemd",     "Systemd"
    DOCKER      = "docker",      "Docker"
    KUBERNETES  = "kubernetes",  "Kubernetes"
    KERNEL      = "kernel",      "Kernel"
    TEMPERATURE = "temperature", "Temperature"
    POWER       = "power",       "Power"


class Metric(models.Model):
    """
    Single metric data point from an agent.
    JSON payload carries the actual measurements.
    """
    agent_id    = models.CharField(max_length=128, db_index=True)
    metric_type = models.CharField(max_length=32,  choices=MetricType.choices, db_index=True)
    resolution  = models.CharField(max_length=8,   choices=MetricResolution.choices, default=MetricResolution.RAW, db_index=True)
    timestamp   = models.DateTimeField(db_index=True)
    data        = models.JSONField()                   # Actual measurement payload
    schema_version = models.CharField(max_length=16, default="1.0")

    class Meta:
        db_table = "beacon_metrics"
        indexes  = [
            models.Index(fields=["agent_id", "metric_type", "timestamp"]),
            models.Index(fields=["agent_id", "resolution", "timestamp"]),
        ]
        ordering = ["-timestamp"]

    def __str__(self):
        return f"{self.agent_id[:8]} | {self.metric_type} | {self.timestamp}"


class MetricConfig(models.Model):
    """Per-agent collector configuration."""
    agent_id        = models.CharField(max_length=128, unique=True, db_index=True)
    cpu_enabled     = models.BooleanField(default=True)
    ram_enabled     = models.BooleanField(default=True)
    storage_enabled = models.BooleanField(default=True)
    network_enabled = models.BooleanField(default=True)
    process_enabled = models.BooleanField(default=True)
    systemd_enabled = models.BooleanField(default=True)
    docker_enabled  = models.BooleanField(default=False)
    kubernetes_enabled = models.BooleanField(default=False)
    temperature_enabled = models.BooleanField(default=True)
    power_enabled   = models.BooleanField(default=False)
    interval_seconds = models.PositiveIntegerField(default=5)
    retention_days   = models.PositiveIntegerField(default=30)
    updated_at       = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beacon_metric_config"

    def to_dict(self):
        return {
            "cpu":         self.cpu_enabled,
            "ram":         self.ram_enabled,
            "storage":     self.storage_enabled,
            "network":     self.network_enabled,
            "process":     self.process_enabled,
            "systemd":     self.systemd_enabled,
            "docker":      self.docker_enabled,
            "kubernetes":  self.kubernetes_enabled,
            "temperature": self.temperature_enabled,
            "power":       self.power_enabled,
            "interval_seconds": self.interval_seconds,
            "retention_days":   self.retention_days,
        }
