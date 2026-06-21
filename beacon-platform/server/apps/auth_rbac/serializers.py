"""
Beacon Auth RBAC Serializers
"""
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from django.utils import timezone
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken
from .models import BeaconUser, RecoveryKey, Role


def _populate_token(token, user):
    token["username"] = user.username
    token["role"] = user.role
    token["approval_status"] = getattr(user, "approval_status", "approved")
    token["approved"] = getattr(user, "approval_status", "approved") == "approved"
    token["access_all_agents"] = getattr(user, "access_all_agents", False)

    agent_ids = list(user.agent_access.values_list("agent_id", flat=True)) if hasattr(user, "agent_access") else []
    org_ids = list(user.organization_access.values_list("organization_id", flat=True)) if hasattr(user, "organization_access") else []
    token["agent_ids"] = agent_ids
    token["organization_ids"] = org_ids

    if getattr(user, "expires_at", None):
        token["expires_at"] = user.expires_at.isoformat()
    if getattr(user, "start_at", None):
        token["start_at"] = user.start_at.isoformat()
    return token


class BeaconTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        return _populate_token(token, user)

    def validate(self, attrs):
        username = attrs.get("username", "")
        try:
            user = BeaconUser.objects.get(username=username)
            if user.is_locked():
                raise serializers.ValidationError("Account is temporarily locked due to failed login attempts.")
        except BeaconUser.DoesNotExist:
            pass  # Let default handling produce generic error

        try:
            # Pass Django HttpRequest positionally to avoid Django 5.0 bind() conflict
            # SimpleJWT's default serializer forwards request inside **kwargs, triggering
            # a multiple-values error. We unwrap DRF's Request to the underlying HttpRequest.
            drf_request = self.context.get("request")
            django_request = getattr(drf_request, "_request", drf_request)
            self.user = authenticate(
                django_request,
                **{self.username_field: attrs[self.username_field], "password": attrs["password"]},
            )
            if self.user is None or not api_settings.USER_AUTHENTICATION_RULE(self.user):
                raise AuthenticationFailed(
                    self.error_messages["no_active_account"],
                    "no_active_account",
                )
            self.user.reset_failed_logins()

            # Approval and lifecycle checks
            if getattr(self.user, "approval_status", "approved") != "approved":
                raise AuthenticationFailed("Account pending approval.")
            now = timezone.now()
            if getattr(self.user, "start_at", None) and self.user.start_at > now:
                raise AuthenticationFailed("Account not yet active.")
            if getattr(self.user, "expires_at", None) and self.user.expires_at <= now:
                raise AuthenticationFailed("Account expired.")
        except AuthenticationFailed:
            try:
                user = BeaconUser.objects.get(username=username)
                user.record_failed_login()
            except BeaconUser.DoesNotExist:
                pass
            raise

        refresh = self.get_token(self.user)
        data = {"refresh": str(refresh), "access": str(refresh.access_token)}
        if api_settings.UPDATE_LAST_LOGIN:
            update_last_login(None, self.user)
        return data


class BeaconTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        refresh = self.token_class(attrs["refresh"])
        user_id = refresh.get("user_id")
        try:
            user = BeaconUser.objects.get(id=user_id)
        except BeaconUser.DoesNotExist:
            raise AuthenticationFailed("User not found.")

        now = timezone.now()
        if not user.is_active:
            raise AuthenticationFailed("Account disabled.")
        if getattr(user, "approval_status", "approved") != "approved":
            raise AuthenticationFailed("Account pending approval.")
        if getattr(user, "start_at", None) and user.start_at > now:
            raise AuthenticationFailed("Account not yet active.")
        if getattr(user, "expires_at", None) and user.expires_at <= now:
            raise AuthenticationFailed("Account expired.")

        access = refresh.access_token
        _populate_token(access, user)
        return {"access": str(access), "refresh": str(refresh)}


class BeaconUserSerializer(serializers.ModelSerializer):
    access_scope = serializers.SerializerMethodField()

    class Meta:
        model  = BeaconUser
        fields = [
            "id",
            "username",
            "email",
            "role",
            "is_active",
            "created_at",
            "last_login",
            "approval_status",
            "approved_by",
            "approved_at",
            "start_at",
            "expires_at",
            "access_all_agents",
            "access_scope",
            "invited_by",
        ]
        read_only_fields = ["id", "created_at", "last_login", "approved_at", "approved_by", "access_scope"]

    def get_access_scope(self, obj):
        agent_ids = list(obj.agent_access.values_list("agent_id", flat=True)) if hasattr(obj, "agent_access") else []
        org_ids = list(obj.organization_access.values_list("organization_id", flat=True)) if hasattr(obj, "organization_access") else []
        return {
            "access_all_agents": obj.access_all_agents,
            "agent_ids": agent_ids,
            "organization_ids": org_ids,
        }


class BeaconUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=12)
    role     = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)
    access_all_agents = serializers.BooleanField(default=False)
    agent_ids = serializers.ListField(child=serializers.CharField(), required=False)
    organization_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    approval_status = serializers.ChoiceField(choices=["pending", "approved", "rejected"], default="approved")
    start_at = serializers.DateTimeField(required=False, allow_null=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    class Meta:
        model  = BeaconUser
        fields = [
            "username",
            "email",
            "password",
            "role",
            "access_all_agents",
            "agent_ids",
            "organization_ids",
            "approval_status",
            "start_at",
            "expires_at",
        ]

    def create(self, validated_data):
        from .models import UserAgentAccess, UserOrganizationAccess, Organization

        password = validated_data.pop("password")
        agent_ids = validated_data.pop("agent_ids", [])
        org_ids   = validated_data.pop("organization_ids", [])
        approval_status = validated_data.get("approval_status", "approved")
        request = self.context.get("request") if hasattr(self, "context") else None
        approver = getattr(getattr(request, "user", None), "username", "")
        user     = BeaconUser(**validated_data)
        if approval_status != "approved":
            user.is_active = False
        else:
            user.is_active = True
            user.approved_by = approver
            user.approved_at = timezone.now()
        user.set_password(password)
        user.save()

        if not validated_data.get("access_all_agents"):
            UserAgentAccess.objects.bulk_create([
                UserAgentAccess(user=user, agent_id=aid) for aid in agent_ids
            ], ignore_conflicts=True)
            if org_ids:
                for oid in org_ids:
                    try:
                        org = Organization.objects.get(id=oid)
                        UserOrganizationAccess.objects.get_or_create(user=user, organization=org)
                    except Organization.DoesNotExist:
                        continue
        return user


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=12)

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Old password is incorrect.")
        return value


class PasswordRecoverySerializer(serializers.Serializer):
    username     = serializers.CharField()
    recovery_key = serializers.CharField()
    new_password = serializers.CharField(min_length=12)

    def validate(self, attrs):
        try:
            user = BeaconUser.objects.get(username=attrs["username"])
        except BeaconUser.DoesNotExist:
            raise serializers.ValidationError("Invalid credentials.")

        try:
            rk = user.recovery_key
        except RecoveryKey.DoesNotExist:
            raise serializers.ValidationError("No recovery key registered for this account.")

        if not rk.check_key(attrs["recovery_key"]):
            raise serializers.ValidationError("Invalid recovery key.")

        attrs["user"] = user
        attrs["recovery_key_obj"] = rk
        return attrs


class RecoveryKeySerializer(serializers.ModelSerializer):
    class Meta:
        model  = RecoveryKey
        fields = ["created_at", "used_at", "invalidated"]
