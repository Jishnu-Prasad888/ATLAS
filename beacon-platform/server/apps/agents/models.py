"""
Beacon Agent Models
"""
import hashlib
import secrets
from django.db import models
from django.utils import timezone


class AgentStatus(models.TextChoices):
    BOOTING           = "BOOTING",           "Booting"
    INITIALIZING      = "INITIALIZING",      "Initializing"
    ONLINE            = "ONLINE",            "Online"
    DEGRADED          = "DEGRADED",          "Degraded"
    OFFLINE_BUFFERING = "OFFLINE_BUFFERING", "Offline (Buffering)"
    RECOVERING        = "RECOVERING",        "Recovering"
    FAILED            = "FAILED",            "Failed"
    SHUTTING_DOWN     = "SHUTTING_DOWN",     "Shutting Down"
    OFFLINE           = "OFFLINE",           "Offline"


class Agent(models.Model):
    agent_id      = models.CharField(max_length=128, unique=True, db_index=True)
    hostname      = models.CharField(max_length=253)
    os            = models.CharField(max_length=64,  default="linux")
    architecture  = models.CharField(max_length=32,  default="x86_64")
    version       = models.CharField(max_length=32,  default="unknown")
    tags          = models.JSONField(default=list, blank=True)
    status        = models.CharField(max_length=32, choices=AgentStatus.choices, default=AgentStatus.OFFLINE)
    is_active     = models.BooleanField(default=True)
    secret_hash   = models.CharField(max_length=256, blank=True)
    registered_at = models.DateTimeField(auto_now_add=True)
    last_seen     = models.DateTimeField(null=True, blank=True)
    updated_at    = models.DateTimeField(auto_now=True)
    metadata      = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "beacon_agents"
        ordering = ["-last_seen"]

    def __str__(self):
        return f"{self.hostname} ({self.agent_id[:12]}...)"

    def touch(self):
        self.last_seen = timezone.now()
        self.save(update_fields=["last_seen"])

    def set_secret(self, raw_secret: str):
        self.secret_hash = hashlib.sha256(raw_secret.encode()).hexdigest()
        self.save(update_fields=["secret_hash"])

    def verify_secret(self, raw_secret: str) -> bool:
        return self.secret_hash == hashlib.sha256(raw_secret.encode()).hexdigest()

    def mark_online(self):
        self.status    = AgentStatus.ONLINE
        self.last_seen = timezone.now()
        self.save(update_fields=["status", "last_seen"])

    def mark_offline(self):
        self.status = AgentStatus.OFFLINE
        self.save(update_fields=["status"])

    @property
    def is_stale(self):
        from django.conf import settings
        timeout = getattr(settings, "BEACON_AGENT_HEARTBEAT_TIMEOUT", 60)
        if not self.last_seen:
            return True
        return (timezone.now() - self.last_seen).total_seconds() > timeout


class CollectorStatus(models.TextChoices):
    HEALTHY  = "Healthy",  "Healthy"
    DEGRADED = "Degraded", "Degraded"
    FAILED   = "Failed",   "Failed"
    DISABLED = "Disabled", "Disabled"


class CollectorHealth(models.Model):
    agent         = models.ForeignKey(Agent, on_delete=models.CASCADE, related_name="collector_health")
    collector     = models.CharField(max_length=64)
    status        = models.CharField(max_length=16, choices=CollectorStatus.choices, default=CollectorStatus.HEALTHY)
    last_run      = models.DateTimeField(null=True, blank=True)
    last_success  = models.DateTimeField(null=True, blank=True)
    last_failure  = models.DateTimeField(null=True, blank=True)
    failure_count = models.PositiveIntegerField(default=0)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table        = "beacon_collector_health"
        unique_together = [("agent", "collector")]

    def __str__(self):
        return f"{self.agent.hostname}:{self.collector} → {self.status}"


class ProcessKillRequest(models.Model):
    class Status(models.TextChoices):
        PENDING    = "pending", "Pending"
        DISPATCHED = "dispatched", "Dispatched"
        COMPLETED  = "completed", "Completed"
        FAILED     = "failed", "Failed"

    agent_id     = models.CharField(max_length=128, db_index=True)
    pid          = models.IntegerField()
    status       = models.CharField(max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True)
    error        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "beacon_process_kill_requests"
        indexes = [models.Index(fields=["agent_id", "status", "created_at"])]

    def mark_dispatched(self):
        self.status = self.Status.DISPATCHED
        self.dispatched_at = timezone.now()
        self.save(update_fields=["status", "dispatched_at"])

    def mark_completed(self):
        self.status = self.Status.COMPLETED
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "completed_at"])

    def mark_failed(self, error: str):
        self.status = self.Status.FAILED
        self.error = error
        self.completed_at = timezone.now()
        self.save(update_fields=["status", "error", "completed_at"])
