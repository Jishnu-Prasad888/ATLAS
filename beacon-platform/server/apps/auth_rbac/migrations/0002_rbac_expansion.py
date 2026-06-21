from django.db import migrations, models
import django.db.models.deletion


def approve_existing_users(apps, schema_editor):
    User = apps.get_model("auth_rbac", "BeaconUser")
    for user in User.objects.all():
        user.approval_status = "approved"
        user.access_all_agents = user.role == "administrator"
        if user.role == "administrator":
            user.approved_by = user.username
        user.save(update_fields=["approval_status", "access_all_agents", "approved_by"])


class Migration(migrations.Migration):

    dependencies = [
        ("auth_rbac", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="beaconuser",
            name="access_all_agents",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="approval_status",
            field=models.CharField(choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")], default="approved", max_length=16),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="approved_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="approved_by",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="created_via",
            field=models.CharField(blank=True, default="password", max_length=32),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="expires_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="google_sub",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="invited_by",
            field=models.CharField(blank=True, max_length=150),
        ),
        migrations.AddField(
            model_name="beaconuser",
            name="start_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="beaconuser",
            name="role",
            field=models.CharField(choices=[("administrator", "Administrator"), ("moderator", "Moderator"), ("viewer", "Viewer"), ("guest", "Guest")], default="viewer", max_length=32),
        ),
        migrations.CreateModel(
            name="Organization",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=150, unique=True)),
                ("description", models.TextField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "beacon_organizations",
                "ordering": ["name"],
            },
        ),
        migrations.CreateModel(
            name="OrganizationAgent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agents", to="auth_rbac.organization")),
            ],
            options={
                "db_table": "beacon_organization_agents",
                "unique_together": {("organization", "agent_id")},
            },
        ),
        migrations.CreateModel(
            name="UserAgentAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="agent_access", to="auth_rbac.beaconuser")),
            ],
            options={
                "db_table": "beacon_user_agent_access",
                "unique_together": {("user", "agent_id")},
            },
        ),
        migrations.CreateModel(
            name="UserOrganizationAccess",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("organization", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="user_access", to="auth_rbac.organization")),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="organization_access", to="auth_rbac.beaconuser")),
            ],
            options={
                "db_table": "beacon_user_organization_access",
                "unique_together": {("user", "organization")},
            },
        ),
        migrations.CreateModel(
            name="RegistrationRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("role_requested", models.CharField(choices=[("administrator", "Administrator"), ("moderator", "Moderator"), ("viewer", "Viewer"), ("guest", "Guest")], default="viewer", max_length=32)),
                ("reason", models.TextField(blank=True)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("approved", "Approved"), ("rejected", "Rejected")], default="pending", max_length=16)),
                ("decided_by", models.CharField(blank=True, max_length=150)),
                ("decided_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="registration_request", to="auth_rbac.beaconuser")),
            ],
            options={
                "db_table": "beacon_registration_requests",
                "ordering": ["-created_at"],
            },
        ),
        migrations.RunPython(approve_existing_users, reverse_code=migrations.RunPython.noop),
    ]
