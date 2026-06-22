"""
Atlas AI conversation persistence models
Threads and messages are user-scoped and soft-deletable.
"""
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class AtlasAiThread(models.Model):
    id         = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user       = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="atlas_ai_threads")
    title      = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "atlas_ai_threads"
        ordering = ["-updated_at"]

    def mark_deleted(self):
        if not self.deleted_at:
            self.deleted_at = timezone.now()
            self.save(update_fields=["deleted_at", "updated_at"])


class AtlasAiMessage(models.Model):
    ROLE_CHOICES = [
        ("user", "user"),
        ("assistant", "assistant"),
        ("system", "system"),
        ("tool", "tool"),
    ]

    id         = models.BigAutoField(primary_key=True)
    thread     = models.ForeignKey(AtlasAiThread, on_delete=models.CASCADE, related_name="messages")
    role       = models.CharField(max_length=16, choices=ROLE_CHOICES)
    content    = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "atlas_ai_messages"
        ordering = ["created_at"]
        indexes = [models.Index(fields=["thread", "created_at"], name="ai_msg_thread_created_idx")]
