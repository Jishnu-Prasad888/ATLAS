"""
Beacon WebSocket Consumers
Handles:
  - Agent ingest connections (/ws/ingest/)
  - Client subscriptions (/ws/subscribe/)

Channels:
  - logs_<agent_id>
  - metrics_<agent_id>
  - telemetry_<agent_id>
  - health_<agent_id>
"""
import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone

from apps.metrics.views import update_latest_cache

logger = logging.getLogger("beacon")

VALID_CHANNELS = {"logs", "metrics", "telemetry", "health"}


class AgentIngestConsumer(AsyncWebsocketConsumer):
    """
    Accepts WebSocket connections from beacon-agent processes.
    Agents register, send heartbeats, push metrics and logs.
    """

    async def connect(self):
        self.agent_id   = None
        self.registered = False
        await self.accept()
        client = self.scope.get('client')
        logger.info(f"AgentIngestConsumer connect — client={client}")
        logger.debug("AgentIngestConsumer awaiting registration from %s", client)

    @property
    def safe_agent_id(self):
        return self.agent_id.replace(":", "_").replace("#", "_").replace(" ", "_") if self.agent_id else None

    async def disconnect(self, close_code):
        logger.debug("AgentIngestConsumer disconnect — agent_id=%s code=%s", self.agent_id, close_code)
        if self.agent_id:
            await self.channel_layer.group_discard(f"agent_{self.safe_agent_id}", self.channel_name)
            await self.mark_agent_offline(self.agent_id)
            logger.debug("AgentIngestConsumer agent %s marked offline", self.agent_id)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            if bytes_data:
                import msgpack
                data = msgpack.unpackb(bytes_data, raw=False)
            else:
                data = json.loads(text_data or "{}")
        except Exception as e:
            logger.debug("AgentIngestConsumer receive — parse error: %s", e)
            await self.send_json({"error": f"Invalid message format: {e}"})
            return

        msg_type = data.get("type")
        logger.debug("AgentIngestConsumer receive — agent_id=%s type=%s", self.agent_id, msg_type)
        handlers = {
            "register":           self.handle_register,
            "heartbeat":          self.handle_heartbeat,
            "metrics":            self.handle_metrics,
            "logs":               self.handle_logs,
            "collector_health":   self.handle_collector_health,
            "status_update":      self.handle_status_update,
            "config_request":     self.handle_config_request,
        }
        handler = handlers.get(msg_type)
        if handler:
            await handler(data)
        else:
            logger.debug("AgentIngestConsumer unknown message type: %s", msg_type)
            await self.send_json({"error": f"Unknown message type: {msg_type}"})

    # ─── Handlers ─────────────────────────────────────────────────────────────

    async def handle_register(self, data):
        payload = data.get("payload", {})
        agent_id = payload.get("agent_id")
        if not agent_id:
            logger.debug("AgentIngestConsumer register — missing agent_id")
            await self.send_json({"error": "agent_id is required"})
            return

        logger.debug("AgentIngestConsumer register — agent_id=%s hostname=%s", agent_id, payload.get("hostname"))
        agent = await self.register_agent(payload)
        self.agent_id   = agent_id
        self.registered = True

        await self.channel_layer.group_add(f"agent_{self.safe_agent_id}", self.channel_name)
        await self.send_json({
            "type": "registered",
            "agent_id": agent_id,
            "server_time": timezone.now().isoformat(),
        })
        logger.info(f"Agent registered: {agent_id} ({payload.get('hostname')})")

    async def handle_heartbeat(self, data):
        logger.debug("AgentIngestConsumer heartbeat — agent_id=%s", self.agent_id)
        if not self.registered:
            logger.debug("AgentIngestConsumer heartbeat — not registered")
            await self.send_json({"error": "Not registered"})
            return
        await self.touch_agent(self.agent_id, data.get("status", "ONLINE"))
        await self.send_json({
            "type": "heartbeat_ack",
            "server_time": timezone.now().isoformat(),
        })

    async def handle_metrics(self, data):
        logger.debug("AgentIngestConsumer metrics — agent_id=%s", self.agent_id)
        if not self.registered:
            logger.debug("AgentIngestConsumer metrics — not registered")
            return
        metrics = data.get("payload", [])
        if not isinstance(metrics, list):
            metrics = [metrics]
        saved = await self.save_metrics(self.agent_id, metrics)
        logger.debug("AgentIngestConsumer metrics — saved %d metrics for agent %s", saved, self.agent_id)
        await self.channel_layer.group_send(
            f"metrics_{self.safe_agent_id}",
            {"type": "metric.update", "data": {"agent_id": self.agent_id, "count": saved}},
        )
        await self.send_json({"type": "metrics_ack", "ingested": saved})

    async def handle_logs(self, data):
        logger.debug("AgentIngestConsumer logs — agent_id=%s", self.agent_id)
        if not self.registered:
            logger.debug("AgentIngestConsumer logs — not registered")
            return
        logs = data.get("payload", [])
        if not isinstance(logs, list):
            logs = [logs]
        saved = await self.save_logs(self.agent_id, logs)
        logger.debug("AgentIngestConsumer logs — saved %d logs for agent %s", saved, self.agent_id)
        await self.channel_layer.group_send(
            f"logs_{self.safe_agent_id}",
            {"type": "log.entry", "data": {"agent_id": self.agent_id, "count": saved}},
        )
        await self.send_json({"type": "logs_ack", "ingested": saved})

    async def handle_collector_health(self, data):
        logger.debug("AgentIngestConsumer collector_health — agent_id=%s", self.agent_id)
        if not self.registered:
            logger.debug("AgentIngestConsumer collector_health — not registered")
            return
        payload = data.get("payload", {})
        await self.update_collector_health(self.agent_id, payload)
        logger.debug("AgentIngestConsumer collector_health updated for %s", self.agent_id)
        await self.send_json({"type": "collector_health_ack"})

    async def handle_status_update(self, data):
        logger.debug("AgentIngestConsumer status_update — agent_id=%s status=%s", self.agent_id, data.get("status"))
        if not self.registered:
            logger.debug("AgentIngestConsumer status_update — not registered")
            return
        new_status = data.get("status", "ONLINE")
        await self.update_agent_status(self.agent_id, new_status)
        logger.debug("AgentIngestConsumer status_update — %s status set to %s", self.agent_id, new_status)
        await self.send_json({"type": "status_ack", "status": new_status})

    async def handle_config_request(self, data):
        """Respond to agent's config_request with the current MetricConfig."""
        agent_id = data.get("agent_id") or self.agent_id
        if not agent_id:
            await self.send_json({"error": "agent_id is required for config_request"})
            return
        config_data = await self.get_metric_config(agent_id)
        await self.send_json({
            "type": "config_update",
            "payload": config_data,
        })

    # ─── Channel layer message handlers ───────────────────────────────────────

    async def agent_command(self, event):
        """Forward server→agent commands (e.g. config_update)."""
        await self.send_json(event.get("data", {}))

    # ─── DB helpers ───────────────────────────────────────────────────────────

    @database_sync_to_async
    def register_agent(self, payload):
        from apps.agents.models import Agent
        agent, _ = Agent.objects.update_or_create(
            agent_id=payload["agent_id"],
            defaults={
                "hostname":     payload.get("hostname", "unknown"),
                "os":           payload.get("os", "linux"),
                "architecture": payload.get("architecture", "x86_64"),
                "version":      payload.get("version", "unknown"),
                "tags":         payload.get("tags", []),
                "metadata":     payload.get("metadata", {}),
                "status":       "ONLINE",
                "last_seen":    timezone.now(),
            },
        )
        if payload.get("secret"):
            agent.set_secret(payload["secret"])
        return agent

    @database_sync_to_async
    def touch_agent(self, agent_id, status="ONLINE"):
        from apps.agents.models import Agent
        Agent.objects.filter(agent_id=agent_id).update(
            last_seen=timezone.now(), status=status
        )

    @database_sync_to_async
    def mark_agent_offline(self, agent_id):
        from apps.agents.models import Agent
        Agent.objects.filter(agent_id=agent_id).update(status="OFFLINE")

    @database_sync_to_async
    def update_agent_status(self, agent_id, status):
        from apps.agents.models import Agent
        Agent.objects.filter(agent_id=agent_id).update(status=status)

    @database_sync_to_async
    def save_metrics(self, agent_id, metrics):
        """Persist metrics and backfill collector health when agents aren't sending it explicitly."""
        from apps.metrics.models import Metric, MetricResolution
        from apps.agents.models import Agent, CollectorHealth, CollectorStatus

        objects = []
        collector_names = set()

        for m in metrics:
            if not isinstance(m, dict):
                continue
            collector = str(m.get("collector") or m.get("metric_type") or "unknown")
            collector_names.add(collector)
            objects.append(Metric(
                agent_id       = agent_id,
                metric_type    = collector,
                resolution     = MetricResolution.RAW,
                timestamp      = m.get("timestamp", timezone.now()),
                data           = m.get("data", {}),
                schema_version = m.get("schema_version", "1.0"),
            ))

        if objects:
            Metric.objects.bulk_create(objects, batch_size=500)
            update_latest_cache(agent_id, objects)

            # Auto-maintain collector health so the UI doesn't stay empty when the agent
            # isn't sending collector_health messages explicitly.
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

        return len(objects)

    @database_sync_to_async
    def save_logs(self, agent_id, logs):
        from apps.logs.models import LogEntry
        objects = []
        for log in logs:
            if not isinstance(log, dict):
                continue
            msg = str(log.get("message", "")).replace("\x00", "")[:8192]
            objects.append(LogEntry(
                agent_id        = agent_id,
                source          = log.get("source", "internal"),
                severity        = log.get("severity", "Info"),
                message         = msg,
                timestamp       = log.get("timestamp", timezone.now()),
                schema_version  = log.get("schema_version", "1.0"),
                extra           = log.get("extra", {}),
                sequence_number = log.get("sequence_number"),
            ))
        if objects:
            LogEntry.objects.bulk_create(objects, batch_size=500)
        return len(objects)

    @database_sync_to_async
    def get_metric_config(self, agent_id):
        from apps.metrics.models import MetricConfig
        from apps.metrics.serializers import MetricConfigSerializer
        config, _ = MetricConfig.objects.get_or_create(agent_id=agent_id)
        return MetricConfigSerializer(config).data

    @database_sync_to_async
    def update_collector_health(self, agent_id, payload):
        from apps.agents.models import Agent, CollectorHealth
        try:
            agent = Agent.objects.get(agent_id=agent_id)
            CollectorHealth.objects.update_or_create(
                agent=agent, collector=payload.get("collector", "unknown"),
                defaults={k: v for k, v in payload.items() if k != "collector"},
            )
        except Agent.DoesNotExist:
            pass

    async def send_json(self, data):
        await self.send(text_data=json.dumps(data))


