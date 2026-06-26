"""Shared database operations for agent ingest/command handling."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

from asgiref.sync import sync_to_async
from channels.layers import get_channel_layer
from django.conf import settings
from django.utils import timezone


logger = logging.getLogger("beacon.transport")


def _safe_agent_id(agent_id: str) -> str:
    return agent_id.replace(":", "_").replace("#", "_").replace(" ", "_")


@sync_to_async
def register_agent(payload: Dict[str, Any]) -> Dict[str, Any]:
    from apps.agents.models import Agent

    agent, _ = Agent.objects.update_or_create(
        agent_id=payload["agent_id"],
        defaults={
            "hostname": payload.get("hostname", "unknown"),
            "os": payload.get("os", "linux"),
            "architecture": payload.get("architecture", "x86_64"),
            "version": payload.get("version", "unknown"),
            "tags": payload.get("tags", []),
            "metadata": payload.get("metadata", {}),
            "status": "ONLINE",
            "last_seen": timezone.now(),
        },
    )
    secret = payload.get("secret")
    if secret:
        agent.set_secret(secret)
    return {
        "agent_id": agent.agent_id,
        "hostname": agent.hostname,
    }


@sync_to_async
def validate_agent_secret(agent_id: str, provided: str) -> bool:
    from apps.agents.models import Agent

    try:
        agent = Agent.objects.get(agent_id=agent_id)
    except Agent.DoesNotExist:
        return False
    return bool(agent.secret_hash) and agent.verify_secret(provided)


@sync_to_async
def touch_agent(agent_id: str, status: str = "ONLINE") -> None:
    from apps.agents.models import Agent

    Agent.objects.filter(agent_id=agent_id).update(
        last_seen=timezone.now(), status=status
    )


@sync_to_async
def update_agent_status(agent_id: str, status: str) -> None:
    from apps.agents.models import Agent

    Agent.objects.filter(agent_id=agent_id).update(status=status)


@sync_to_async
def save_metrics(agent_id: str, metrics: List[Dict[str, Any]]) -> Tuple[int, List[Dict[str, Any]]]:
    from apps.metrics.models import Metric, MetricResolution
    from apps.agents.models import Agent, CollectorHealth, CollectorStatus
    from apps.metrics.serializers import MetricSerializer
    from apps.metrics.views import update_latest_cache

    objects = []
    collector_names = set()

    for metric in metrics:
        if not isinstance(metric, dict):
            continue
        collector = str(metric.get("collector") or metric.get("metric_type") or "unknown")
        collector_names.add(collector)
        objects.append(
            Metric(
                agent_id=agent_id,
                metric_type=collector,
                resolution=MetricResolution.RAW,
                timestamp=metric.get("timestamp", timezone.now()),
                data=metric.get("data", {}),
                schema_version=metric.get("schema_version", "1.0"),
            )
        )

    serialized: List[Dict[str, Any]] = []
    if objects:
        Metric.objects.bulk_create(objects, batch_size=500)
        update_latest_cache(agent_id, objects)
        serialized = MetricSerializer(objects, many=True).data

        agent = Agent.objects.filter(agent_id=agent_id).first()
        if agent:
            now = timezone.now()
            for collector in collector_names:
                CollectorHealth.objects.update_or_create(
                    agent=agent,
                    collector=collector,
                    defaults={
                        "status": CollectorStatus.HEALTHY,
                        "last_run": now,
                        "last_success": now,
                    },
                )

    return len(objects), serialized


@sync_to_async
def save_logs(agent_id: str, logs: List[Dict[str, Any]]) -> int:
    from apps.logs.models import LogEntry

    entries = []
    for log in logs:
        if not isinstance(log, dict):
            continue
        message = str(log.get("message", "")).replace("\x00", "")[:8192]
        entries.append(
            LogEntry(
                agent_id=agent_id,
                source=log.get("source", "internal"),
                severity=log.get("severity", "Info"),
                message=message,
                timestamp=log.get("timestamp", timezone.now()),
                schema_version=log.get("schema_version", "1.0"),
                extra=log.get("extra", {}),
                sequence_number=log.get("sequence_number"),
            )
        )
    if entries:
        LogEntry.objects.bulk_create(entries, batch_size=500)
    return len(entries)


@sync_to_async
def update_collector_health(agent_id: str, payload: Dict[str, Any]) -> None:
    from apps.agents.models import Agent, CollectorHealth

    try:
        agent = Agent.objects.get(agent_id=agent_id)
    except Agent.DoesNotExist:
        return

    CollectorHealth.objects.update_or_create(
        agent=agent,
        collector=payload.get("collector", "unknown"),
        defaults={k: v for k, v in payload.items() if k != "collector"},
    )


@sync_to_async
def get_metric_config(agent_id: str) -> Dict[str, Any]:
    from apps.metrics.models import MetricConfig
    from apps.metrics.serializers import MetricConfigSerializer

    config, _ = MetricConfig.objects.get_or_create(agent_id=agent_id)
    return MetricConfigSerializer(config).data


async def broadcast_metrics(agent_id: str, metrics: List[Dict[str, Any]]) -> None:
    if not metrics:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:  # pragma: no cover
        return
    safe_id = _safe_agent_id(agent_id)
    for metric in metrics:
        try:
            await channel_layer.group_send(
                f"metrics_{safe_id}",
                {"type": "metric.update", "data": metric},
            )
        except Exception:  # pragma: no cover
            logger.exception("Failed to broadcast metric for agent %s", agent_id)


async def broadcast_logs(agent_id: str, count: int) -> None:
    if count <= 0:
        return
    channel_layer = get_channel_layer()
    if channel_layer is None:  # pragma: no cover
        return
    safe_id = _safe_agent_id(agent_id)
    try:
        await channel_layer.group_send(
            f"logs_{safe_id}",
            {"type": "log.entry", "data": {"agent_id": agent_id, "count": count}},
        )
    except Exception:  # pragma: no cover
        logger.exception("Failed to broadcast logs for agent %s", agent_id)
