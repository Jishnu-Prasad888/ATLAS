"""
Beacon Metrics Views — /api/v1/telemetry/ and /api/v1/metrics/
"""
import logging
from collections.abc import Iterable

from django.utils import timezone
from django.core.cache import cache
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from apps.auth_rbac.permissions import IsAdminOrReadOnly, IsViewer, IsAdministrator
from .models import Metric, MetricConfig, MetricResolution
from .serializers import (
    MetricSerializer,
    MetricIngestSerializer,
    MetricBatchIngestSerializer,
    MetricConfigSerializer,
    MetricQuerySerializer,
)

logger = logging.getLogger("beacon")
channel_layer = get_channel_layer()

LATEST_CACHE_PREFIX = "latest_metrics:"
LATEST_CACHE_TTL = 60


def cache_key_for_latest(agent_id: str) -> str:
    return f"{LATEST_CACHE_PREFIX}{agent_id}"


def cache_safe_get(key: str):
    try:
        return cache.get(key)
    except Exception as exc:  # pragma: no cover - cache backend failures
        logger.warning("Metric cache get failed for %s: %s", key, exc)
        return None


def cache_safe_set(key: str, value: dict) -> None:
    try:
        cache.set(key, value, LATEST_CACHE_TTL)
    except Exception as exc:  # pragma: no cover - cache backend failures
        logger.warning("Metric cache set failed for %s: %s", key, exc)


def update_latest_cache(agent_id: str, metric_objects: Iterable[Metric]):
    """Update Redis cache with newly ingested metrics for an agent."""
    key = cache_key_for_latest(agent_id)
    cached = cache_safe_get(key)
    if cached is None:
        return
    for metric in metric_objects:
        cached[metric.metric_type] = MetricSerializer(metric).data
    cache_safe_set(key, cached)


def broadcast_metric(agent_id: str, metric_data: dict):
    """Push metric to WebSocket subscribers on the metrics channel."""
    try:
        async_to_sync(channel_layer.group_send)(
            f"metrics_{agent_id}",
            {"type": "metric.update", "data": metric_data},
        )
    except Exception as e:
        logger.warning(f"WebSocket broadcast failed: {e}")


class MetricIngestView(APIView):
    """
    POST /api/v1/telemetry/ingest/
    Accepts batches of metrics from agents.
    """
    permission_classes = []  # Agent-authenticated via header

    def post(self, request):
        serializer = MetricBatchIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data     = serializer.validated_data
        agent_id = data["agent_id"]
        metrics  = data["metrics"]
        logger.debug("MetricIngestView POST — agent_id=%s metric_count=%s", agent_id, len(metrics))

        objects = [
            Metric(
                agent_id       = agent_id,
                metric_type    = m["metric_type"],
                resolution     = MetricResolution.RAW,
                timestamp      = m["timestamp"],
                data           = m["data"],
                schema_version = m.get("schema_version", "1.0"),
            )
            for m in metrics
        ]
        Metric.objects.bulk_create(objects, batch_size=500)
        logger.debug("MetricIngestView ingested %d metrics for agent %s", len(objects), agent_id)

        if objects:
            broadcast_metric(agent_id, MetricSerializer(objects[-1]).data)
            update_latest_cache(agent_id, objects)

        return Response({"ingested": len(objects)}, status=status.HTTP_201_CREATED)


class MetricListView(APIView):
    """
    GET /api/v1/telemetry/
    Query metrics with optional filters.
    """
    permission_classes = [IsViewer]

    def get(self, request):
        qs_serializer = MetricQuerySerializer(data=request.query_params)
        qs_serializer.is_valid(raise_exception=True)
        params = qs_serializer.validated_data
        logger.debug("MetricListView GET — params=%s user=%s", params, request.user)

        qs = Metric.objects.all()
        if params.get("agent_id"):
            qs = qs.filter(agent_id=params["agent_id"])
        if params.get("metric_type"):
            qs = qs.filter(metric_type=params["metric_type"])
        if params.get("resolution"):
            qs = qs.filter(resolution=params["resolution"])
        if params.get("start"):
            qs = qs.filter(timestamp__gte=params["start"])
        if params.get("end"):
            qs = qs.filter(timestamp__lte=params["end"])

        qs = qs.order_by("-timestamp")[: params.get("limit", 1000)]
        logger.debug("MetricListView returning %d metrics", len(qs))
        return Response(MetricSerializer(qs, many=True).data)