class ClientSubscribeConsumer(AsyncWebsocketConsumer):
    """
    Accepts WebSocket connections from TUI / dashboard clients.
    Clients subscribe to specific channels for an agent.

    Message format:
      {"channel": "logs", "agent_id": "agent001"}
    """

    async def connect(self):
        self.subscriptions = []
        if not self.scope.get("user") or not self.scope["user"].is_authenticated:
            logger.debug("ClientSubscribeConsumer connect — auth failed, closing 4001")
            await self.close(code=4001)
            return
        await self.accept()
        user = self.scope["user"]
        logger.debug("ClientSubscribeConsumer connect — user=%s", user)

    async def disconnect(self, close_code):
        logger.debug("ClientSubscribeConsumer disconnect — subscriptions=%s code=%s", self.subscriptions, close_code)
        for group in self.subscriptions:
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        try:
            data = json.loads(text_data or "{}")
        except json.JSONDecodeError:
            logger.debug("ClientSubscribeConsumer receive — invalid JSON")
            await self.send_json({"error": "Invalid JSON"})
            return

        action   = data.get("action", "subscribe")
        channel  = data.get("channel")
        agent_id = data.get("agent_id")
        user = self.scope.get("user")
        logger.debug("ClientSubscribeConsumer receive — user=%s action=%s channel=%s agent_id=%s", user, action, channel, agent_id)

        if channel not in VALID_CHANNELS:
            logger.debug("ClientSubscribeConsumer invalid channel: %s", channel)
            await self.send_json({"error": f"Unknown channel. Valid: {list(VALID_CHANNELS)}"})
            return
        if not agent_id:
            await self.send_json({"error": "agent_id is required"})
            return

        safe_id = agent_id.replace(":", "_").replace("#", "_").replace(" ", "_")
        group_name = f"{channel}_{safe_id}"

        if action == "subscribe":
            if group_name not in self.subscriptions:
                await self.channel_layer.group_add(group_name, self.channel_name)
                self.subscriptions.append(group_name)
                logger.debug("ClientSubscribeConsumer subscribed to %s", group_name)
            await self.send_json({"subscribed": channel, "agent_id": agent_id})

        elif action == "unsubscribe":
            if group_name in self.subscriptions:
                await self.channel_layer.group_discard(group_name, self.channel_name)
                self.subscriptions.remove(group_name)
                logger.debug("ClientSubscribeConsumer unsubscribed from %s", group_name)
            await self.send_json({"unsubscribed": channel, "agent_id": agent_id})

    # ─── Group message handlers ────────────────────────────────────────────────

    async def metric_update(self, event):
        await self.send_json({"channel": "metrics", "data": event["data"]})

    async def log_entry(self, event):
        await self.send_json({"channel": "logs", "data": event["data"]})

    async def telemetry_update(self, event):
        await self.send_json({"channel": "telemetry", "data": event["data"]})

    async def health_update(self, event):
        await self.send_json({"channel": "health", "data": event["data"]})

    async def send_json(self, data):
        await self.send(text_data=json.dumps(data))
