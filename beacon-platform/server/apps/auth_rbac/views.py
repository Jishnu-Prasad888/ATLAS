"""
Beacon Auth RBAC Views
/api/v1/auth/
"""
import logging
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.tokens import RefreshToken

from .models import (
    BeaconUser,
    RecoveryKey,
    Role,
    UserAgentAccess,
    UserOrganizationAccess,
    Organization,
    OrganizationAgent,
    RegistrationRequest,
)
from .serializers import (
    BeaconTokenObtainPairSerializer,
    BeaconTokenRefreshSerializer,
    BeaconUserSerializer,
    BeaconUserCreateSerializer,
    PasswordChangeSerializer,
    PasswordRecoverySerializer,
)
from .permissions import IsAdministrator, IsModeratorOrAdmin, IsApproved
from apps.audit.utils import audit_log

logger = logging.getLogger("beacon")


def _update_user_scope(user, access_all_agents: bool, agent_ids=None, org_ids=None):
    """Apply access scope changes for a user."""
    agent_ids = agent_ids or []
    org_ids = org_ids or []

    user.access_all_agents = bool(access_all_agents)
    user.save(update_fields=["access_all_agents"])

    if user.access_all_agents:
        UserAgentAccess.objects.filter(user=user).delete()
        UserOrganizationAccess.objects.filter(user=user).delete()
        return

    UserAgentAccess.objects.filter(user=user).exclude(agent_id__in=agent_ids).delete()
    existing_agents = set(UserAgentAccess.objects.filter(user=user).values_list("agent_id", flat=True))
    new_agent_rows = [
        UserAgentAccess(user=user, agent_id=aid)
        for aid in agent_ids if aid not in existing_agents
    ]
    if new_agent_rows:
        UserAgentAccess.objects.bulk_create(new_agent_rows, ignore_conflicts=True)

    UserOrganizationAccess.objects.filter(user=user).exclude(organization_id__in=org_ids).delete()
    existing_orgs = set(UserOrganizationAccess.objects.filter(user=user).values_list("organization_id", flat=True))
    for oid in org_ids:
        if oid in existing_orgs:
            continue
        try:
            org = Organization.objects.get(id=oid)
        except Organization.DoesNotExist:
            continue
        UserOrganizationAccess.objects.get_or_create(user=user, organization=org)


class LoginThrottle(AnonRateThrottle):
    rate = "5/minute"
    scope = "login"


class RegistrationThrottle(AnonRateThrottle):
    rate = "10/hour"
    scope = "registration"


class BeaconTokenRefreshView(TokenRefreshView):
    serializer_class = BeaconTokenRefreshSerializer


class BeaconLoginView(TokenObtainPairView):
    serializer_class = BeaconTokenObtainPairSerializer
    throttle_classes = [LoginThrottle]

    def post(self, request, *args, **kwargs):
        username = request.data.get("username", "")
        logger.debug("BeaconLoginView POST — username=%s", username)
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            ip = request.META.get("REMOTE_ADDR", "")
            logger.debug("BeaconLoginView login successful for %s from %s", username, ip)
            try:
                user = BeaconUser.objects.get(username=username)
                user.last_login_ip = ip
                user.save(update_fields=["last_login_ip"])
            except BeaconUser.DoesNotExist:
                pass
            audit_log(request, action="LOGIN", resource="auth", details={"username": username})
        else:
            logger.debug("BeaconLoginView login failed for %s status=%s", username, response.status_code)
        return response


class BeaconLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logger.debug("BeaconLogoutView POST — user=%s", request.user)
        try:
            refresh_token = request.data.get("refresh")
            if refresh_token:
                token = RefreshToken(refresh_token)
                token.blacklist()
                logger.debug("BeaconLogoutView token blacklisted")
            audit_log(request, action="LOGOUT", resource="auth")
            return Response({"detail": "Logged out successfully."}, status=status.HTTP_200_OK)
        except Exception as e:
            logger.debug("BeaconLogoutView error: %s", e)
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class WhoAmIView(APIView):
    permission_classes = [IsApproved]

    def get(self, request):
        logger.debug("WhoAmIView GET — user=%s", request.user)
        return Response(BeaconUserSerializer(request.user).data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logger.debug("PasswordChangeView POST — user=%s", request.user)
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save()
        logger.debug("PasswordChangeView password changed for user %s", request.user)
        audit_log(request, action="PASSWORD_CHANGE", resource="auth")
        return Response({"detail": "Password changed successfully."})


class PasswordRecoveryView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        logger.debug("PasswordRecoveryView POST")
        serializer = PasswordRecoverySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = data["user"]
        rk   = data["recovery_key_obj"]

        user.set_password(data["new_password"])
        user.reset_failed_logins()
        user.save()
        rk.consume()

        new_key = RecoveryKey.generate()
        RecoveryKey.objects.filter(user=user).delete()
        RecoveryKey.objects.create(user=user, key_hash=RecoveryKey.hash_key(new_key))

        logger.debug("PasswordRecoveryView password recovered for user %s", user.username)
        audit_log(request, action="PASSWORD_RECOVERY", resource="auth", details={"username": user.username})
        return Response({
            "detail": "Password reset successful. Save your new recovery key.",
            "new_recovery_key": new_key,
        })


class RegistrationView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationThrottle]

    def post(self, request):
        logger.debug("RegistrationView POST — username=%s", request.data.get("username"))
        serializer = BeaconUserCreateSerializer(data={
            **request.data,
            "approval_status": "pending",
            "access_all_agents": False,
        })
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        user.approval_status = "pending"
        user.created_via = "password"
        user.is_active = False
        user.save(update_fields=["approval_status", "created_via", "is_active"])

        RegistrationRequest.objects.update_or_create(
            user=user,
            defaults={
                "role_requested": serializer.validated_data.get("role", Role.VIEWER),
                "reason": request.data.get("reason", ""),
                "status": "pending",
            },
        )

        audit_log(request, action="REGISTRATION_SUBMIT", resource="auth", resource_id=str(user.id), details={"username": user.username})
        return Response({"detail": "Registration submitted. Await admin approval."}, status=status.HTTP_201_CREATED)


