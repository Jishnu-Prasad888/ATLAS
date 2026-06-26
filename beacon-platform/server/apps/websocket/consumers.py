"""
Beacon WebSocket Consumers
Handles:
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


logger = logging.getLogger("beacon")

VALID_CHANNELS = {"logs", "metrics", "telemetry", "health"}


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
