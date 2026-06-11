"""
Beacon Auth RBAC Serializers
"""
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
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
            data = super().validate(attrs)
            # Reset failed logins on success
            self.user.reset_failed_logins()
            return data
        except Exception:
            try:
                user = BeaconUser.objects.get(username=username)
                user.record_failed_login()
            except BeaconUser.DoesNotExist:
                pass
            raise


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
