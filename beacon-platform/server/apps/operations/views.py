"""
Operations Views — granular docker/k8s/network/process endpoints under /api/v1/operations/
"""
import logging

from django.db import transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.agents.views import _allowed_agent_ids
from apps.auth_rbac.permissions import IsViewer
from apps.logs.models import LogEntry, LogSource
from apps.logs.serializers import LogEntrySerializer

from .models import (
    DockerContainer,
    KubernetesPod,
    NetworkConnection,
    NetworkInterface,
    ProcessSnapshot,
)
from .serializers import (
    DockerContainerBatchSerializer,
    DockerContainerSerializer,
    KubernetesPodBatchSerializer,
    KubernetesPodSerializer,
    NetworkConnectionBatchSerializer,
    NetworkConnectionSerializer,
    NetworkInterfaceBatchSerializer,
    NetworkInterfaceSerializer,
    ProcessSnapshotBatchSerializer,
    ProcessSnapshotSerializer,
)

logger = logging.getLogger("beacon")


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _agent_scope_allowed(request, agent_id: str) -> bool:
    allowed = _allowed_agent_ids(request.user)
    if allowed is None:
        return True
    return agent_id in allowed


def _forbidden_if_not_allowed(request, agent_id: str):
    if not _agent_scope_allowed(request, agent_id):
        return Response({"detail": "Not authorized for this agent."}, status=status.HTTP_403_FORBIDDEN)
    return None


# ─── Docker ───────────────────────────────────────────────────────────────────


class DockerContainerIngestView(APIView):
    permission_classes: list = []  # trusted agent ingestion

    def post(self, request):
        serializer = DockerContainerBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agent_id = data["agent_id"]
        containers = data["containers"]
        logger.debug("DockerContainerIngestView agent=%s count=%s", agent_id, len(containers))

        with transaction.atomic():
            for item in containers:
                DockerContainer.objects.update_or_create(
                    agent_id=agent_id,
                    container_id=item["container_id"],
                    defaults={k: v for k, v in item.items() if k != "container_id"},
                )
        return Response({"upserted": len(containers)}, status=status.HTTP_201_CREATED)


class DockerContainerListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = DockerContainer.objects.filter(agent_id=agent_id)
        state = request.query_params.get("state")
        if state:
            qs = qs.filter(state=state)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(image__icontains=q) | Q(container_id__icontains=q))
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        qs = qs.order_by("name")[:limit]
        return Response(DockerContainerSerializer(qs, many=True).data)


