"""
Beacon Auth RBAC Serializers
"""
from django.contrib.auth import authenticate
from django.contrib.auth.models import update_last_login
from rest_framework import serializers
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.settings import api_settings
from .models import BeaconUser, RecoveryKey, Role


class BeaconTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["username"] = user.username
        token["role"]     = user.role
        return token

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


class BeaconUserSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BeaconUser
        fields = ["id", "username", "email", "role", "is_active", "created_at", "last_login"]
        read_only_fields = ["id", "created_at", "last_login"]


class BeaconUserCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=12)
    role     = serializers.ChoiceField(choices=Role.choices, default=Role.VIEWER)

    class Meta:
        model  = BeaconUser
        fields = ["username", "email", "password", "role"]

    def create(self, validated_data):
        password = validated_data.pop("password")
        user     = BeaconUser(**validated_data)
        user.set_password(password)
        user.save()
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
