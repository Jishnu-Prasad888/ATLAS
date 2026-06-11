"""
Beacon Logs Serializers
"""
from rest_framework import serializers
from .models import LogEntry, LogSeverity, LogSource


class LogEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model  = LogEntry
        fields = [
            "id", "agent_id", "source", "severity", "message",
            "timestamp", "schema_version", "extra", "sequence_number",
        ]
        read_only_fields = ["id"]


class LogIngestSerializer(serializers.Serializer):
    agent_id        = serializers.CharField(max_length=128)
    source          = serializers.ChoiceField(choices=LogSource.choices)
    severity        = serializers.ChoiceField(choices=LogSeverity.choices)
    message         = serializers.CharField()
    timestamp       = serializers.DateTimeField()
    schema_version  = serializers.CharField(max_length=16, default="1.0")
    extra           = serializers.DictField(required=False, default=dict)
    sequence_number = serializers.IntegerField(required=False)


class LogBatchIngestSerializer(serializers.Serializer):
    agent_id = serializers.CharField(max_length=128)
    logs     = LogIngestSerializer(many=True)


class LogQuerySerializer(serializers.Serializer):
    agent_id  = serializers.CharField(required=False)
    source    = serializers.ChoiceField(choices=LogSource.choices,   required=False)
    severity  = serializers.ChoiceField(choices=LogSeverity.choices, required=False)
    search    = serializers.CharField(required=False)
    start     = serializers.DateTimeField(required=False)
    end       = serializers.DateTimeField(required=False)
    limit     = serializers.IntegerField(required=False, min_value=1, max_value=10000, default=500)
