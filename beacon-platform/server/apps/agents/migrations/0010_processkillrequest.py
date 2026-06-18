from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("agents", "0001_initial"),
    ]

    operations = [
        migrations.CreateModel(
            name="ProcessKillRequest",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("pid", models.IntegerField()),
                ("status", models.CharField(choices=[("pending", "Pending"), ("dispatched", "Dispatched"), ("completed", "Completed"), ("failed", "Failed")], db_index=True, default="pending", max_length=16)),
                ("error", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("dispatched_at", models.DateTimeField(blank=True, null=True)),
                ("completed_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={
                "db_table": "beacon_process_kill_requests",
            },
        ),
    ]
