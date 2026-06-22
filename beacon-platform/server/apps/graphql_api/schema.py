from __future__ import annotations

from datetime import datetime
from typing import List, Optional

import strawberry
from strawberry.scalars import JSON
from strawberry.types import Info

from django.db.models import Q

from apps.agents.views import _allowed_agent_ids
from apps.metrics.models import Metric
from apps.operations.models import (
    DockerContainer,
    KubernetesPod,
    NetworkConnection,
    NetworkInterface,
    ProcessSnapshot,
)


def _ensure_agent_access(info: Info, agent_id: str) -> None:
    request = info.context.request
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        raise PermissionError("Authentication required")
    allowed = _allowed_agent_ids(user)
    if allowed is not None and agent_id not in allowed:
        raise PermissionError("Not authorized for this agent")


@strawberry.type
class DockerContainerType:
    agent_id: str
    container_id: str
    name: str
    image: str
    state: str
    status: str
    health: Optional[str]
    started_at: Optional[datetime]
    cpu_pct: Optional[float]
    mem_pct: Optional[float]
    mem_bytes: Optional[int]
    pids: Optional[int]
    rx_bytes: int
    tx_bytes: int
    blk_read_bytes: int
    blk_write_bytes: int
    updated_at: datetime

    @classmethod
    def from_model(cls, obj: DockerContainer) -> "DockerContainerType":
        return cls(**{field: getattr(obj, field) for field in cls.__annotations__.keys()})


@strawberry.type
class KubernetesPodType:
    agent_id: str
    uid: str
    name: str
    namespace: str
    node: Optional[str]
    phase: str
    restart_count: int
    started_at: Optional[datetime]
    labels: JSON
    annotations: JSON
    container_statuses: JSON
    updated_at: datetime

    @classmethod
    def from_model(cls, obj: KubernetesPod) -> "KubernetesPodType":
        payload = {field: getattr(obj, field) for field in cls.__annotations__.keys()}
        return cls(**payload)


@strawberry.type
class NetworkInterfaceType:
    agent_id: str
    name: str
    address: Optional[str]
    mac: Optional[str]
    mtu: Optional[int]
    speed_mbps: Optional[int]
    rx_bytes: int
    tx_bytes: int
    rx_errors: int
    tx_errors: int
    rx_dropped: int
    tx_dropped: int
    meta: JSON
    updated_at: datetime

    @classmethod
    def from_model(cls, obj: NetworkInterface) -> "NetworkInterfaceType":
        return cls(**{field: getattr(obj, field) for field in cls.__annotations__.keys()})


@strawberry.type
class NetworkConnectionType:
    agent_id: str
    pid: Optional[int]
    process_name: Optional[str]
    username: Optional[str]
    laddr: Optional[str]
    lport: Optional[int]
    raddr: Optional[str]
    rport: Optional[int]
    protocol: str
    state: Optional[str]
    updated_at: datetime

    @classmethod
    def from_model(cls, obj: NetworkConnection) -> "NetworkConnectionType":
        payload = {field: getattr(obj, field) for field in cls.__annotations__.keys()}
        return cls(**payload)


@strawberry.type
class ProcessSnapshotType:
    agent_id: str
    pid: int
    name: str
    username: Optional[str]
    cmdline: Optional[str]
    cpu_pct: Optional[float]
    mem_pct: Optional[float]
    mem_bytes: Optional[int]
    started_at: Optional[datetime]
    meta: JSON
    updated_at: datetime

    @classmethod
    def from_model(cls, obj: ProcessSnapshot) -> "ProcessSnapshotType":
        return cls(**{field: getattr(obj, field) for field in cls.__annotations__.keys()})


@strawberry.type
class MetricSample:
    agent_id: str
    metric_type: str
    resolution: str
    timestamp: datetime
    data: JSON
    schema_version: str

    @classmethod
    def from_model(cls, obj: Metric) -> "MetricSample":
        return cls(
            agent_id=obj.agent_id,
            metric_type=obj.metric_type,
            resolution=obj.resolution,
            timestamp=obj.timestamp,
            data=obj.data,
            schema_version=obj.schema_version,
        )


