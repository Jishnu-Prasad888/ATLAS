from django.urls import path

from .views import (
    DockerContainerDetailView,
    DockerContainerIngestView,
    DockerContainerListView,
    DockerContainerLogsView,
    KubernetesPodDetailView,
    KubernetesPodIngestView,
    KubernetesPodListView,
    KubernetesPodLogsView,
    NetworkConnectionIngestView,
    NetworkConnectionListView,
    NetworkInterfaceDetailView,
    NetworkInterfaceIngestView,
    NetworkInterfaceListView,
    ProcessConnectionsView,
    ProcessSnapshotDetailView,
    ProcessSnapshotIngestView,
    ProcessSnapshotListView,
)


urlpatterns = [
    # Docker
    path("docker/ingest/", DockerContainerIngestView.as_view(), name="ops-docker-ingest"),
    path(
        "docker/agents/<str:agent_id>/containers/",
        DockerContainerListView.as_view(),
        name="ops-docker-containers",
    ),
    path(
        "docker/agents/<str:agent_id>/containers/<str:container_id>/",
        DockerContainerDetailView.as_view(),
        name="ops-docker-container-detail",
    ),
    path(
        "docker/agents/<str:agent_id>/containers/<str:container_id>/logs/",
        DockerContainerLogsView.as_view(),
        name="ops-docker-container-logs",
    ),

    # Kubernetes
    path("k8s/ingest/", KubernetesPodIngestView.as_view(), name="ops-k8s-ingest"),
    path("k8s/agents/<str:agent_id>/pods/", KubernetesPodListView.as_view(), name="ops-k8s-pods"),
    path("k8s/agents/<str:agent_id>/pods/<str:pod_uid>/", KubernetesPodDetailView.as_view(), name="ops-k8s-pod-detail"),
    path("k8s/agents/<str:agent_id>/pods/<str:pod_uid>/logs/", KubernetesPodLogsView.as_view(), name="ops-k8s-pod-logs"),

    # Network
    path("network/ingest/interfaces/", NetworkInterfaceIngestView.as_view(), name="ops-net-if-ingest"),
    path("network/ingest/connections/", NetworkConnectionIngestView.as_view(), name="ops-net-conn-ingest"),
    path("network/agents/<str:agent_id>/interfaces/", NetworkInterfaceListView.as_view(), name="ops-net-if-list"),
    path("network/agents/<str:agent_id>/interfaces/<str:name>/", NetworkInterfaceDetailView.as_view(), name="ops-net-if-detail"),
    path("network/agents/<str:agent_id>/connections/", NetworkConnectionListView.as_view(), name="ops-net-conn-list"),

    # Processes
    path("processes/ingest/", ProcessSnapshotIngestView.as_view(), name="ops-process-ingest"),
    path("processes/agents/<str:agent_id>/", ProcessSnapshotListView.as_view(), name="ops-process-list"),
    path("processes/agents/<str:agent_id>/<int:pid>/", ProcessSnapshotDetailView.as_view(), name="ops-process-detail"),
    path("processes/agents/<str:agent_id>/<int:pid>/connections/", ProcessConnectionsView.as_view(), name="ops-process-connections"),
]