class GoogleOAuthView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get("id_token")
        if not token:
            return Response({"detail": "id_token is required"}, status=400)
        from django.conf import settings
        client_id = getattr(settings, "GOOGLE_CLIENT_ID", None)
        if not client_id:
            return Response({"detail": "Google OAuth not configured"}, status=503)

        try:
            from google.oauth2 import id_token
            from google.auth.transport import requests as google_requests
        except Exception:
            return Response({"detail": "Google auth library not installed"}, status=503)

        try:
            idinfo = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning("GoogleOAuthView verify failed: %s", exc)
            return Response({"detail": "Invalid Google token"}, status=400)

        email = idinfo.get("email")
        if not idinfo.get("email_verified"):
            return Response({"detail": "Unverified Google account"}, status=400)
        sub   = idinfo.get("sub")
        username = email.split("@")[0] if email else sub

        user, created = BeaconUser.objects.get_or_create(
            google_sub=sub,
            defaults={
                "username": username,
                "email": email or "",
                "role": Role.VIEWER,
                "approval_status": "pending",
                "is_active": False,
                "created_via": "google",
            },
        )

        if created:
            RegistrationRequest.objects.create(user=user, role_requested=Role.VIEWER, status="pending")
        elif user.approval_status != "approved":
            return Response({"detail": "Account awaiting approval."}, status=403)

        if user.approval_status != "approved":
            return Response({"detail": "Account awaiting approval."}, status=403)

        refresh = BeaconTokenObtainPairSerializer.get_token(user)
        data = {"refresh": str(refresh), "access": str(refresh.access_token)}
        audit_log(request, action="LOGIN_GOOGLE", resource="auth", details={"username": user.username})
        return Response(data)


class GenerateRecoveryKeyView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logger.debug("GenerateRecoveryKeyView POST — user=%s", request.user)
        raw_key = RecoveryKey.generate()
        RecoveryKey.objects.filter(user=request.user).delete()
        RecoveryKey.objects.create(
            user     = request.user,
            key_hash = RecoveryKey.hash_key(raw_key),
        )
        logger.debug("GenerateRecoveryKeyView new key generated for user %s", request.user)
        audit_log(request, action="RECOVERY_KEY_GENERATED", resource="auth")
        return Response({
            "recovery_key": raw_key,
            "warning": "Save this key securely. It will not be shown again.",
        })


# ─── User Management ─────────────────────────────────────────────────────────

class UserListCreateView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        logger.debug("UserListCreateView GET — user=%s", request.user)
        users = BeaconUser.objects.all().prefetch_related("agent_access", "organization_access").order_by("username")
        logger.debug("UserListCreateView returning %d users", users.count())
        return Response(BeaconUserSerializer(users, many=True).data)

    def post(self, request):
        logger.debug("UserListCreateView POST — user=%s data=%s", request.user, request.data)
        serializer = BeaconUserCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        logger.debug("UserListCreateView user created id=%s username=%s", user.id, user.username)
        audit_log(request, action="USER_CREATE", resource="users", resource_id=str(user.id))
        return Response(BeaconUserSerializer(user).data, status=status.HTTP_201_CREATED)


