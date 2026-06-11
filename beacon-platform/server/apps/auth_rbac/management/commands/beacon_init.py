"""
beacon init — Server initialization management command.
Creates admin user, generates recovery key, sets up default config.
"""
import getpass
import secrets
from django.core.management.base import BaseCommand
from apps.auth_rbac.models import BeaconUser, RecoveryKey, Role
from apps.config.models import ServerConfig


class Command(BaseCommand):
    help = "Initialize the Beacon server (create admin, generate recovery key)"

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS("=== Beacon Server Initialization ===\n"))

        # Check if already initialized
        if BeaconUser.objects.filter(role=Role.ADMINISTRATOR).exists():
            self.stdout.write(self.style.WARNING("Server already initialized. Aborting."))
            return

        # Create administrator
        self.stdout.write("Creating administrator account...")
        username = input("Administrator username [admin]: ").strip() or "admin"
        while True:
            password = getpass.getpass("Administrator password (min 12 chars): ")
            if len(password) >= 12:
                break
            self.stdout.write(self.style.ERROR("Password must be at least 12 characters."))

        admin = BeaconUser.objects.create_user(
            username=username,
            password=password,
            role=Role.ADMINISTRATOR,
            is_staff=True,
            is_superuser=True,
        )

        # Generate recovery key
        raw_key = RecoveryKey.generate()
        RecoveryKey.objects.create(
            user     = admin,
            key_hash = RecoveryKey.hash_key(raw_key),
        )

        # Default config
        defaults = {
            "retention_policy":   {"raw_hours": 24, "rollup_1m_days": 30, "rollup_1h_days": 365},
            "agent_heartbeat_timeout": 60,
            "max_agents":         1000,
            "initialized":        True,
        }
        for key, value in defaults.items():
            ServerConfig.objects.get_or_create(key=key, defaults={"value": value})

        self.stdout.write(self.style.SUCCESS("\n✓ Beacon server initialized successfully!"))
        self.stdout.write(self.style.SUCCESS(f"\n  Administrator: {username}"))
        self.stdout.write(self.style.WARNING(f"\n  Recovery Key:  {raw_key}"))
        self.stdout.write(self.style.WARNING("  ⚠ Save this recovery key securely. It will NOT be shown again.\n"))
