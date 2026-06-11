"""
Beacon Auth RBAC Views
/api/v1/auth/
"""
import logging
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import BeaconUser, RecoveryKey, Role
from .serializers import (
    BeaconTokenObtainPairSerializer,
    BeaconUserSerializer,
    BeaconUserCreateSerializer,
    PasswordChangeSerializer,
    PasswordRecoverySerializer,
)
from .permissions import IsAdministrator
from apps.audit.utils import audit_log

logger = logging.getLogger("beacon")


class LoginThrottle(AnonRateThrottle):
    rate = "5/minute"
    scope = "login"


class BeaconLoginView(TokenObtainPairView):
    serializer_class = BeaconTokenObtainPairSerializer
    throttle_classes = [LoginThrottle]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            username = request.data.get("username", "")
            ip = request.META.get("REMOTE_ADDR", "")
            try:
                user = BeaconUser.objects.get(username=username)
                user.last_login_ip = ip
                user.save(update_fields=["last_login_ip"])
            except BeaconUser.DoesNotExist:
                pass
            audit_log(request, action="LOGIN", resource="auth", details={"username": username})
        return response


class BeaconLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
            audit_log(request, action="LOGOUT", resource="auth")
            return Response({"detail": "Logged out successfully."}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class WhoAmIView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(BeaconUserSerializer(request.user).data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save()
        audit_log(request, action="PASSWORD_CHANGE", resource="auth")
        return Response({"detail": "Password changed successfully."})


class PasswordRecoveryView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        serializer = PasswordRecoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = data["user"]
        rk   = data["recovery_key_obj"]

        user.set_password(data["new_password"])
        user.reset_failed_logins()
        user.save()
        rk.consume()

        # Issue new recovery key
        new_key = RecoveryKey.generate()
        RecoveryKey.objects.filter(user=user).delete()
        RecoveryKey.objects.create(user=user, key_hash=RecoveryKey.hash_key(new_key))

        audit_log(request, action="PASSWORD_RECOVERY", resource="auth", details={"username": user.username})
        return Response({
            "detail": "Password reset successful. Save your new recovery key.",
            "new_recovery_key": new_key,
        })


class GenerateRecoveryKeyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        raw_key = RecoveryKey.generate()
        RecoveryKey.objects.filter(user=request.user).delete()
        RecoveryKey.objects.create(
            user     = request.user,
            key_hash = RecoveryKey.hash_key(raw_key),
        )
        audit_log(request, action="RECOVERY_KEY_GENERATED", resource="auth")
        return Response({
            "recovery_key": raw_key,
            "warning": "Save this key securely. It will not be shown again.",
        })


# ─── User Management ─────────────────────────────────────────────────────────

class UserListCreateView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        users = BeaconUser.objects.all().order_by("username")
        return Response(BeaconUserSerializer(users, many=True).data)

    def post(self, request):
        serializer = BeaconUserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        audit_log(request, action="USER_CREATE", resource="users", resource_id=str(user.id))
        return Response(BeaconUserSerializer(user).data, status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    permission_classes = [IsAdministrator]

    def get_object(self, pk):
        try:
            return BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            return None

    def get(self, request, pk):
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        return Response(BeaconUserSerializer(user).data)

    def patch(self, request, pk):
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        serializer = BeaconUserSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        audit_log(request, action="USER_UPDATE", resource="users", resource_id=str(user.id))
        return Response(serializer.data)

    def delete(self, request, pk):
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        if user == request.user:
            return Response({"detail": "Cannot delete own account."}, status=400)
        user_id = str(user.id)
        user.delete()
        audit_log(request, action="USER_DELETE", resource="users", resource_id=user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserRoleAssignView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, pk):
        try:
            user = BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        role = request.data.get("role")
        if role not in dict(Role.choices):
            return Response({"detail": f"Invalid role. Choices: {list(dict(Role.choices).keys())}"}, status=400)
        user.role = role
        user.save(update_fields=["role"])
        audit_log(request, action="USER_ROLE_ASSIGN", resource="users", resource_id=str(user.id), details={"role": role})
        return Response(BeaconUserSerializer(user).data)


class UserEnableDisableView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, pk, action):
        try:
            user = BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        if action == "enable":
            user.is_active = True
        elif action == "disable":
            if user == request.user:
                return Response({"detail": "Cannot disable own account."}, status=400)
            user.is_active = False
        else:
            return Response({"detail": "Action must be enable or disable."}, status=400)
        user.save(update_fields=["is_active"])
        audit_log(request, action=f"USER_{action.upper()}", resource="users", resource_id=str(user.id))
        return Response(BeaconUserSerializer(user).data)
