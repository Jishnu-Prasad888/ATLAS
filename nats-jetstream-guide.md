# Beacon NATS JetStream Guide

This guide explains how to run Beacon Server and Beacon Agent with NATS JetStream as the transport layer. It covers prerequisites, configuration, deployment steps, ongoing operations, and common edge cases.

## 1. Overview

Beacon now uses NATS JetStream for all server⇄agent messaging. Agents publish telemetry and heartbeats to JetStream subjects, while the server ingests the data, persists it, and issues control commands (config updates, process-kill requests) on a separate subject hierarchy. Dashboard and TUI clients continue to subscribe via Django Channels WebSockets.

```
 ┌───────────────┐       publish        ┌──────────────────────┐
 │ Beacon Agent  │ ───────────────────► │ NATS JetStream        │
 │  (async-nats) │  metrics/logs/etc.  │  Streams:             │
 │               │ ◄─────────────────── │   agent_ingest        │
 │               │   commands/acks     │   agent_control       │
 └───────────────┘                      └──────────────────────┘
           ▲                                         │
           │                                         ▼
           │   publish commands/consume ingest   ┌───────────────┐
           └────────────────────────────────────►│ Beacon Server │
                                                │  (nats-py)    │
                                                └───────────────┘
```

## 2. Prerequisites

- NATS Server v2.10+ with JetStream enabled.
- Python 3.12 (server) and Rust 1.76+ (agent) toolchains.
- Open firewall ports for NATS (default `4222`, plus `6222`/`8222` if clustering/monitoring is used).

## 3. Running NATS JetStream

### 3.1 Quick start (Docker)

```bash
docker run -d \
  --name nats-js \
  -p 4222:4222 -p 6222:6222 -p 8222:8222 \
  nats:2.10 \
  -js -sd /data/jetstream
```

### 3.2 Native binary

```bash
nats-server -js -sd ./jetstream-data
```

### 3.3 Basic verification

```bash
# Install the official CLI if needed
curl -Ls https://github.com/nats-io/natscli/releases/download/v0.1.5/nats-0.1.5-linux-amd64.tar.gz | tar xz

# Check server info
./nats server report jetstream
```

> The Beacon server automatically creates required streams/consumers on startup, so manual `nats stream add` calls are optional.

## 4. Server Configuration

### 4.1 Environment variables (`server/.env`)

```dotenv
BEACON_ENABLE_NATS_WORKER=1
BEACON_NATS_URL=nats://nats:4222
BEACON_NATS_SUBJECT_PREFIX=agent
BEACON_NATS_COMMAND_PREFIX=agent_cmd
BEACON_NATS_STREAM_INGEST=agent_ingest
BEACON_NATS_STREAM_CONTROL=agent_control
BEACON_NATS_INGEST_CONSUMER=beacon-server
```

- **BEACON_NATS_URL**: Accepts comma-separated URLs for clusters. When running via docker-compose, use `nats://nats:4222`; otherwise point at your broker host (e.g. `nats://localhost:4222`). TLS endpoints use `tls://`.
- Leave `BEACON_ENABLE_NATS_WORKER=0` temporarily if you need to boot the server without transport (e.g. migrations).

### 4.2 Django settings

`beacon_server/settings.py` loads these env vars. The `apps.transport` app starts a background JetStream worker when the ASGI process boots.

### 4.3 Python dependencies

Install requirements (already included in `requirements.txt`):

```bash
pip install nats-py==2.6.0 zstandard==0.23.0
```

### 4.4 Streams and subjects

By default the server manages:

| Stream            | Subjects pattern                        | Purpose             |
|-------------------|------------------------------------------|---------------------|
| `agent_ingest`    | `agent.<agent_id>.*`                     | Metrics, logs, etc. |
| `agent_control`   | `agent.<agent_id>.commands`              | Server→agent cmds   |

- Duplicate window: 300 seconds (prevents replays from offline agents creating duplicates).
- Storage: file-backed with limits retention.

### 4.5 Worker behavior

`apps/transport/nats_worker.py` responsibilities:

- Creates the two streams (idempotent) and a durable consumer for all ingest data (`BEACON_NATS_INGEST_CONSUMER`).
- Fetches batches of up to 10 messages, decompresses payloads (zstd level 6), and dispatches them to shared database helpers.
- Publishes command acknowledgements and config updates via a shared async queue.

## 5. Agent Configuration

### 5.1 Example (`agent/agent.toml`)

```toml
rest_base_url = "https://beacon.example.com"

[nats]
url = "nats://beacon.example.com:4222"
subject_prefix = "agent"
command_prefix = "agent_cmd"
# Optional
# domain = "hub"
# creds_path = "/etc/beacon/nats.creds"
# connect_timeout = 5
```

