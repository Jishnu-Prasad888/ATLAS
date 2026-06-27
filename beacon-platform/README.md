# Beacon — Distributed Linux Observability & Telemetry Platform

> **Version 1.0** · Rust Agent + Django Server · TLS 1.3 · AES-256-GCM · Ratatui TUI

---

## Architecture

```
Users / TUI
     │
     ▼
Beacon Server (Django + Channels + NATS JetStream)
  ├── Authentication & RBAC (Argon2id, JWT)
  ├── Audit System (Immutable)
  ├── Telemetry Manager
  ├── REST API  (/api/v1/...)
  ├── Agent Transport (NATS JetStream)
  └── Client WebSocket (/ws/subscribe/)
          │
          │  NATS JetStream (TLS 1.3)
          │
      ▼
Beacon Agents (Rust, 1 … N)
  ├── Identity Engine    (SHA-256 hardware fingerprint)
  ├── Encryption Engine  (AES-256-GCM)
  ├── Queue Engine       (offline buffering + dead letter)
  ├── Storage Engine     (SQLite WAL — metrics/logs/queue/config)
  ├── Collectors         (CPU · RAM · Storage · Network · Process · Systemd · Docker · Kernel)
  ├── Transport          (NATS JetStream, exponential backoff)
  ├── Health Engine      (per-collector status tracking)
  └── TUI                (Ratatui — keyboard-driven dashboard)
```

---

## Quick Start

### 1. Server (Docker)

```bash
cd server
cp .env.example .env
# Edit .env — set SECRET_KEY, DB_PASSWORD, etc. If you use docker compose, set BEACON_NATS_URL=nats://nats:4222 so the app reaches the NATS container.

docker compose up -d
docker compose exec server python manage.py migrate
docker compose exec server python manage.py beacon_init

# NATS JetStream will be available on nats://localhost:4222 once the stack is up.
# Optional: open a shell in the sandbox data-science container
# docker compose exec sandbox bash
```

The server starts on **http://localhost:8000** (REST + UI) and listens for NATS at **nats://localhost:4222**.

---

### 2. Agent (Rust)

