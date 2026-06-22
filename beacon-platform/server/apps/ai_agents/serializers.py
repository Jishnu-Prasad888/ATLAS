from __future__ import annotations

import json
from typing import Any, Dict

from rest_framework import serializers


class FetchSpecSerializer(serializers.Serializer):
    url = serializers.CharField(max_length=2048)
    params = serializers.DictField(required=False, default=dict)
    method = serializers.ChoiceField(choices=["GET", "POST", "PUT", "PATCH"], default="GET")
    token = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    timeout = serializers.IntegerField(required=False, min_value=1, max_value=30, default=10)
    max_bytes = serializers.IntegerField(required=False, min_value=1_000, max_value=10_000_000, default=2_000_000)


class AiRunRequestSerializer(serializers.Serializer):
    fetch = FetchSpecSerializer()
    code = serializers.CharField()
    input_data = serializers.JSONField(required=False)
    timeout_s = serializers.IntegerField(required=False, min_value=1, max_value=60, default=15)
    mem_limit = serializers.CharField(required=False, default="256m")
    cpu_quota = serializers.IntegerField(required=False, min_value=1_000, max_value=500_000, default=50_000)
    retries = serializers.IntegerField(required=False, min_value=0, max_value=3, default=1)

    def validate_code(self, value: str) -> str:
        if len(value) > 200_000:
            raise serializers.ValidationError("Code too large (>200k chars)")
        return value

    def validate(self, attrs: Dict[str, Any]) -> Dict[str, Any]:
        input_data = attrs.get("input_data")
        if input_data is not None:
            raw = json.dumps(input_data)
            if len(raw.encode("utf-8")) > 5_000_000:
                raise serializers.ValidationError("input_data too large (>5MB)")
        return attrs
