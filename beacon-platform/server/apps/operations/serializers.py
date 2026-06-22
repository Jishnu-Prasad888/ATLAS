from rest_framework import serializers

from .models import (
    DockerContainer,
    KubernetesPod,
    NetworkConnection,
    NetworkInterface,
    ProcessSnapshot,
)


class DockerContainerSerializer(serializers.ModelSerializer):
    class Meta:
        model = DockerContainer
        fields = [
            "id",
            "agent_id",
            "container_id",
            "name",
            "image",
            "state",
            "status",
            "health",
            "started_at",
            "cpu_pct",
            "mem_pct",
            "mem_bytes",
            "pids",
            "rx_bytes",
            "tx_bytes",
            "blk_read_bytes",
            "blk_write_bytes",
            "meta",
            "updated_at",
        ]


class DockerContainerUpsertSerializer(serializers.Serializer):
    container_id = serializers.CharField(max_length=128)
    name = serializers.CharField(max_length=255)
    image = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    state = serializers.CharField(max_length=32)
    status = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    health = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")
    started_at = serializers.DateTimeField(required=False, allow_null=True)
    cpu_pct = serializers.FloatField(required=False, allow_null=True)
    mem_pct = serializers.FloatField(required=False, allow_null=True)
    mem_bytes = serializers.IntegerField(required=False, allow_null=True)
    pids = serializers.IntegerField(required=False, allow_null=True)
    rx_bytes = serializers.IntegerField(required=False, default=0)
    tx_bytes = serializers.IntegerField(required=False, default=0)
    blk_read_bytes = serializers.IntegerField(required=False, default=0)
    blk_write_bytes = serializers.IntegerField(required=False, default=0)
    meta = serializers.DictField(required=False, default=dict)


class DockerContainerBatchSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    containers = DockerContainerUpsertSerializer(many=True)


class KubernetesPodSerializer(serializers.ModelSerializer):
    class Meta:
        model = KubernetesPod
        fields = [
            "id",
            "agent_id",
            "uid",
            "name",
            "namespace",
            "node",
            "phase",
            "restart_count",
            "started_at",
            "labels",
            "annotations",
            "container_statuses",
            "updated_at",
        ]


class KubernetesPodUpsertSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=128)
    name = serializers.CharField(max_length=255)
    namespace = serializers.CharField(max_length=255, default="default")
    node = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    phase = serializers.CharField(max_length=32)
    restart_count = serializers.IntegerField(required=False, default=0)
    started_at = serializers.DateTimeField(required=False, allow_null=True)
    labels = serializers.DictField(required=False, default=dict)
    annotations = serializers.DictField(required=False, default=dict)
    container_statuses = serializers.ListField(child=serializers.DictField(), required=False, default=list)


class KubernetesPodBatchSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    pods = KubernetesPodUpsertSerializer(many=True)


class NetworkInterfaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NetworkInterface
        fields = [
            "id",
            "agent_id",
            "name",
            "address",
            "mac",
            "mtu",
            "speed_mbps",
            "rx_bytes",
            "tx_bytes",
            "rx_errors",
            "tx_errors",
            "rx_dropped",
            "tx_dropped",
            "meta",
            "updated_at",
        ]


class NetworkInterfaceUpsertSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=64)
    address = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    mac = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    mtu = serializers.IntegerField(required=False, allow_null=True)
    speed_mbps = serializers.IntegerField(required=False, allow_null=True)
    rx_bytes = serializers.IntegerField(required=False, default=0)
    tx_bytes = serializers.IntegerField(required=False, default=0)
    rx_errors = serializers.IntegerField(required=False, default=0)
    tx_errors = serializers.IntegerField(required=False, default=0)
    rx_dropped = serializers.IntegerField(required=False, default=0)
    tx_dropped = serializers.IntegerField(required=False, default=0)
    meta = serializers.DictField(required=False, default=dict)


class NetworkInterfaceBatchSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    interfaces = NetworkInterfaceUpsertSerializer(many=True)


class NetworkConnectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = NetworkConnection
        fields = [
            "id",
            "agent_id",
            "pid",
            "process_name",
            "username",
            "laddr",
            "lport",
            "raddr",
            "rport",
            "protocol",
            "state",
            "updated_at",
        ]


class NetworkConnectionUpsertSerializer(serializers.Serializer):
    pid = serializers.IntegerField(required=False, allow_null=True)
    process_name = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")
    username = serializers.CharField(max_length=128, required=False, allow_blank=True, default="")
    laddr = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    lport = serializers.IntegerField(required=False, allow_null=True)
    raddr = serializers.CharField(max_length=64, required=False, allow_blank=True, default="")
    rport = serializers.IntegerField(required=False, allow_null=True)
    protocol = serializers.ChoiceField(choices=NetworkConnection.PROTOCOL_CHOICES, default=NetworkConnection.TCP)
    state = serializers.CharField(max_length=32, required=False, allow_blank=True, default="")


class NetworkConnectionBatchSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    connections = NetworkConnectionUpsertSerializer(many=True)


class ProcessSnapshotSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProcessSnapshot
        fields = [
            "id",
            "agent_id",
            "pid",
            "name",
            "username",
            "cmdline",
            "cpu_pct",
            "mem_pct",
            "mem_bytes",
            "started_at",
            "meta",
            "updated_at",
        ]


class ProcessSnapshotUpsertSerializer(serializers.Serializer):
    pid = serializers.IntegerField()
    name = serializers.CharField(max_length=255)
    username = serializers.CharField(max_length=128, required=False, allow_blank=True, default="")
    cmdline = serializers.CharField(required=False, allow_blank=True, default="")
    cpu_pct = serializers.FloatField(required=False, allow_null=True)
    mem_pct = serializers.FloatField(required=False, allow_null=True)
    mem_bytes = serializers.IntegerField(required=False, allow_null=True)
    started_at = serializers.DateTimeField(required=False, allow_null=True)
    meta = serializers.DictField(required=False, default=dict)


class ProcessSnapshotBatchSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    processes = ProcessSnapshotUpsertSerializer(many=True)
