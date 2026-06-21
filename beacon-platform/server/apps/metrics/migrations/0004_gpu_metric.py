from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("metrics", "0003_alter_metric_metric_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="metricconfig",
            name="gpu_enabled",
            field=models.BooleanField(default=True),
        ),
        migrations.AlterField(
            model_name="metric",
            name="metric_type",
            field=models.CharField(
                choices=[
                    ("cpu", "CPU"),
                    ("ram", "RAM"),
                    ("storage", "Storage"),
                    ("network", "Network"),
                    ("process", "Process"),
                    ("systemd", "Systemd"),
                    ("docker", "Docker"),
                    ("kubernetes", "Kubernetes"),
                    ("kernel", "Kernel"),
                    ("temperature", "Temperature"),
                    ("power", "Power"),
                    ("gpu", "GPU"),
                    ("system_inventory", "System Inventory"),
                ],
                db_index=True,
                max_length=32,
            ),
        ),
    ]
