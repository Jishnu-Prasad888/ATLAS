"""
Beacon Agents Serializers
"""
from rest_framework import serializers
from .models import Agent, CollectorHealth, CollectorStatus, AgentStatus


class CollectorHealthSerializer(serializers.ModelSerializer):
    class Meta:
        model  = CollectorHealth
        fields = ["collector", "status", "last_run", "last_success", "last_failure", "failure_count", "updated_at"]


class AgentSerializer(serializers.ModelSerializer):
    collector_health = CollectorHealthSerializer(many=True, read_only=True)
    is_stale         = serializers.BooleanField(read_only=True)

    class Meta:
        model  = Agent
        fields = [
            "id", "agent_id", "hostname", "os", "architecture", "version",
            "tags", "status", "is_active", "registered_at", "last_seen",
            "metadata", "collector_health", "is_stale",
        ]
        read_only_fields = ["id", "registered_at", "last_seen"]


class AgentRegisterSerializer(serializers.Serializer):
    agent_id     = serializers.CharField(max_length=128)
    hostname     = serializers.CharField(max_length=253)
    os           = serializers.CharField(max_length=64,  default="linux")
    architecture = serializers.CharField(max_length=32,  default="x86_64")
    version      = serializers.CharField(max_length=32,  default="unknown")
    tags         = serializers.ListField(child=serializers.CharField(), default=list)
    metadata     = serializers.DictField(default=dict)
    secret       = serializers.CharField(write_only=True, required=False, allow_blank=True)


class AgentStatusUpdateSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=AgentStatus.choices)


class AgentRenameSerializer(serializers.Serializer):
    hostname = serializers.CharField(max_length=253)


class CollectorHealthUpdateSerializer(serializers.Serializer):
    collector     = serializers.CharField(max_length=64)
    status        = serializers.ChoiceField(choices=CollectorStatus.choices)
    last_run      = serializers.DateTimeField(required=False)
    last_success  = serializers.DateTimeField(required=False)
    last_failure  = serializers.DateTimeField(required=False)
    failure_count = serializers.IntegerField(required=False, min_value=0)
