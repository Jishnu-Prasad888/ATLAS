from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import threading
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

import zstandard
from django.conf import settings
from django.utils import timezone
from nats.aio.client import Client as NATS
from nats.errors import TimeoutError
from nats.js.errors import BadRequestError

from . import agent_tasks


logger = logging.getLogger("beacon.transport")

FRAME_VERSION = 1
ENCODING_NONE = 0
ENCODING_ZSTD = 1
ZSTD_LEVEL = 6

_started = False
_loop: Optional[asyncio.AbstractEventLoop] = None
_publish_queue: Optional[asyncio.Queue[Tuple[str, Dict[str, Any], Optional[str]]]] = None

_compressor = zstandard.ZstdCompressor(level=ZSTD_LEVEL)
_decompressor = zstandard.ZstdDecompressor()


@dataclass
class CommandMessage:
    agent_id: str
    envelope: Dict[str, Any]
    message_id: Optional[str]


def start() -> None:
    global _started
    if _started:
        return
    _started = True

    thread = threading.Thread(target=_run, name="NATSWorker", daemon=True)
    thread.start()


def _run() -> None:  # pragma: no cover - thread bootstrap
    try:
        asyncio.run(_main())
    except Exception:  # pragma: no cover
        logger.exception("NATS worker crashed during startup")


async def _main() -> None:
    global _loop, _publish_queue
    _loop = asyncio.get_running_loop()
    _publish_queue = asyncio.Queue()

    backoff = 1
    while True:
        try:
            await _run_worker()
            backoff = 1
        except Exception as exc:  # pragma: no cover - logged, then retry
            logger.exception("NATS worker error: %s", exc)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def _run_worker() -> None:
    servers = [settings.BEACON_NATS_URL]
    nc = NATS()
    await nc.connect(servers=servers, name="beacon-server")
    js = nc.jetstream()

    await _ensure_streams(js)

    publish_task = asyncio.create_task(_command_publisher(js))
    ingest_task = asyncio.create_task(_ingest_loop(js))

    try:
        await asyncio.gather(publish_task, ingest_task)
    finally:
        publish_task.cancel()
        ingest_task.cancel()
        with contextlib.suppress(Exception):  # pragma: no cover
            await nc.drain()


async def _ensure_streams(js) -> None:
    ingest_subject = f"{settings.BEACON_NATS_SUBJECT_PREFIX}.>"
    control_subject = f"{settings.BEACON_NATS_COMMAND_PREFIX}.>"

    duplicate_window_seconds = int(timedelta(seconds=300).total_seconds())

    try:
        await js.add_stream(
            name=settings.BEACON_NATS_STREAM_INGEST,
            subjects=[ingest_subject],
            retention="limits",
            storage="file",
            max_msgs=-1,
            duplicate_window=duplicate_window_seconds,
        )
    except BadRequestError as exc:
        message = str(exc)
        if "already in use" not in message and "subjects overlap" not in message:
            raise
        await js.stream_info(settings.BEACON_NATS_STREAM_INGEST)

    try:
        await js.add_stream(
            name=settings.BEACON_NATS_STREAM_CONTROL,
            subjects=[control_subject],
            retention="limits",
            storage="file",
            max_msgs=-1,
            duplicate_window=duplicate_window_seconds,
        )
    except BadRequestError as exc:
        message = str(exc)
        if "already in use" not in message and "subjects overlap" not in message:
            raise
        await js.stream_info(settings.BEACON_NATS_STREAM_CONTROL)


async def _ingest_loop(js) -> None:
    subject = f"{settings.BEACON_NATS_SUBJECT_PREFIX}.>"
    durable = settings.BEACON_NATS_INGEST_CONSUMER
    stream = settings.BEACON_NATS_STREAM_INGEST

    sub = await js.pull_subscribe(subject, durable=durable, stream=stream)

    while True:
        try:
            messages = await sub.fetch(batch=10, timeout=1)
        except TimeoutError:
            continue

        for msg in messages:
            try:
                await _handle_ingest_message(js, msg)
                await msg.ack()
            except Exception as exc:
                logger.exception("Failed to process ingest message: %s", exc)
                await msg.nak()


async def _handle_ingest_message(js, msg) -> None:
    envelope_bytes = decode_frame(bytes(msg.data))
    try:
        envelope = json.loads(envelope_bytes.decode("utf-8"))
    except Exception as exc:
        logger.warning("Invalid payload received: %s", exc)
        await msg.term()
        return

    msg_type = envelope.get("type")
    agent_id = envelope.get("agent_id")
    payload = envelope.get("payload") or {}

    if not msg_type or not agent_id:
        logger.debug("Missing type or agent_id in message: %s", envelope)
        return

    if msg_type == "register":
        await _handle_register(agent_id, payload)
    elif msg_type == "heartbeat":
        await _handle_heartbeat(agent_id, envelope)
    elif msg_type == "metrics":
        await _handle_metrics(agent_id, payload)
    elif msg_type == "logs":
        await _handle_logs(agent_id, payload)
    elif msg_type == "collector_health":
        await agent_tasks.update_collector_health(agent_id, payload)
        publish_command(agent_id, "collector_health_ack")
    elif msg_type == "status_update":
        status = payload.get("status", "ONLINE")
        await agent_tasks.update_agent_status(agent_id, status)
        publish_command(agent_id, "status_ack", {"status": status})
    elif msg_type == "config_request":
        config = await agent_tasks.get_metric_config(agent_id)
        publish_command(agent_id, "config_update", {"payload": config})
    else:
        logger.debug("Unhandled message type '%s' for agent %s", msg_type, agent_id)


