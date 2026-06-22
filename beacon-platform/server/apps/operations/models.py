from django.db import models


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class DockerContainer(TimestampedModel):
    agent_id = models.CharField(max_length=128, db_index=True)
    container_id = models.CharField(max_length=128)
    name = models.CharField(max_length=255)
    image = models.CharField(max_length=255, blank=True)
    state = models.CharField(max_length=32, db_index=True)
    status = models.CharField(max_length=64, blank=True)
    health = models.CharField(max_length=32, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    cpu_pct = models.FloatField(null=True, blank=True)
    mem_pct = models.FloatField(null=True, blank=True)
    mem_bytes = models.BigIntegerField(null=True, blank=True)
    pids = models.IntegerField(null=True, blank=True)
    rx_bytes = models.BigIntegerField(default=0)
    tx_bytes = models.BigIntegerField(default=0)
    blk_read_bytes = models.BigIntegerField(default=0)
    blk_write_bytes = models.BigIntegerField(default=0)
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent_id", "container_id"], name="uniq_docker_container"),
        ]
        indexes = [
            models.Index(fields=["agent_id", "state"]),
        ]
        ordering = ["agent_id", "name"]

    def __str__(self):  # pragma: no cover - human-readable
        return f"{self.agent_id}:{self.name}"


class KubernetesPod(TimestampedModel):
    agent_id = models.CharField(max_length=128, db_index=True)
    uid = models.CharField(max_length=128)
    name = models.CharField(max_length=255)
    namespace = models.CharField(max_length=255, default="default")
    node = models.CharField(max_length=255, blank=True)
    phase = models.CharField(max_length=32, db_index=True)
    restart_count = models.IntegerField(default=0)
    started_at = models.DateTimeField(null=True, blank=True)
    labels = models.JSONField(default=dict, blank=True)
    annotations = models.JSONField(default=dict, blank=True)
    container_statuses = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent_id", "uid"], name="uniq_k8s_pod"),
        ]
        indexes = [
            models.Index(fields=["agent_id", "namespace", "phase"]),
        ]
        ordering = ["agent_id", "namespace", "name"]

    def __str__(self):  # pragma: no cover
        return f"{self.namespace}/{self.name}"


class NetworkInterface(TimestampedModel):
    agent_id = models.CharField(max_length=128, db_index=True)
    name = models.CharField(max_length=64)
    address = models.CharField(max_length=64, blank=True)
    mac = models.CharField(max_length=64, blank=True)
    mtu = models.IntegerField(null=True, blank=True)
    speed_mbps = models.IntegerField(null=True, blank=True)
    rx_bytes = models.BigIntegerField(default=0)
    tx_bytes = models.BigIntegerField(default=0)
    rx_errors = models.BigIntegerField(default=0)
    tx_errors = models.BigIntegerField(default=0)
    rx_dropped = models.BigIntegerField(default=0)
    tx_dropped = models.BigIntegerField(default=0)
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent_id", "name"], name="uniq_net_interface"),
        ]
        ordering = ["agent_id", "name"]

    def __str__(self):  # pragma: no cover
        return f"{self.agent_id}:{self.name}"


class NetworkConnection(TimestampedModel):
    TCP = "tcp"
    UDP = "udp"
    UNIX = "unix"
    PROTOCOL_CHOICES = [
        (TCP, "TCP"),
        (UDP, "UDP"),
        (UNIX, "UNIX"),
    ]

    agent_id = models.CharField(max_length=128, db_index=True)
    pid = models.IntegerField(null=True, blank=True)
    process_name = models.CharField(max_length=255, blank=True)
    username = models.CharField(max_length=128, blank=True)
    laddr = models.CharField(max_length=64, blank=True)
    lport = models.IntegerField(null=True, blank=True)
    raddr = models.CharField(max_length=64, blank=True)
    rport = models.IntegerField(null=True, blank=True)
    protocol = models.CharField(max_length=8, choices=PROTOCOL_CHOICES, default=TCP)
    state = models.CharField(max_length=32, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["agent_id", "pid", "laddr", "lport", "raddr", "rport", "protocol"],
                name="uniq_net_connection",
            )
        ]
        indexes = [
            models.Index(fields=["agent_id", "pid", "protocol"]),
            models.Index(fields=["agent_id", "state"]),
        ]
        ordering = ["agent_id", "pid", "laddr", "lport"]

    def __str__(self):  # pragma: no cover
        return f"{self.agent_id}:{self.protocol}:{self.laddr}:{self.lport}->{self.raddr}:{self.rport}"


class ProcessSnapshot(TimestampedModel):
    agent_id = models.CharField(max_length=128, db_index=True)
    pid = models.IntegerField()
    name = models.CharField(max_length=255)
    username = models.CharField(max_length=128, blank=True)
    cmdline = models.TextField(blank=True)
    cpu_pct = models.FloatField(null=True, blank=True)
    mem_pct = models.FloatField(null=True, blank=True)
    mem_bytes = models.BigIntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["agent_id", "pid"], name="uniq_process_snapshot"),
        ]
        indexes = [
            models.Index(fields=["agent_id", "pid"]),
            models.Index(fields=["agent_id", "name"]),
        ]
        ordering = ["agent_id", "pid"]

    def __str__(self):  # pragma: no cover
        return f"{self.agent_id}:{self.pid}:{self.name}"
