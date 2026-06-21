"""
Beacon Auth & RBAC Models
- BeaconUser with VIEWER / ADMINISTRATOR roles
- Recovery key management
- Security question (optional secondary)
"""
import secrets
import hashlib
from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils import timezone


class Role(models.TextChoices):
    ADMINISTRATOR = "administrator", "Administrator"
    MODERATOR     = "moderator",     "Moderator"
    VIEWER        = "viewer",        "Viewer"
    GUEST         = "guest",         "Guest"


class BeaconUserManager(BaseUserManager):
    def create_user(self, username, password=None, **extra_fields):
        if not username:
            raise ValueError("Username is required")
        user = self.model(username=username, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, password=None, **extra_fields):
        extra_fields.setdefault("role", Role.ADMINISTRATOR)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(username, password, **extra_fields)


class BeaconUser(AbstractBaseUser, PermissionsMixin):
    username       = models.CharField(max_length=150, unique=True)
    email          = models.EmailField(blank=True)
    role           = models.CharField(max_length=32, choices=Role.choices, default=Role.VIEWER)

    # Lifecycle & approval
    approval_status = models.CharField(max_length=16, choices=[
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ], default="approved")
    approved_by    = models.CharField(max_length=150, blank=True)
    approved_at    = models.DateTimeField(null=True, blank=True)
    start_at       = models.DateTimeField(null=True, blank=True)
    expires_at     = models.DateTimeField(null=True, blank=True)
    invited_by     = models.CharField(max_length=150, blank=True)
    created_via    = models.CharField(max_length=32, default="password", blank=True)
    google_sub     = models.CharField(max_length=255, blank=True)

    # Access scope
    access_all_agents = models.BooleanField(default=False)

    is_active      = models.BooleanField(default=True)
    is_staff       = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)
    updated_at     = models.DateTimeField(auto_now=True)
    last_login_ip  = models.GenericIPAddressField(null=True, blank=True)
    failed_logins  = models.PositiveIntegerField(default=0)
    locked_until   = models.DateTimeField(null=True, blank=True)

    # Security question (optional secondary recovery)
    security_answer_hash = models.CharField(max_length=256, blank=True)

    objects = BeaconUserManager()

    USERNAME_FIELD  = "username"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "beacon_users"
        verbose_name = "Beacon User"

    def __str__(self):
        return f"{self.username} ({self.role})"

    @property
    def is_administrator(self):
        return self.role == Role.ADMINISTRATOR

    @property
    def is_moderator(self):
        return self.role == Role.MODERATOR

    @property
    def is_viewer(self):
        return self.role == Role.VIEWER

    @property
    def is_guest(self):
        return self.role == Role.GUEST

    def is_locked(self):
        if self.locked_until and self.locked_until > timezone.now():
            return True
        return False

    def record_failed_login(self):
        self.failed_logins += 1
        thresholds = [5, 10, 20]
        delays = [60, 300, 3600]  # seconds
        for threshold, delay in zip(thresholds, delays):
            if self.failed_logins >= threshold:
                self.locked_until = timezone.now() + timezone.timedelta(seconds=delay)
        self.save(update_fields=["failed_logins", "locked_until"])

    def reset_failed_logins(self):
        self.failed_logins = 0
        self.locked_until  = None
        self.save(update_fields=["failed_logins", "locked_until"])

    def set_security_answer(self, answer: str):
        self.security_answer_hash = hashlib.sha256(answer.lower().strip().encode()).hexdigest()
        self.save(update_fields=["security_answer_hash"])

    def check_security_answer(self, answer: str) -> bool:
        return self.security_answer_hash == hashlib.sha256(answer.lower().strip().encode()).hexdigest()


class RecoveryKey(models.Model):
    """
    Primary password recovery mechanism.
    Pattern: XXXX-XXXX-XXXX-XXXX (hex groups)
    """
    user        = models.OneToOneField(BeaconUser, on_delete=models.CASCADE, related_name="recovery_key")
    key_hash    = models.CharField(max_length=256)   # SHA-256 of the raw key
    created_at  = models.DateTimeField(auto_now_add=True)
    used_at     = models.DateTimeField(null=True, blank=True)
    invalidated = models.BooleanField(default=False)

    class Meta:
        db_table = "beacon_recovery_keys"

    @staticmethod
    def generate() -> str:
        """Generate a recovery key in XXXX-XXXX-XXXX-XXXX hex format."""
        raw = secrets.token_hex(8)  # 8 bytes = 16 hex chars
        groups = [raw[i:i+4] for i in range(0, 16, 4)]
        return "-".join(groups).upper()

    @staticmethod
    def hash_key(raw: str) -> str:
        clean = raw.replace("-", "").upper()
        return hashlib.sha256(clean.encode()).hexdigest()

    def check_key(self, raw: str) -> bool:
        if self.invalidated:
            return False
        return self.key_hash == self.hash_key(raw)

    def consume(self):
        """Invalidate on use — new key must be issued."""
        self.used_at     = timezone.now()
        self.invalidated = True
        self.save(update_fields=["used_at", "invalidated"])


# ─── Access Control Models ─────────────────────────────────────────────────────


class Organization(models.Model):
    name        = models.CharField(max_length=150, unique=True)
    description = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "beacon_organizations"
        ordering = ["name"]

    def __str__(self):
        return self.name


class OrganizationAgent(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="agents")
    agent_id     = models.CharField(max_length=128, db_index=True)

    class Meta:
        db_table = "beacon_organization_agents"
        unique_together = [("organization", "agent_id")]


class UserAgentAccess(models.Model):
    user     = models.ForeignKey(BeaconUser, on_delete=models.CASCADE, related_name="agent_access")
    agent_id = models.CharField(max_length=128, db_index=True)

    class Meta:
        db_table = "beacon_user_agent_access"
        unique_together = [("user", "agent_id")]


class UserOrganizationAccess(models.Model):
    user          = models.ForeignKey(BeaconUser, on_delete=models.CASCADE, related_name="organization_access")
    organization  = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="user_access")

    class Meta:
        db_table = "beacon_user_organization_access"
        unique_together = [("user", "organization")]


class RegistrationRequest(models.Model):
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
    ]

    user            = models.OneToOneField(BeaconUser, on_delete=models.CASCADE, related_name="registration_request")
    role_requested  = models.CharField(max_length=32, choices=Role.choices, default=Role.VIEWER)
    reason          = models.TextField(blank=True)
    status          = models.CharField(max_length=16, choices=STATUS_CHOICES, default="pending")
    decided_by      = models.CharField(max_length=150, blank=True)
    decided_at      = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "beacon_registration_requests"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user.username} → {self.role_requested} ({self.status})"
