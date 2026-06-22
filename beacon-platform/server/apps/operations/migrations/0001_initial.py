from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="DockerContainer",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("container_id", models.CharField(max_length=128)),
                ("name", models.CharField(max_length=255)),
                ("image", models.CharField(blank=True, max_length=255)),
                ("state", models.CharField(db_index=True, max_length=32)),
                ("status", models.CharField(blank=True, max_length=64)),
                ("health", models.CharField(blank=True, max_length=32)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("cpu_pct", models.FloatField(blank=True, null=True)),
                ("mem_pct", models.FloatField(blank=True, null=True)),
                ("mem_bytes", models.BigIntegerField(blank=True, null=True)),
                ("pids", models.IntegerField(blank=True, null=True)),
                ("rx_bytes", models.BigIntegerField(default=0)),
                ("tx_bytes", models.BigIntegerField(default=0)),
                ("blk_read_bytes", models.BigIntegerField(default=0)),
                ("blk_write_bytes", models.BigIntegerField(default=0)),
                ("meta", models.JSONField(blank=True, default=dict)),
            ],
            options={
                "ordering": ["agent_id", "name"],
                "indexes": [models.Index(fields=["agent_id", "state"], name="operations__agent_i_ada99a_idx")],
                "constraints": [
                    models.UniqueConstraint(fields=["agent_id", "container_id"], name="uniq_docker_container")
                ],
            },
        ),
        migrations.CreateModel(
            name="KubernetesPod",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("uid", models.CharField(max_length=128)),
                ("name", models.CharField(max_length=255)),
                ("namespace", models.CharField(default="default", max_length=255)),
                ("node", models.CharField(blank=True, max_length=255)),
                ("phase", models.CharField(db_index=True, max_length=32)),
                ("restart_count", models.IntegerField(default=0)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("labels", models.JSONField(blank=True, default=dict)),
                ("annotations", models.JSONField(blank=True, default=dict)),
                ("container_statuses", models.JSONField(blank=True, default=list)),
            ],
            options={
                "ordering": ["agent_id", "namespace", "name"],
                "indexes": [
                    models.Index(fields=["agent_id", "namespace", "phase"], name="operations__agent_i_a69a28_idx")
                ],
                "constraints": [models.UniqueConstraint(fields=["agent_id", "uid"], name="uniq_k8s_pod")],
            },
        ),
        migrations.CreateModel(
            name="NetworkInterface",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("name", models.CharField(max_length=64)),
                ("address", models.CharField(blank=True, max_length=64)),
                ("mac", models.CharField(blank=True, max_length=64)),
                ("mtu", models.IntegerField(blank=True, null=True)),
                ("speed_mbps", models.IntegerField(blank=True, null=True)),
                ("rx_bytes", models.BigIntegerField(default=0)),
                ("tx_bytes", models.BigIntegerField(default=0)),
                ("rx_errors", models.BigIntegerField(default=0)),
                ("tx_errors", models.BigIntegerField(default=0)),
                ("rx_dropped", models.BigIntegerField(default=0)),
                ("tx_dropped", models.BigIntegerField(default=0)),
                ("meta", models.JSONField(blank=True, default=dict)),
            ],
            options={
                "ordering": ["agent_id", "name"],
                "constraints": [
                    models.UniqueConstraint(fields=["agent_id", "name"], name="uniq_net_interface")
                ],
            },
        ),
        migrations.CreateModel(
            name="NetworkConnection",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("pid", models.IntegerField(blank=True, null=True)),
                ("process_name", models.CharField(blank=True, max_length=255)),
                ("username", models.CharField(blank=True, max_length=128)),
                ("laddr", models.CharField(blank=True, max_length=64)),
                ("lport", models.IntegerField(blank=True, null=True)),
                ("raddr", models.CharField(blank=True, max_length=64)),
                ("rport", models.IntegerField(blank=True, null=True)),
                ("protocol", models.CharField(choices=[("tcp", "TCP"), ("udp", "UDP"), ("unix", "UNIX")], default="tcp", max_length=8)),
                ("state", models.CharField(blank=True, max_length=32)),
            ],
            options={
                "ordering": ["agent_id", "pid", "laddr", "lport"],
                "indexes": [
                    models.Index(fields=["agent_id", "pid", "protocol"], name="operations__agent_i_fbe4f4_idx"),
                    models.Index(fields=["agent_id", "state"], name="operations__agent_i_01c0bb_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=["agent_id", "pid", "laddr", "lport", "raddr", "rport", "protocol"],
                        name="uniq_net_connection",
                    )
                ],
            },
        ),
        migrations.CreateModel(
            name="ProcessSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("agent_id", models.CharField(db_index=True, max_length=128)),
                ("pid", models.IntegerField()),
                ("name", models.CharField(max_length=255)),
                ("username", models.CharField(blank=True, max_length=128)),
                ("cmdline", models.TextField(blank=True)),
                ("cpu_pct", models.FloatField(blank=True, null=True)),
                ("mem_pct", models.FloatField(blank=True, null=True)),
                ("mem_bytes", models.BigIntegerField(blank=True, null=True)),
                ("started_at", models.DateTimeField(blank=True, null=True)),
                ("meta", models.JSONField(blank=True, default=dict)),
            ],
            options={
                "ordering": ["agent_id", "pid"],
                "indexes": [
                    models.Index(fields=["agent_id", "pid"], name="operations__agent_i_d4226f_idx"),
                    models.Index(fields=["agent_id", "name"], name="operations__agent_i_b556b6_idx"),
                ],
                "constraints": [models.UniqueConstraint(fields=["agent_id", "pid"], name="uniq_process_snapshot")],
            },
        ),
    ]
