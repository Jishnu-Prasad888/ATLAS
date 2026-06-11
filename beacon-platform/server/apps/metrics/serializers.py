"""
Beacon Metrics Serializers
"""
from rest_framework import serializers
from .models import Metric, MetricConfig, MetricType, MetricResolution


class MetricSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Metric
        fields = ["id", "agent_id", "metric_type", "resolution", "timestamp", "data", "schema_version"]
        read_only_fields = ["id"]


class MetricIngestSerializer(serializers.Serializer):
    """Used by agents to POST metric batches."""
    agent_id       = serializers.CharField(max_length=128)
    metric_type    = serializers.ChoiceField(choices=MetricType.choices)
    timestamp      = serializers.DateTimeField()
    data           = serializers.DictField()
    schema_version = serializers.CharField(max_length=16, default="1.0")
    sequence_number = serializers.IntegerField(required=False)


class MetricBatchIngestSerializer(serializers.Serializer):
    """Batch of metrics from a single agent."""
    agent_id = serializers.CharField(max_length=128)
    metrics  = MetricIngestSerializer(many=True)


class MetricConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model  = MetricConfig
        fields = [
            "agent_id",
            "cpu_enabled", "ram_enabled", "storage_enabled", "network_enabled",
            "process_enabled", "systemd_enabled", "docker_enabled", "kubernetes_enabled",
            "temperature_enabled", "power_enabled",
            "interval_seconds", "retention_days", "updated_at",
        ]
        read_only_fields = ["agent_id", "updated_at"]


class MetricQuerySerializer(serializers.Serializer):
    agent_id    = serializers.CharField(required=False)
    metric_type = serializers.ChoiceField(choices=MetricType.choices, required=False)
    resolution  = serializers.ChoiceField(choices=MetricResolution.choices, required=False)
    start       = serializers.DateTimeField(required=False)
    end         = serializers.DateTimeField(required=False)
    limit       = serializers.IntegerField(required=False, min_value=1, max_value=10000, default=1000)
