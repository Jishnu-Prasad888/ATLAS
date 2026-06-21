from django.test import TestCase, override_settings
from django.core.cache import cache
from django.utils import timezone

from apps.agents.models import Agent, CollectorHealth, ProcessKillRequest
from apps.logs.models import LogEntry, LogSeverity, LogSource
from apps.metrics.models import Metric, MetricConfig, MetricResolution
from apps.metrics.views import cache_key_for_latest
from apps.audit.models import AuditLog


@override_settings(
    DATABASES={
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": ":memory:",
        }
    },
    CACHES={
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        }
    },
)
class AgentCleanupSignalTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_deleting_agent_purges_related_data_but_keeps_audit(self):
        agent = Agent.objects.create(agent_id="agent-123", hostname="host.example")
        agent_pk = agent.pk

        Metric.objects.create(
            agent_id=agent.agent_id,
            metric_type="cpu",
            resolution=MetricResolution.RAW,
            timestamp=timezone.now(),
            data={"usage": 0.5},
        )
        MetricConfig.objects.create(agent_id=agent.agent_id, cpu_enabled=False)
        LogEntry.objects.create(
            agent_id=agent.agent_id,
            source=LogSource.INTERNAL,
            severity=LogSeverity.INFO,
            message="hello",
            timestamp=timezone.now(),
        )
        ProcessKillRequest.objects.create(agent_id=agent.agent_id, pid=42)
        CollectorHealth.objects.create(agent=agent, collector="cpu")

        cache_key = cache_key_for_latest(agent.agent_id)
        cache.set(cache_key, {"cpu": {"usage": 0.5}})

        audit = AuditLog.objects.create(
            user="admin",
            ip_address="127.0.0.1",
            action="AGENT_REMOVE",
            resource="agents",
            resource_id=agent.agent_id,
        )

        agent.delete()

        self.assertEqual(Metric.objects.filter(agent_id=agent.agent_id).count(), 0)
        self.assertEqual(MetricConfig.objects.filter(agent_id=agent.agent_id).count(), 0)
        self.assertEqual(LogEntry.objects.filter(agent_id=agent.agent_id).count(), 0)
        self.assertEqual(ProcessKillRequest.objects.filter(agent_id=agent.agent_id).count(), 0)
        self.assertEqual(CollectorHealth.objects.filter(agent_id=agent_pk).count(), 0)
        self.assertIsNone(cache.get(cache_key))

        # Audit logs are immutable and should remain.
        self.assertTrue(AuditLog.objects.filter(id=audit.id).exists())
