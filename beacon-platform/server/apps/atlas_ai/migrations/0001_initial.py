# Generated manually for Atlas AI threads/messages
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AtlasAiThread",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("title", models.CharField(blank=True, max_length=255)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="atlas_ai_threads",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "db_table": "atlas_ai_threads",
                "ordering": ["-updated_at"],
            },
        ),
        migrations.CreateModel(
            name="AtlasAiMessage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "role",
                    models.CharField(
                        choices=[("user", "user"), ("assistant", "assistant"), ("system", "system"), ("tool", "tool")],
                        max_length=16,
                    ),
                ),
                ("content", models.TextField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "thread",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="atlas_ai.atlasaithread",
                    ),
                ),
            ],
            options={
                "db_table": "atlas_ai_messages",
                "ordering": ["created_at"],
            },
        ),
        migrations.AddIndex(
            model_name="atlasaimessage",
            index=models.Index(fields=["thread", "created_at"], name="ai_msg_thread_created_idx"),
        ),
    ]