**Prerequisites:** Rust 1.76+ via [rustup](https://rustup.rs)

```bash
cd agent
cargo build --release

# Install
sudo cp target/release/beacon-agent /usr/local/bin/
sudo mkdir -p /etc/beacon /var/lib/beacon/agent /var/log/beacon

# First-time init
sudo beacon-agent init

# Run in foreground (must be sudo/root)
sudo beacon-agent start --config /etc/beacon/agent.toml

# Start on boot via cron (@reboot)
sudo beacon-agent cron install
# Remove: sudo beacon-agent cron remove
```

> The agent refuses to run without sudo/root privileges.

---

## CLI Reference

### Agent Commands

```bash
# Run on boot (@reboot cron)
beacon-agent cron install|remove

# Initialization
beacon-agent init

# Authentication
beacon-agent login --username admin
beacon-agent logout
beacon-agent whoami

# Collector management
beacon-agent cpu enable|disable
beacon-agent ram enable|disable
beacon-agent storage enable|disable
beacon-agent network enable|disable
beacon-agent process enable|disable
beacon-agent systemd enable|disable
beacon-agent docker enable|disable
beacon-agent kubernetes enable|disable
beacon-agent metrics enable-all|disable-all
beacon-agent metrics interval 5s|30s|1m
beacon-agent metrics retention 30d

# Agent management
beacon-agent agent list
beacon-agent agent show <agent_id>
beacon-agent agent enable|disable <agent_id>
beacon-agent agent remove|rename|regenerate-id

# Logs
beacon-agent logs view|follow|export|search|clear

# Database
beacon-agent db status|backup|restore|vacuum|verify

# Encryption
beacon-agent encryption enable|disable|rotate-key|status

# Queue
beacon-agent queue status|clear|pause|resume|retry-failed

# Server connectivity
beacon-agent server connect|disconnect|status|ping|test

# TUI Dashboard
beacon-agent tui
```

---

## REST API Reference

All endpoints require `Authorization: Bearer <jwt>` except login.

### Authentication — `/api/v1/auth/`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/auth/login/` | Obtain JWT token pair |
| POST | `/api/v1/auth/logout/` | Blacklist refresh token |
| POST | `/api/v1/auth/refresh/` | Refresh access token |
| GET  | `/api/v1/auth/whoami/` | Current user info |
| POST | `/api/v1/auth/password/change/` | Change password |
| POST | `/api/v1/auth/password/recover/` | Password recovery via key |
| POST | `/api/v1/auth/recovery-key/generate/` | Generate new recovery key |

### Agents — `/api/v1/agents/`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/agents/` | List all agents |
| POST | `/api/v1/agents/register/` | Register agent |
| GET  | `/api/v1/agents/<id>/` | Agent detail |
| DELETE | `/api/v1/agents/<id>/` | Remove agent |
| POST | `/api/v1/agents/<id>/heartbeat/` | Agent heartbeat |
| POST | `/api/v1/agents/<id>/rename/` | Rename agent |
| POST | `/api/v1/agents/<id>/enable/` | Enable agent |
| POST | `/api/v1/agents/<id>/disable/` | Disable agent |

### Telemetry — `/api/v1/telemetry/`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/telemetry/ingest/` | Ingest metric batch |
| GET  | `/api/v1/telemetry/` | Query metrics |
| GET  | `/api/v1/telemetry/latest/<agent_id>/` | Latest per-type |
| POST | `/api/v1/telemetry/prune/` | Manual retention prune |

### Logs — `/api/v1/logs/`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/logs/` | Query logs (filter by agent, severity, source, search, time range) |
| POST | `/api/v1/logs/ingest/` | Ingest log batch |
| GET  | `/api/v1/logs/export/` | Export logs as JSON |
| POST | `/api/v1/logs/clear/` | Clear logs |

### Audit — `/api/v1/audit/`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/audit/` | Query immutable audit trail |
| GET  | `/api/v1/audit/export/` | Export audit as JSON |

### Health — `/api/v1/health/`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/health/` | Server + fleet health summary |
| GET  | `/api/v1/health/agents/<id>/` | Per-agent collector health |

### Config — `/api/v1/config/`

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/v1/config/` | List all config keys |
| POST | `/api/v1/config/` | Create config key |
| GET/PUT/DELETE | `/api/v1/config/<key>/` | Key detail |
| GET/PUT | `/api/v1/config/retention/` | Retention policy |

---

## WebSocket Channels

```bash
# Agent ingest (used by beacon-agent)
wss://server/ws/ingest/

# Client subscription (used by TUI / dashboard)
wss://server/ws/subscribe/?token=<jwt>
```

Subscribe to a channel:
```json
{"action": "subscribe", "channel": "metrics", "agent_id": "sha256:a3f1..."}
{"action": "subscribe", "channel": "logs",    "agent_id": "sha256:a3f1..."}
{"action": "subscribe", "channel": "health",  "agent_id": "sha256:a3f1..."}
```

---

## Security

| Layer | Mechanism |
|-------|-----------|
| Transport | NATS JetStream (TLS) |
| Payload encryption | AES-256-GCM |
| Key derivation | Argon2id |
| Password storage | Argon2id |
| Session tokens | JWT (short-lived access + refresh with blacklisting) |
| RBAC | Administrator / Viewer enforced at every boundary |
| Audit | Immutable append-only audit trail |
| Brute force | Progressive backoff + account lockout |
| Recovery | XXXX-XXXX-XXXX-XXXX hex recovery key (invalidated on use) |
| Log injection | Input sanitization |
| PID reuse | (pid, boot_id, start_time) triple identity |

---

## Data Retention

| Resolution | Interval | Retention |
|------------|----------|-----------|
| Raw | 1 second | 24 hours |
| Rollup | 1 minute | 30 days |
| Rollup | 1 hour | 365 days |

---

## TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` / `←→` | Navigate tabs |
| `1–7` | Jump to view |
| `j/k` or `↑↓` | Scroll lists |
| `/` | Open search |
| `ESC` | Close search |
| `q` | Quit |
| `Ctrl+C` | Force quit |

---

## Deployment Notes

- Run the agent as a dedicated `beacon` system user with minimal privileges.
- Use the systemd service for automatic restart and crash recovery.
- The agent operates fully offline — all telemetry is stored locally in SQLite and replayed on reconnect.
- The server requires PostgreSQL 14+ and Redis 7+.
- Key rotation is atomic with rollback support — safe to run in production.

---

## Roadmap

| Phase | Milestone |
|-------|-----------|
| 1 | Agent Core — Identity, auth, storage, NATS transport ✓ |
| 2 | Telemetry Collection — CPU, RAM, disk, process, network ✓ |
| 3 | Log Collection — Journald, syslog, kernel logs ✓ |
| 4 | Container Monitoring — Docker and containerd |
| 5 | Kubernetes Monitoring — Pod, deployment, events, cluster |
| 6 | Server Platform — Storage, indexing, aggregation APIs ✓ |
| 7 | TUI Dashboard — Real-time observability interface ✓ |
| 8 | Fleet Scaling — Multi-agent deployments and clustering |