class DockerContainerDetailView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, container_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        try:
            container = DockerContainer.objects.get(agent_id=agent_id, container_id=container_id)
        except DockerContainer.DoesNotExist:
            return Response({"detail": "Container not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(DockerContainerSerializer(container).data)


class DockerContainerLogsView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, container_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        limit = min(int(request.query_params.get("limit", 200)), 2000)
        qs = (
            LogEntry.objects.filter(
                agent_id=agent_id,
                source=LogSource.DOCKER,
                extra__container_id=container_id,
            )
            .order_by("-timestamp")
            [:limit]
        )
        return Response(LogEntrySerializer(qs, many=True).data)


# ─── Kubernetes ───────────────────────────────────────────────────────────────


class KubernetesPodIngestView(APIView):
    permission_classes: list = []

    def post(self, request):
        serializer = KubernetesPodBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agent_id = data["agent_id"]
        pods = data["pods"]
        logger.debug("KubernetesPodIngestView agent=%s count=%s", agent_id, len(pods))

        with transaction.atomic():
            for item in pods:
                KubernetesPod.objects.update_or_create(
                    agent_id=agent_id,
                    uid=item["uid"],
                    defaults={k: v for k, v in item.items() if k != "uid"},
                )
        return Response({"upserted": len(pods)}, status=status.HTTP_201_CREATED)


class KubernetesPodListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = KubernetesPod.objects.filter(agent_id=agent_id)
        namespace = request.query_params.get("namespace")
        if namespace:
            qs = qs.filter(namespace=namespace)
        phase = request.query_params.get("phase")
        if phase:
            qs = qs.filter(phase=phase)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(uid__icontains=q))
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        qs = qs.order_by("namespace", "name")[:limit]
        return Response(KubernetesPodSerializer(qs, many=True).data)


class KubernetesPodDetailView(APIView):

    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, pod_uid: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        try:
            pod = KubernetesPod.objects.get(agent_id=agent_id, uid=pod_uid)
        except KubernetesPod.DoesNotExist:
            return Response({"detail": "Pod not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(KubernetesPodSerializer(pod).data)


class KubernetesPodLogsView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, pod_uid: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        limit = min(int(request.query_params.get("limit", 200)), 2000)
        qs = (
            LogEntry.objects.filter(
                agent_id=agent_id,
                source=LogSource.K8S,
                extra__pod_uid=pod_uid,
            )
            .order_by("-timestamp")
            [:limit]
        )
        return Response(LogEntrySerializer(qs, many=True).data)


# ─── Network ──────────────────────────────────────────────────────────────────


class NetworkInterfaceIngestView(APIView):
    permission_classes: list = []

    def post(self, request):
        serializer = NetworkInterfaceBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agent_id = data["agent_id"]
        interfaces = data["interfaces"]
        logger.debug("NetworkInterfaceIngestView agent=%s count=%s", agent_id, len(interfaces))
        with transaction.atomic():
            for item in interfaces:
                NetworkInterface.objects.update_or_create(
                    agent_id=agent_id,
                    name=item["name"],
                    defaults={k: v for k, v in item.items() if k != "name"},
                )
        return Response({"upserted": len(interfaces)}, status=status.HTTP_201_CREATED)


class NetworkConnectionIngestView(APIView):
    permission_classes: list = []

    def post(self, request):
        serializer = NetworkConnectionBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agent_id = data["agent_id"]
        connections = data["connections"]
        logger.debug("NetworkConnectionIngestView agent=%s count=%s", agent_id, len(connections))
        with transaction.atomic():
            for item in connections:
                NetworkConnection.objects.update_or_create(
                    agent_id=agent_id,
                    pid=item.get("pid"),
                    laddr=item.get("laddr", ""),
                    lport=item.get("lport"),
                    raddr=item.get("raddr", ""),
                    rport=item.get("rport"),
                    protocol=item.get("protocol") or NetworkConnection.TCP,
                    defaults={k: v for k, v in item.items() if k not in {"pid", "laddr", "lport", "raddr", "rport", "protocol"}},
                )
        return Response({"upserted": len(connections)}, status=status.HTTP_201_CREATED)


class NetworkInterfaceListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = NetworkInterface.objects.filter(agent_id=agent_id).order_by("name")
        return Response(NetworkInterfaceSerializer(qs, many=True).data)


class NetworkInterfaceDetailView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, name: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        try:
            iface = NetworkInterface.objects.get(agent_id=agent_id, name=name)
        except NetworkInterface.DoesNotExist:
            return Response({"detail": "Interface not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(NetworkInterfaceSerializer(iface).data)


class NetworkConnectionListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = NetworkConnection.objects.filter(agent_id=agent_id)
        pid = request.query_params.get("pid")
        if pid is not None:
            qs = qs.filter(pid=pid)
        protocol = request.query_params.get("protocol")
        if protocol:
            qs = qs.filter(protocol=protocol)
        state = request.query_params.get("state")
        if state:
            qs = qs.filter(state=state)
        limit = min(int(request.query_params.get("limit", 500)), 2000)
        qs = qs.order_by("-updated_at")[:limit]
        return Response(NetworkConnectionSerializer(qs, many=True).data)


# ─── Processes ────────────────────────────────────────────────────────────────


class ProcessSnapshotIngestView(APIView):
    permission_classes: list = []

    def post(self, request):
        serializer = ProcessSnapshotBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        agent_id = data["agent_id"]
        processes = data["processes"]
        logger.debug("ProcessSnapshotIngestView agent=%s count=%s", agent_id, len(processes))
        with transaction.atomic():
            for item in processes:
                ProcessSnapshot.objects.update_or_create(
                    agent_id=agent_id,
                    pid=item["pid"],
                    defaults={k: v for k, v in item.items() if k != "pid"},
                )
        return Response({"upserted": len(processes)}, status=status.HTTP_201_CREATED)


class ProcessSnapshotListView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = ProcessSnapshot.objects.filter(agent_id=agent_id)
        q = request.query_params.get("q")
        if q:
            qs = qs.filter(Q(name__icontains=q) | Q(cmdline__icontains=q))
        limit = min(int(request.query_params.get("limit", 200)), 1000)
        qs = qs.order_by("pid")[:limit]
        return Response(ProcessSnapshotSerializer(qs, many=True).data)


class ProcessSnapshotDetailView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, pid: int):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        try:
            proc = ProcessSnapshot.objects.get(agent_id=agent_id, pid=pid)
        except ProcessSnapshot.DoesNotExist:
            return Response({"detail": "Process not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(ProcessSnapshotSerializer(proc).data)


class ProcessConnectionsView(APIView):
    permission_classes = [IsViewer]

    def get(self, request, agent_id: str, pid: int):
        forbidden = _forbidden_if_not_allowed(request, agent_id)
        if forbidden:
            return forbidden
        qs = NetworkConnection.objects.filter(agent_id=agent_id, pid=pid).order_by("-updated_at")
        return Response(NetworkConnectionSerializer(qs, many=True).data)
