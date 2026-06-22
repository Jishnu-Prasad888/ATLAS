from rest_framework import serializers

from .models import AtlasAiMessage, AtlasAiThread


class AtlasAiThreadSerializer(serializers.ModelSerializer):
    message_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = AtlasAiThread
        fields = ["id", "title", "created_at", "updated_at", "deleted_at", "message_count"]


class AtlasAiMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = AtlasAiMessage
        fields = ["id", "role", "content", "created_at"]


class AtlasAiMessageCreateSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=[choice[0] for choice in AtlasAiMessage.ROLE_CHOICES])
    content = serializers.CharField(max_length=8000, allow_blank=True)