class MetricLatestView(APIView):
    """
    GET /api/v1/telemetry/latest/<agent_id>/
    Latest metric of each type for the agent.
    """
    permission_classes = [IsViewer]

    def get(self, request, agent_id):
        logger.debug("MetricLatestView GET — agent_id=%s user=%s", agent_id, request.user)

        key = cache_key_for_latest(agent_id)
        result = cache_safe_get(key)
        if result is not None:
            logger.debug("MetricLatestView cache HIT for agent %s", agent_id)
            return Response(result)

        logger.debug("MetricLatestView cache MISS for agent %s — querying DB", agent_id)
        latest_metrics = (
            Metric.objects
            .filter(agent_id=agent_id)
            .order_by("metric_type", "-timestamp")
            .distinct("metric_type")
        )
        result = {
            metric.metric_type: MetricSerializer(metric).data
            for metric in latest_metrics
        }

        cache_safe_set(key, result)
        logger.debug("MetricLatestView returning %d metric types for agent %s", len(result), agent_id)
        return Response(result)


class MetricPruneView(APIView):
    """
    POST /api/v1/telemetry/prune/
    Manually trigger data retention pruning (Admin only).
    """
    permission_classes = [IsAdministrator]

    def post(self, request):
        logger.debug("MetricPruneView POST — user=%s", request.user)
        from datetime import timedelta
        now = timezone.now()
        raw_cutoff = now - timedelta(hours=24)
        raw_deleted, _ = Metric.objects.filter(resolution=MetricResolution.RAW, timestamp__lt=raw_cutoff).delete()
        min_cutoff = now - timedelta(days=30)
        min_deleted, _ = Metric.objects.filter(resolution=MetricResolution.MIN1, timestamp__lt=min_cutoff).delete()
        hr_cutoff = now - timedelta(days=365)
        hr_deleted, _ = Metric.objects.filter(resolution=MetricResolution.HOUR1, timestamp__lt=hr_cutoff).delete()
        logger.debug("MetricPruneView pruned raw=%d min=%d hr=%d", raw_deleted, min_deleted, hr_deleted)
        return Response({
            "pruned": {
                "raw_1s_24h":    raw_deleted,
                "rollup_1m_30d": min_deleted,
                "rollup_1h_365d": hr_deleted,
            }
        })


# ─── Metric Config ────────────────────────────────────────────────────────────

class MetricConfigView(APIView):
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request, agent_id):
        logger.debug("MetricConfigView GET — agent_id=%s user=%s", agent_id, request.user)
        config, _ = MetricConfig.objects.get_or_create(agent_id=agent_id)
        return Response(MetricConfigSerializer(config).data)

    def patch(self, request, agent_id):
        logger.debug("MetricConfigView PATCH — agent_id=%s data=%s user=%s", agent_id, request.data, request.user)
        config, _ = MetricConfig.objects.get_or_create(agent_id=agent_id)
        serializer = MetricConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logger.debug("MetricConfigView config updated for agent %s", agent_id)

        # Push updated config to agent via WebSocket
        safe_id = agent_id.replace(":", "_").replace("#", "_").replace(" ", "_")
        try:
            async_to_sync(channel_layer.group_send)(
                f"agent_{safe_id}",
                {
                    "type": "agent.command",
                    "data": {
                        "type": "config_update",
                        "payload": serializer.data,
                    },
                },
            )
            logger.debug("MetricConfigView config_update sent via group_send to agent_%s", safe_id)
        except Exception as e:
            logger.warning("MetricConfigView WebSocket group_send failed: %s", e)

        return Response(serializer.data)
