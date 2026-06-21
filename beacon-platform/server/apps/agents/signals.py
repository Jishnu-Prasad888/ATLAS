"""
Agent lifecycle signals.
Ensures that when an agent is removed, all agent-scoped data is purged
across metrics, logs, configs, process requests, and cache.
Audit logs remain intact by design.
"""
import logging

from django.core.cache import cache
from django.db.models.signals import post_delete
from django.dispatch import receiver

from apps.agents.models import Agent, CollectorHealth, ProcessKillRequest
from apps.logs.models import LogEntry
from apps.metrics.models import Metric, MetricConfig
from apps.metrics.views import cache_key_for_latest

logger = logging.getLogger("beacon")


@receiver(post_delete, sender=Agent)
def purge_agent_data(sender, instance: Agent, **kwargs):
    """Remove all agent-scoped data once the agent is deleted."""
    agent_id = instance.agent_id

    Metric.objects.filter(agent_id=agent_id).delete()
    MetricConfig.objects.filter(agent_id=agent_id).delete()
    LogEntry.objects.filter(agent_id=agent_id).delete()
    ProcessKillRequest.objects.filter(agent_id=agent_id).delete()

    # CollectorHealth has on_delete=CASCADE, but ensure no stragglers remain.
    CollectorHealth.objects.filter(agent=instance).delete()

    # Clear cached latest metrics for the agent.
    try:
        cache.delete(cache_key_for_latest(agent_id))
    except Exception as exc:  # pragma: no cover - cache backend issues
        logger.warning("Failed to clear metric cache for %s: %s", agent_id, exc)

    logger.debug("Purged data for deleted agent %s", agent_id)