class UserDetailView(APIView):
    permission_classes = [IsAdministrator]

    def get_object(self, pk):
        try:
            return BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            logger.debug("UserDetailView user not found pk=%s", pk)
            return None

    def get(self, request, pk):
        logger.debug("UserDetailView GET — pk=%s user=%s", pk, request.user)
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        return Response(BeaconUserSerializer(user).data)

    def patch(self, request, pk):
        logger.debug("UserDetailView PATCH — pk=%s user=%s data=%s", pk, request.user, request.data)
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        access_all = request.data.get("access_all_agents", user.access_all_agents)
        agent_ids  = request.data.get("agent_ids")
        org_ids    = request.data.get("organization_ids")

        serializer = BeaconUserSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        if agent_ids is not None or org_ids is not None or "access_all_agents" in request.data:
            _update_user_scope(user, access_all, agent_ids or [], org_ids or [])
        logger.debug("UserDetailView user %s updated", pk)
        audit_log(request, action="USER_UPDATE", resource="users", resource_id=str(user.id))
        return Response(serializer.data)

    def delete(self, request, pk):
        logger.debug("UserDetailView DELETE — pk=%s user=%s", pk, request.user)
        user = self.get_object(pk)
        if not user:
            return Response({"detail": "Not found."}, status=404)
        if user == request.user:
            logger.debug("UserDetailView cannot delete own account")
            return Response({"detail": "Cannot delete own account."}, status=400)
        user_id = str(user.id)
        user.delete()
        logger.debug("UserDetailView user %s deleted", pk)
        audit_log(request, action="USER_DELETE", resource="users", resource_id=user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UserRoleAssignView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, pk):
        logger.debug("UserRoleAssignView POST — pk=%s user=%s role=%s", pk, request.user, request.data.get("role"))
        try:
            user = BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            logger.debug("UserRoleAssignView user not found pk=%s", pk)
            return Response({"detail": "Not found."}, status=404)
        role = request.data.get("role")
        if role not in dict(Role.choices):
            logger.debug("UserRoleAssignView invalid role: %s", role)
            return Response({"detail": f"Invalid role. Choices: {list(dict(Role.choices).keys())}"}, status=400)
        user.role = role
        user.save(update_fields=["role"])
        logger.debug("UserRoleAssignView user %s role set to %s", pk, role)
        audit_log(request, action="USER_ROLE_ASSIGN", resource="users", resource_id=str(user.id), details={"role": role})
        return Response(BeaconUserSerializer(user).data)


class UserEnableDisableView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, pk, action):
        logger.debug("UserEnableDisableView POST — pk=%s action=%s user=%s", pk, action, request.user)
        try:
            user = BeaconUser.objects.get(pk=pk)
        except BeaconUser.DoesNotExist:
            logger.debug("UserEnableDisableView user not found pk=%s", pk)
            return Response({"detail": "Not found."}, status=404)
        if action == "enable":
            user.is_active = True
        elif action == "disable":
            if user == request.user:
                logger.debug("UserEnableDisableView cannot disable own account")
                return Response({"detail": "Cannot disable own account."}, status=400)
            user.is_active = False
        else:
            logger.debug("UserEnableDisableView invalid action: %s", action)
            return Response({"detail": "Action must be enable or disable."}, status=400)
        user.save(update_fields=["is_active"])
        logger.debug("UserEnableDisableView user %s is_active=%s", pk, user.is_active)
        audit_log(request, action=f"USER_{action.upper()}", resource="users", resource_id=str(user.id))
        return Response(BeaconUserSerializer(user).data)


# ─── Organizations ────────────────────────────────────────────────────────────


class OrganizationListCreateView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        orgs = Organization.objects.all().order_by("name")
        data = []
        for org in orgs:
            agent_ids = list(org.agents.values_list("agent_id", flat=True))
            data.append({
                "id": org.id,
                "name": org.name,
                "description": org.description,
                "agent_ids": agent_ids,
                "created_at": org.created_at,
                "updated_at": org.updated_at,
            })
        return Response(data)

    def post(self, request):
        name = request.data.get("name")
        if not name:
            return Response({"detail": "name is required"}, status=400)
        description = request.data.get("description", "")
        org = Organization.objects.create(name=name, description=description)
        agent_ids = request.data.get("agent_ids", [])
        if agent_ids:
            OrganizationAgent.objects.bulk_create([
                OrganizationAgent(organization=org, agent_id=aid) for aid in agent_ids
            ], ignore_conflicts=True)
        audit_log(request, action="ORG_CREATE", resource="organizations", resource_id=str(org.id))
        return Response({"id": org.id, "name": org.name, "description": org.description, "agent_ids": agent_ids}, status=201)