async def _handle_register(agent_id: str, payload: Dict[str, Any]) -> None:
    provided_secret = str(payload.get("secret", "")).strip()
    expected_secret = getattr(settings, "BEACON_AGENT_SECRET", "").strip()

    secret_valid = False
    if expected_secret and provided_secret == expected_secret:
        secret_valid = True
    elif provided_secret:
        secret_valid = await agent_tasks.validate_agent_secret(agent_id, provided_secret)

    if not secret_valid:
        logger.warning("Secret mismatch for agent %s", agent_id)
        return

    await agent_tasks.register_agent(payload)
    await agent_tasks.touch_agent(agent_id, "ONLINE")
    publish_command(
        agent_id,
        "registered",
        {"server_time": timezone.now().isoformat()},
    )


async def _handle_heartbeat(agent_id: str, envelope: Dict[str, Any]) -> None:
    status = envelope.get("status", "ONLINE")
    await agent_tasks.touch_agent(agent_id, status)
    publish_command(
        agent_id,
        "heartbeat_ack",
        {"server_time": timezone.now().isoformat()},
    )


async def _handle_metrics(agent_id: str, payload: Any) -> None:
    metrics = payload if isinstance(payload, list) else [payload]
    count, serialized = await agent_tasks.save_metrics(agent_id, metrics)
    await agent_tasks.broadcast_metrics(agent_id, serialized)
    publish_command(agent_id, "metrics_ack", {"ingested": count})


async def _handle_logs(agent_id: str, payload: Any) -> None:
    logs = payload if isinstance(payload, list) else [payload]
    count = await agent_tasks.save_logs(agent_id, logs)
    await agent_tasks.broadcast_logs(agent_id, count)
    publish_command(agent_id, "logs_ack", {"ingested": count})


async def _command_publisher(js) -> None:
    assert _publish_queue is not None
    while True:
        agent_id, envelope, message_id = await _publish_queue.get()
        try:
            payload = encode_frame(json.dumps(envelope).encode("utf-8"))
            subject = _command_subject(agent_id)
            headers = {}
            if message_id:
                headers["Nats-Msg-Id"] = message_id
            await js.publish(subject, payload, headers=headers)
        except Exception as exc:
            logger.exception(
                "Failed to publish command '%s' to agent %s: %s",
                envelope.get("type"),
                agent_id,
                exc,
            )
        finally:
            _publish_queue.task_done()


def publish_command(
    agent_id: str, msg_type: str, payload: Optional[Dict[str, Any]] = None, message_id: Optional[str] = None
) -> bool:
    if _publish_queue is None or _loop is None:
        logger.warning("Command queue not ready; dropping message %s", msg_type)
        return False

    envelope: Dict[str, Any] = {
        "type": msg_type,
        "agent_id": agent_id,
    }
    if payload is not None:
        envelope["payload"] = payload
    if message_id:
        envelope["message_id"] = message_id

    cmd = (agent_id, envelope, message_id)
    asyncio.run_coroutine_threadsafe(_publish_queue.put(cmd), _loop)
    return True


def encode_frame(payload: bytes) -> bytes:
    if not payload:
        return bytes([FRAME_VERSION, ENCODING_NONE])
    compressed = _compressor.compress(payload)
    return bytes([FRAME_VERSION, ENCODING_ZSTD]) + compressed


def decode_frame(frame: bytes) -> bytes:
    if len(frame) < 2:
        raise ValueError("frame too short")
    version = frame[0]
    if version != FRAME_VERSION:
        raise ValueError(f"Unsupported frame version {version}")
    encoding = frame[1]
    body = frame[2:]
    if encoding == ENCODING_NONE:
        return body
    if encoding == ENCODING_ZSTD:
        try:
            return _decompressor.decompress(body)
        except zstandard.ZstdError as exc:
            message = str(exc).lower()
            if "content size" not in message:
                raise
            stream = _decompressor.stream_reader(io.BytesIO(body))
            with contextlib.closing(stream):
                return stream.read()
    raise ValueError(f"Unsupported frame encoding {encoding}")


def _command_subject(agent_id: str) -> str:
    return f"{settings.BEACON_NATS_COMMAND_PREFIX}.{agent_id}.commands"