@strawberry.type
class Query:
    @strawberry.field
    def docker_containers(
        self,
        info: Info,
        agent_id: str,
        state: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 100,
    ) -> List[DockerContainerType]:
        _ensure_agent_access(info, agent_id)
        qs = DockerContainer.objects.filter(agent_id=agent_id)
        if state:
            qs = qs.filter(state=state)
        if search:
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(image__icontains=search)
                | Q(container_id__icontains=search)
            )
        qs = qs.order_by("name")[: min(limit, 500)]
        return [DockerContainerType.from_model(obj) for obj in qs]

    @strawberry.field
    def docker_container(self, info: Info, agent_id: str, container_id: str) -> Optional[DockerContainerType]:
        _ensure_agent_access(info, agent_id)
        try:
            obj = DockerContainer.objects.get(agent_id=agent_id, container_id=container_id)
        except DockerContainer.DoesNotExist:
            return None
        return DockerContainerType.from_model(obj)

    @strawberry.field
    def kubernetes_pods(
        self,
        info: Info,
        agent_id: str,
        namespace: Optional[str] = None,
        phase: Optional[str] = None,
        limit: int = 200,
    ) -> List[KubernetesPodType]:
        _ensure_agent_access(info, agent_id)
        qs = KubernetesPod.objects.filter(agent_id=agent_id)
        if namespace:
            qs = qs.filter(namespace=namespace)
        if phase:
            qs = qs.filter(phase=phase)
        qs = qs.order_by("namespace", "name")[: min(limit, 500)]
        return [KubernetesPodType.from_model(obj) for obj in qs]

    @strawberry.field
    def kubernetes_pod(self, info: Info, agent_id: str, uid: str) -> Optional[KubernetesPodType]:
        _ensure_agent_access(info, agent_id)
        try:
            obj = KubernetesPod.objects.get(agent_id=agent_id, uid=uid)
        except KubernetesPod.DoesNotExist:
            return None
        return KubernetesPodType.from_model(obj)

    @strawberry.field
    def network_interfaces(self, info: Info, agent_id: str) -> List[NetworkInterfaceType]:
        _ensure_agent_access(info, agent_id)
        qs = NetworkInterface.objects.filter(agent_id=agent_id).order_by("name")
        return [NetworkInterfaceType.from_model(obj) for obj in qs]

    @strawberry.field
    def network_connections(
        self,
        info: Info,
        agent_id: str,
        pid: Optional[int] = None,
        protocol: Optional[str] = None,
        state: Optional[str] = None,
        limit: int = 200,
    ) -> List[NetworkConnectionType]:
        _ensure_agent_access(info, agent_id)
        qs = NetworkConnection.objects.filter(agent_id=agent_id)
        if pid is not None:
            qs = qs.filter(pid=pid)
        if protocol:
            qs = qs.filter(protocol=protocol)
        if state:
            qs = qs.filter(state=state)
        qs = qs.order_by("-updated_at")[: min(limit, 1000)]
        return [NetworkConnectionType.from_model(obj) for obj in qs]

    @strawberry.field
    def processes(
        self,
        info: Info,
        agent_id: str,
        search: Optional[str] = None,
        limit: int = 200,
    ) -> List[ProcessSnapshotType]:
        _ensure_agent_access(info, agent_id)
        qs = ProcessSnapshot.objects.filter(agent_id=agent_id)
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(cmdline__icontains=search))
        qs = qs.order_by("pid")[: min(limit, 1000)]
        return [ProcessSnapshotType.from_model(obj) for obj in qs]

    @strawberry.field
    def process(self, info: Info, agent_id: str, pid: int) -> Optional[ProcessSnapshotType]:
        _ensure_agent_access(info, agent_id)
        try:
            obj = ProcessSnapshot.objects.get(agent_id=agent_id, pid=pid)
        except ProcessSnapshot.DoesNotExist:
            return None
        return ProcessSnapshotType.from_model(obj)

    @strawberry.field
    def process_connections(self, info: Info, agent_id: str, pid: int) -> List[NetworkConnectionType]:
        _ensure_agent_access(info, agent_id)
        qs = NetworkConnection.objects.filter(agent_id=agent_id, pid=pid).order_by("-updated_at")
        return [NetworkConnectionType.from_model(obj) for obj in qs]

    @strawberry.field
    def metrics(
        self,
        info: Info,
        agent_id: str,
        metric_type: str,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        resolution: Optional[str] = None,
        limit: int = 500,
    ) -> List[MetricSample]:
        _ensure_agent_access(info, agent_id)
        qs = Metric.objects.filter(agent_id=agent_id, metric_type=metric_type)
        if resolution:
            qs = qs.filter(resolution=resolution)
        if start:
            qs = qs.filter(timestamp__gte=start)
        if end:
            qs = qs.filter(timestamp__lte=end)
        qs = qs.order_by("-timestamp")[: min(limit, 2000)]
        return [MetricSample.from_model(obj) for obj in qs]

    @strawberry.field
    def latest_metrics(self, info: Info, agent_id: str) -> List[MetricSample]:
        _ensure_agent_access(info, agent_id)
        latest = (
            Metric.objects.filter(agent_id=agent_id)
            .order_by("metric_type", "-timestamp")
            .distinct("metric_type")
        )
        return [MetricSample.from_model(obj) for obj in latest]


schema = strawberry.Schema(query=Query)