class OrganizationDetailView(APIView):
    permission_classes = [IsAdministrator]

    def get_object(self, org_id):
        try:
            return Organization.objects.get(pk=org_id)
        except Organization.DoesNotExist:
            return None

    def get(self, request, org_id):
        org = self.get_object(org_id)
        if not org:
            return Response({"detail": "Not found."}, status=404)
        agent_ids = list(org.agents.values_list("agent_id", flat=True))
        return Response({
            "id": org.id,
            "name": org.name,
            "description": org.description,
            "agent_ids": agent_ids,
            "created_at": org.created_at,
            "updated_at": org.updated_at,
        })

    def patch(self, request, org_id):
        org = self.get_object(org_id)
        if not org:
            return Response({"detail": "Not found."}, status=404)
        org.name = request.data.get("name", org.name)
        org.description = request.data.get("description", org.description)
        org.save(update_fields=["name", "description", "updated_at"])

        agent_ids = request.data.get("agent_ids")
        if agent_ids is not None:
            OrganizationAgent.objects.filter(organization=org).exclude(agent_id__in=agent_ids).delete()
            existing = set(OrganizationAgent.objects.filter(organization=org).values_list("agent_id", flat=True))
            new_rows = [OrganizationAgent(organization=org, agent_id=aid) for aid in agent_ids if aid not in existing]
            if new_rows:
                OrganizationAgent.objects.bulk_create(new_rows, ignore_conflicts=True)

        audit_log(request, action="ORG_UPDATE", resource="organizations", resource_id=str(org.id))
        agent_ids_out = list(org.agents.values_list("agent_id", flat=True))
        return Response({"id": org.id, "name": org.name, "description": org.description, "agent_ids": agent_ids_out})

    def delete(self, request, org_id):
        org = self.get_object(org_id)
        if not org:
            return Response({"detail": "Not found."}, status=404)
        org_id_str = str(org.id)
        org.delete()
        audit_log(request, action="ORG_DELETE", resource="organizations", resource_id=org_id_str)
        return Response(status=204)


class RegistrationListView(APIView):
    permission_classes = [IsAdministrator]

    def get(self, request):
        qs = RegistrationRequest.objects.select_related("user").order_by("-created_at")
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)
        data = []
        for rr in qs:
            data.append({
                "id": rr.id,
                "user_id": rr.user.id,
                "username": rr.user.username,
                "email": rr.user.email,
                "role_requested": rr.role_requested,
                "status": rr.status,
                "reason": rr.reason,
                "created_at": rr.created_at,
                "decided_by": rr.decided_by,
                "decided_at": rr.decided_at,
            })
        return Response(data)


class RegistrationDecisionView(APIView):
    permission_classes = [IsAdministrator]

    def post(self, request, pk):
        action = request.data.get("action")
        logger.debug("RegistrationDecisionView action=%s pk=%s", action, pk)
        try:
            rr = RegistrationRequest.objects.select_related("user").get(pk=pk)
        except RegistrationRequest.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)

        if action not in {"approve", "reject"}:
            return Response({"detail": "action must be approve or reject"}, status=400)

        user = rr.user
        if action == "reject":
            rr.status = "rejected"
            rr.decided_by = request.user.username
            rr.decided_at = timezone.now()
            rr.save(update_fields=["status", "decided_by", "decided_at"])
            user.approval_status = "rejected"
            user.is_active = False
            user.save(update_fields=["approval_status", "is_active"])
            audit_log(request, action="REGISTRATION_REJECT", resource="users", resource_id=str(user.id), details={"approved_by": request.user.username})
            return Response({"detail": "Registration rejected."})

        # approve
        role = request.data.get("role") or rr.role_requested
        if role not in dict(Role.choices):
            return Response({"detail": "Invalid role."}, status=400)
        access_all = request.data.get("access_all_agents", False)
        agent_ids = request.data.get("agent_ids", [])
        org_ids = request.data.get("organization_ids", [])
        start_at_raw = request.data.get("start_at")
        expires_at_raw = request.data.get("expires_at")

        def _parse_dt(raw):
            if not raw:
                return None
            dt = parse_datetime(raw)
            if dt and timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_default_timezone())
            return dt

        start_at = _parse_dt(start_at_raw)
        expires_at = _parse_dt(expires_at_raw)
        if start_at and expires_at and start_at >= expires_at:
            return Response({"detail": "start_at must be before expires_at"}, status=400)

        with transaction.atomic():
            user.role = role
            user.approval_status = "approved"
            user.approved_by = request.user.username
            user.approved_at = timezone.now()
            user.is_active = True
            if start_at:
                user.start_at = start_at
            if expires_at:
                user.expires_at = expires_at
            user.save(update_fields=["role", "approval_status", "approved_by", "approved_at", "is_active", "start_at", "expires_at"])

            _update_user_scope(user, access_all, agent_ids, org_ids)

            rr.status = "approved"
            rr.decided_by = request.user.username
            rr.decided_at = timezone.now()
            rr.save(update_fields=["status", "decided_by", "decided_at"])

        audit_log(request, action="REGISTRATION_APPROVE", resource="users", resource_id=str(user.id), details={"role": role, "approved_by": request.user.username})
        return Response(BeaconUserSerializer(user).data)
