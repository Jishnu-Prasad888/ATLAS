from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("audit", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="auditlog",
            name="approved_by",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="city",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="country",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="device",
            field=models.CharField(blank=True, max_length=128),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="method",
            field=models.CharField(blank=True, max_length=16),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="path",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="region",
            field=models.CharField(blank=True, max_length=64),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="session_id",
            field=models.CharField(blank=True, max_length=128),
        ),
        migrations.AddField(
            model_name="auditlog",
            name="user_agent",
            field=models.TextField(blank=True),
        ),
    ]