- `url` may include authentication query parameters or a credentials file.
- `domain` routes requests to a JetStream domain (multi-tenancy).
- `creds_path` enables NATS JWT/NKey auth; the agent loads `.creds` files via async-nats.
- `connect_timeout` overrides the default (5 seconds).

### 5.2 Transport behavior

Key details of `JetstreamTransport` (`agent/src/transport/mod.rs`):

- Subject format for publishes: `{subject_prefix}.{agent_id}.{msg_type}`.
- Command subscription subject: `{command_prefix}.{agent_id}.commands` (defaults to `agent_cmd.<agent_id>.commands`) with durable name `agent-commands-{agent_id}`.
- Frame format: `[version|encoding|compressed bytes]` where `version=1` and encoding `1 = zstd`.
- Heartbeats every 15 seconds, exponential backoff reconnect (1 → 60 seconds).
- Queue flush respects local encryption: payloads are decrypted before publish.

## 6. Deploying Server + Agents

1. **Start NATS** (`docker run nats:2.10 -js` or native).
2. **Configure server `.env`** with NATS variables and restart the Django ASGI process (`docker compose restart server` or `systemctl restart beacon-server`).
3. Confirm worker output: look for `Connected to NATS ...` in server logs.
4. Update agents:
   - Regenerate `agent.toml` via `beacon-agent init` or edit `[nats]` section.
   - Ensure `BEACON_AGENT_SECRET` matches the server.
   - Restart agents (`sudo systemctl restart beacon-agent` or `sudo beacon-agent start`).

## 7. Operational Checks

### 7.1 Confirm streams

```bash
./nats stream ls
./nats stream report agent_ingest
./nats stream report agent_control
```

### 7.2 Inspect consumer lag

```bash
./nats consumer report agent_ingest beacon-server
```

### 7.3 Tail server logs

```bash
docker compose logs -f server | grep NATS
```

### 7.4 Monitor agent status

- `beacon-agent queue status` to ensure the local queue drains.
- `beacon-server` admin UI or `/api/v1/agents/` to check `last_seen` timestamps.

## 8. Edge Cases & Troubleshooting

| Scenario | Symptoms | Mitigation |
|----------|----------|------------|
| NATS unavailable at startup | Agent logs `Failed to connect to NATS`; queue grows | Verify NATS URL/firewall; transport reconnects with backoff. Use `beacon-agent queue status` to monitor backlog. |
| Secret mismatch during `register` | Server logs warning; agent never receives `registered` ack | Ensure `BEACON_AGENT_SECRET` matches. Worker ignores untrusted registration. |
| Message duplication after outage | JetStream deduplicates within 5 minutes, but agent queue may re-send older data | Increase `duplicate_window` if needed; duplicates are safe due to idempotent DB writes. |
| Command not delivered | Process-kill remains `pending`; server logs warning | Check NATS control stream, agent connectivity, and ensure durable consumer created (logs show command loop started). |
| Payload decompression error | Worker logs `Invalid payload` | Indicates mismatched frame version or corrupted data—verify agent version and zstd compatibility. |
| TLS requirements | NATS returns `Authorization Violation` | Configure `nats` client with `creds_path` or TLS certificates and update `BEACON_NATS_URL` to `tls://`. |

## 9. Local Testing Tips

- Run NATS locally and point both server and agent to `nats://127.0.0.1:4222`.
- Use `nats-box` for quick inspection:

  ```bash
  docker run --rm -it --network host natsio/nats-box:0.13
  # inside container
  nats sub 'agent.*.*'
  ```

- Simulate load by executing `beacon-agent queue retry-failed` and verifying JetStream backlog drains properly.
- CI/headless environments can verify worker imports with `python3 -m compileall apps/transport` and agent builds with `cargo check`.

## 10. Useful CLI Snippets

```bash
# Publish a test command (replace subject/payload)
./nats pub "agent.sha256:abc123.commands" '{"type":"config_update","payload":{}}'

# View JetStream account usage
./nats account info

# Tail JetStream acknowledgements (requires server debug)
./nats sub '.$JS.API.ACK.>'
```

## 11. Summary of Key Files

- **Server worker:** `server/apps/transport/nats_worker.py`
- **Server helpers:** `server/apps/transport/agent_tasks.py`
- **Agent transport:** `agent/src/transport/mod.rs`
- **Config samples:** `agent/agent.toml.example`, `server/.env.example`
- **Docs:** Updated `README.md`, `TECHNICALS.md` describing JetStream transport.

With NATS JetStream in place, Beacon benefits from durable, back-pressure aware messaging and clean separation between ingest and control channels. Monitor stream lag and agent queues to maintain healthy throughput.
