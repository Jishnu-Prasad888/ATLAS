# Beacon — Complete Technical Reference

**Version 1.0** | Django 5.0 Server + Rust 1.76 Agent | 6,920 lines across 89 files

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Technology Stack](#2-technology-stack)
3. [System Architecture](#3-system-architecture)
4. [Django Server — Project Structure](#4-django-server--project-structure)
5. [Data Models](#5-data-models)
6. [REST API Reference](#6-rest-api-reference)
7. [WebSocket Engine](#7-websocket-engine)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [RBAC Permission System](#9-rbac-permission-system)
10. [Audit System](#10-audit-system)
11. [Rate Limiting & Throttling](#11-rate-limiting--throttling)
12. [Rust Agent — Architecture](#12-rust-agent--architecture)
13. [Identity Engine](#13-identity-engine)
14. [Encryption Engine](#14-encryption-engine)
15. [Queue Engine](#15-queue-engine)
16. [Storage Engine (SQLite)](#16-storage-engine-sqlite)
17. [Transport Layer](#17-transport-layer)
18. [Health Engine](#18-health-engine)
19. [Telemetry Collectors](#19-telemetry-collectors)
20. [Terminal User Interface (TUI)](#20-terminal-user-interface-tui)
21. [CLI Reference](#21-cli-reference)
22. [Configuration Reference](#22-configuration-reference)
23. [Database Schema](#23-database-schema)
24. [Security Model](#24-security-model)
25. [Edge Cases & Failure Handling](#25-edge-cases--failure-handling)
26. [Deployment Guide](#26-deployment-guide)
27. [Dependencies](#27-dependencies)

---

## 1. Platform Overview

Beacon is a distributed Linux observability and telemetry platform. It operates on an **agent-server architecture**: lightweight Rust agents run on monitored machines, continuously collecting telemetry and buffering data offline when connectivity is unavailable. All data is encrypted before transmission and forwarded to a central Django server via NATS JetStream.

### Design Principles

| Principle | Implementation |
|-----------|---------------|
| Observability-focused | Read-only telemetry collection; no remote execution |
| Offline-first | SQLite queue buffers all data during disconnects |
| Secure by default | TLS 1.3 + AES-256-GCM + Argon2id; no insecure defaults |
| Immutable telemetry | Records cannot be deleted via normal API |
| Immutable audit | Audit log overrides `save()` and `delete()` at the model level |
| Async throughout | Tokio runtime (agent); Django Channels (server) |
| Full parity | Every CLI operation has an equivalent REST API endpoint |

### Supported Targets

- Linux x86_64 and ARM (including Raspberry Pi)
- Docker hosts
- Kubernetes clusters
- Edge devices and homelabs

---

## 2. Technology Stack

### Server

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Django | 5.0.6 |
| API layer | Django REST Framework | 3.15.2 |
| JWT tokens | djangorestframework-simplejwt | 5.3.1 |
| Client WebSocket | Django Channels + Daphne | 4.1.0 / 4.1.2 |
| Agent transport | NATS JetStream (nats-py) | 2.6.0 |
| Channel backend | channels-redis | 4.2.0 |
| Database | PostgreSQL | 14+ |
| Cache/Broker | Redis | 7+ |
| Password hashing | argon2-cffi | 23.1.0 |
| ASGI server | Daphne | 4.1.2 |
| CORS | django-cors-headers | 4.4.0 |
| Filtering | django-filter | 24.2 |
| Serialization | msgpack | 1.0.8 |

### Agent (Rust)

| Component | Crate | Version |
|-----------|-------|---------|
| Async runtime | tokio | 1.x (full features) |
| NATS client | async-nats | 0.34 |
| TLS | rustls | 0.22 |
| Native certs | rustls-native-certs | 0.7 |
| Encryption | aes-gcm | 0.10 |
| Key derivation | argon2 | 0.5 |
| Hashing | sha2 | 0.10 |
| Local storage | rusqlite (bundled) | 0.31 |
| System metrics | sysinfo | 0.30 |
| CLI parsing | clap (derive) | 4.x |
| TUI | ratatui | 0.26 |
| Terminal | crossterm | 0.27 |
| Config format | toml | 0.8 |
| Serialization | serde + serde_json | 1.x |
| Error handling | anyhow + thiserror | 1.x |
| Logging | tracing + tracing-subscriber | 0.1 |

---

## 3. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Users / Dashboard                        │
│              (TUI · REST Client · WebSocket Client)             │
└─────────────────────────┬───────────────────────────────────────┘
                          │  HTTPS / WSS (TLS 1.3)
┌─────────────────────────▼───────────────────────────────────────┐
│                     Beacon Server (Django)                      │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ REST API    │  │  WebSocket  │  │  Background Workers     │ │
│  │ /api/v1/    │  │  Channels   │  │  (Celery / pruning)     │ │
│  └──────┬──────┘  └──────┬──────┘  └─────────────────────────┘ │
│         │                │                                      │
│  ┌──────▼────────────────▼──────────────────────────────────┐  │
│  │            Application Layer (Django Apps)               │  │
│  │  auth_rbac │ agents │ metrics │ logs │ audit │ health     │  │
│  │  config    │ websocket                                   │  │
│  └──────────────────────────────┬───────────────────────────┘  │
│                                 │                               │
│  ┌──────────────┐  ┌────────────▼──────────────────────────┐   │
│  │    Redis     │  │         PostgreSQL                    │   │
│  │  (channels)  │  │  agents│metrics│logs│audit│config     │   │
│  └──────────────┘  └───────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          │  wss:// TLS 1.3 WebSocket
                          │  + AES-256-GCM payload encryption
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│               Beacon Agent (Rust / Tokio)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Identity   │  │  Encryption  │  │      Health          │  │
│  │   Engine     │  │   Engine     │  │      Engine          │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Telemetry Collectors (Tokio tasks)         │  │
│  │  CPU │ RAM │ Storage │ Network │ Process │ Systemd       │  │
│  │  Docker │ Kernel │ Temperature                          │  │
│  └─────────────────────────┬────────────────────────────────┘  │
│                            │                                    │
│  ┌─────────────────────────▼────────────────────────────────┐  │
│  │                Queue Engine (offline buffer)             │  │
│  └─────────────────────────┬────────────────────────────────┘  │
│                            │                                    │
│  ┌─────────────────────────▼────────────────────────────────┐  │
│  │            Storage Engine (SQLite WAL)                   │  │
│  │  metrics.db │ logs.db │ queue.db │ config.db             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │           Transport (TLS WS + exponential backoff)       │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Binary Topology

| Binary | Language | Role |
|--------|----------|------|
| `beacon-server` | Python/Django | Central ingestion, auth, storage, APIs |
| `beacon-agent` | Rust | Agent collector, local storage, secure transport |

---

## 4. Django Server — Project Structure

```
server/
├── beacon_server/
│   ├── settings.py          # Central configuration
│   ├── urls.py              # Root URL routing
│   ├── asgi.py              # ASGI config (HTTP + WebSocket)
│   └── wsgi.py              # WSGI fallback
├── apps/
│   ├── auth_rbac/           # Authentication, RBAC, users, recovery
│   │   ├── models.py        # BeaconUser, RecoveryKey
│   │   ├── hashers.py       # Custom Argon2id hasher
│   │   ├── permissions.py   # IsAdministrator, IsViewer, IsAdminOrReadOnly
│   │   ├── serializers.py   # JWT, user CRUD, password, recovery
│   │   ├── views.py         # Login, logout, whoami, user management
│   │   ├── urls.py          # /api/v1/auth/
│   │   ├── user_urls.py     # /api/v1/users/
│   │   └── management/commands/beacon_init.py
│   ├── agents/              # Agent registry
│   │   ├── models.py        # Agent, CollectorHealth
│   │   ├── serializers.py
│   │   ├── views.py
│   │   └── urls.py
│   ├── metrics/             # Telemetry ingestion and query
│   │   ├── models.py        # Metric, MetricConfig
│   │   ├── views.py         # Ingest, query, prune, config
│   │   ├── urls.py          # /api/v1/telemetry/
│   │   └── urls_metrics.py  # /api/v1/metrics/
│   ├── logs/                # Log ingestion and query
│   │   ├── models.py        # LogEntry
│   │   ├── views.py
│   │   └── urls.py
│   ├── audit/               # Immutable audit trail
│   │   ├── models.py        # AuditLog (immutable)
│   │   ├── middleware.py    # Auto-logs all write operations
│   │   └── utils.py         # audit_log() helper
│   ├── health/              # Server + agent health
│   │   ├── models.py        # ServerHealth
│   │   └── views.py
│   ├── config/              # Server configuration store
│   │   ├── models.py        # ServerConfig
│   │   └── views.py
│   └── websocket/           # Channels consumers and routing
│       ├── consumers.py     # AgentIngestConsumer, ClientSubscribeConsumer
│       ├── middleware.py    # JWT auth for WebSocket
│       └── routing.py       # WebSocket URL patterns
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

---

## 5. Data Models

### 5.1 BeaconUser

```python
class BeaconUser(AbstractBaseUser, PermissionsMixin):
    username              CharField(150, unique=True)
    email                 EmailField(blank=True)
    role                  CharField(32)          # 'viewer' | 'administrator'
    is_active             BooleanField(True)
    is_staff              BooleanField(False)
    created_at            DateTimeField(auto)
    updated_at            DateTimeField(auto)
    last_login_ip         GenericIPAddressField(null)
    failed_logins         PositiveIntegerField(0)
    locked_until          DateTimeField(null)
    security_answer_hash  CharField(256)         # SHA-256 of lowercased answer
```

**Lockout thresholds:**

| Failed Logins | Lockout Duration |
|--------------|-----------------|
| ≥ 5 | 60 seconds |
| ≥ 10 | 300 seconds (5 min) |
| ≥ 20 | 3600 seconds (1 hour) |

### 5.2 RecoveryKey

```python
class RecoveryKey(models.Model):
    user        OneToOneField(BeaconUser)
    key_hash    CharField(256)    # SHA-256 of raw key (stripped hyphens, uppercased)
    created_at  DateTimeField(auto)
    used_at     DateTimeField(null)
    invalidated BooleanField(False)
```

**Key format:** `XXXX-XXXX-XXXX-XXXX` (16 hex characters in 4 groups of 4).  
**Storage:** Only the SHA-256 hash is stored. Raw key is shown once at generation and never again.  
**Lifecycle:** Consumed on first use (`invalidated=True`). A new key is automatically issued.

### 5.3 Agent

```python
class Agent(models.Model):
    agent_id      CharField(128, unique, db_index)   # sha256:<hex>
    hostname      CharField(253)
    os            CharField(64)                       # 'linux'
    architecture  CharField(32)                       # 'x86_64' | 'aarch64'
    version       CharField(32)
    tags          JSONField(list)
    status        CharField(32)                       # AgentStatus enum
    is_active     BooleanField(True)
    secret_hash   CharField(256)                      # SHA-256 of agent secret
    registered_at DateTimeField(auto_add)
    last_seen     DateTimeField(null)
    updated_at    DateTimeField(auto)
    metadata      JSONField(dict)
```

**AgentStatus values:**
`BOOTING` | `INITIALIZING` | `ONLINE` | `DEGRADED` | `OFFLINE_BUFFERING` | `RECOVERING` | `FAILED` | `SHUTTING_DOWN` | `OFFLINE`

**Stale detection:** Agent is marked stale if `last_seen` is older than `BEACON_AGENT_HEARTBEAT_TIMEOUT` (default 60 seconds).

### 5.4 CollectorHealth

```python
class CollectorHealth(models.Model):
    agent         ForeignKey(Agent, related_name='collector_health')
    collector     CharField(64)     # 'cpu' | 'ram' | 'storage' | 'network' | ...
    status        CharField(16)     # 'Healthy' | 'Degraded' | 'Failed' | 'Disabled'
    last_run      DateTimeField(null)
    last_success  DateTimeField(null)
    last_failure  DateTimeField(null)
    failure_count PositiveIntegerField(0)
    updated_at    DateTimeField(auto)

    class Meta:
        unique_together = [('agent', 'collector')]
```

### 5.5 Metric

```python
class Metric(models.Model):
    agent_id        CharField(128, db_index)
    metric_type     CharField(32)    # MetricType enum
    resolution      CharField(8)     # 'raw' | '1min' | '1hour'
    timestamp       DateTimeField(db_index)
    data            JSONField        # Actual measurement payload
    schema_version  CharField(16)

    class Meta:
        db_table = 'beacon_metrics'
        indexes  = [
            Index(['agent_id', 'metric_type', 'timestamp']),
            Index(['agent_id', 'resolution',  'timestamp']),
        ]
```

**MetricType values:**
`cpu` | `ram` | `storage` | `network` | `process` | `systemd` | `docker` | `kubernetes` | `kernel` | `temperature` | `power`

**MetricResolution values and retention:**

| Resolution | Collection Interval | Retention |
|------------|--------------------|-----------| 
| `raw` | 1 second | 24 hours |
| `1min` | 1 minute | 30 days |
| `1hour` | 1 hour | 365 days |

### 5.6 MetricConfig

```python
class MetricConfig(models.Model):
    agent_id            CharField(128, unique, db_index)
    cpu_enabled         BooleanField(True)
    ram_enabled         BooleanField(True)
    storage_enabled     BooleanField(True)
    network_enabled     BooleanField(True)
    process_enabled     BooleanField(True)
    systemd_enabled     BooleanField(True)
    docker_enabled      BooleanField(False)
    kubernetes_enabled  BooleanField(False)
    temperature_enabled BooleanField(True)
    power_enabled       BooleanField(False)
    interval_seconds    PositiveIntegerField(5)
    retention_days      PositiveIntegerField(30)
    updated_at          DateTimeField(auto)
```

### 5.7 LogEntry

```python
class LogEntry(models.Model):
    agent_id        CharField(128, db_index)
    source          CharField(64)     # LogSource enum
    severity        CharField(16)     # LogSeverity enum
    message         TextField
    timestamp       DateTimeField(db_index)
    schema_version  CharField(16)
    extra           JSONField(dict)   # unit, container_id, pod_name, etc.
    sequence_number BigIntegerField(null)

    class Meta:
        db_table = 'beacon_logs'
        indexes  = [
            Index(['agent_id', 'severity', 'timestamp']),
            Index(['agent_id', 'source',   'timestamp']),
        ]
```

**LogSeverity values:** `Trace` | `Debug` | `Info` | `Warning` | `Error` | `Critical`

**LogSource values:** `systemd-journald` | `syslog` | `kernel` | `docker` | `kubernetes` | `internal`

### 5.8 AuditLog (Immutable)

```python
class AuditLog(models.Model):
    timestamp   DateTimeField(auto_add, db_index)
    user        CharField(150, db_index)    # Username snapshot at time of action
    ip_address  GenericIPAddressField(null)
    action      CharField(64, db_index)     # LOGIN, AGENT_REMOVE, CONFIG_SET, ...
    resource    CharField(64, db_index)     # agents, logs, users, auth, config
    resource_id CharField(256)
    details     JSONField(dict)
    success     BooleanField(True)
```

**Immutability enforcement:**
```python
def save(self, *args, **kwargs):
    if self.pk:  # pk is set only after initial insert
        raise ValueError("Audit log records are immutable and cannot be updated.")
    super().save(*args, **kwargs)

def delete(self, *args, **kwargs):
    raise ValueError("Audit log records are immutable and cannot be deleted.")
```

### 5.9 ServerConfig

```python
class ServerConfig(models.Model):
    key         CharField(128, unique)
    value       JSONField
    encrypted   BooleanField(False)
    updated_by  CharField(150)
    updated_at  DateTimeField(auto)
    description TextField

    class Meta:
        db_table = 'beacon_server_config'
        ordering = ['key']
```

### 5.10 ServerHealth

```python
class ServerHealth(models.Model):
    timestamp      DateTimeField(auto_add)
    status         CharField(32)
    agents_online  IntegerField(0)
    agents_total   IntegerField(0)
    metrics_rate   FloatField(0.0)   # metrics/sec
    logs_rate      FloatField(0.0)   # logs/sec
    db_size_bytes  BigIntegerField(0)
    details        JSONField(dict)

    class Meta:
        db_table      = 'beacon_server_health'
        get_latest_by = 'timestamp'
```

---

## 6. REST API Reference

### Base URL

```
https://<server>/api/v1/
```

### Authentication Header

All protected endpoints require:
```
Authorization: Bearer <access_token>
```

### Global Response Format

All responses are JSON. Error responses follow DRF standard:
```json
{
  "detail": "Error message here."
}
```
or field-level validation errors:
```json
{
  "field_name": ["Error message."]
}
```

---

### 6.1 Authentication — `/api/v1/auth/`

#### `POST /api/v1/auth/login/`

Obtain a JWT access + refresh token pair.

**Permission:** Public (throttled: 5/minute per IP)  
**Request:**
```json
{
  "username": "admin",
  "password": "your-password"
}
```
**Response `200`:**
```json
{
  "access":  "<jwt-access-token>",
  "refresh": "<jwt-refresh-token>"
}
```
**Error cases:**
- `400` — Invalid credentials
- `400` — Account locked (`locked_until` is in the future)
- `429` — Throttled (> 5 attempts/minute)

**Side effects:**
- On success: `failed_logins` reset to 0, `last_login_ip` updated, audit event `LOGIN` written
- On failure: `failed_logins` incremented, lockout applied at threshold

---

#### `POST /api/v1/auth/logout/`

Blacklist the refresh token to invalidate the session.

**Permission:** Authenticated  
**Request:**
```json
{ "refresh": "<jwt-refresh-token>" }
```
**Response `200`:**
```json
{ "detail": "Logged out successfully." }
```
**Side effects:** Audit event `LOGOUT` written; token added to JWT blacklist table.

---

#### `POST /api/v1/auth/refresh/`

Obtain a new access token using a valid refresh token.

**Permission:** Public  
**Request:**
```json
{ "refresh": "<jwt-refresh-token>" }
```
**Response `200`:**
```json
{
  "access":  "<new-access-token>",
  "refresh": "<new-refresh-token>"
}
```
**Notes:** Refresh token is rotated on every use (`ROTATE_REFRESH_TOKENS=True`). Old token is blacklisted (`BLACKLIST_AFTER_ROTATION=True`).

---

#### `GET /api/v1/auth/whoami/`

Return current authenticated user info.

**Permission:** Authenticated  
**Response `200`:**
```json
{
  "id":         1,
  "username":   "admin",
  "email":      "admin@example.com",
  "role":       "administrator",
  "is_active":  true,
  "created_at": "2024-01-15T10:00:00Z",
  "last_login": "2024-01-15T14:23:01Z"
}
```

---

#### `POST /api/v1/auth/password/change/`

Change the authenticated user's password.

**Permission:** Authenticated  
**Request:**
```json
{
  "old_password": "current-password",
  "new_password": "new-password-min-12-chars"
}
```
**Response `200`:**
```json
{ "detail": "Password changed successfully." }
```
**Side effects:** Audit event `PASSWORD_CHANGE` written.

---

#### `POST /api/v1/auth/password/recover/`

Reset password using recovery key. Rate-limited (5/minute).

**Permission:** Public  
**Request:**
```json
{
  "username":     "admin",
  "recovery_key": "A3F1-B2E4-C5D6-E7F8",
  "new_password": "new-password-min-12-chars"
}
```
**Response `200`:**
```json
{
  "detail":           "Password reset successful. Save your new recovery key.",
  "new_recovery_key": "XXXX-XXXX-XXXX-XXXX"
}
```
**Notes:** Recovery key is consumed (invalidated) on use. A new key is automatically generated and returned — it must be saved immediately.

---

#### `POST /api/v1/auth/recovery-key/generate/`

Generate a new recovery key for the authenticated user.

**Permission:** Authenticated  
**Response `200`:**
```json
{
  "recovery_key": "A3F1-B2E4-C5D6-E7F8",
  "warning":      "Save this key securely. It will not be shown again."
}
```
**Notes:** Previous recovery key is deleted before the new one is created.

---

### 6.2 User Management — `/api/v1/users/`

All endpoints require **Administrator** role.

#### `GET /api/v1/users/`

List all users.

**Response `200`:** Array of user objects.

---

#### `POST /api/v1/users/`

Create a new user.

**Request:**
```json
{
  "username": "newuser",
  "email":    "user@example.com",
  "password": "min-12-char-password",
  "role":     "viewer"
}
```
**Response `201`:** User object.

---

#### `GET /api/v1/users/<id>/`

Get user detail.

**Response `200`:** User object.

---

#### `PATCH /api/v1/users/<id>/`

Update user fields (partial update).

**Response `200`:** Updated user object.

---

#### `DELETE /api/v1/users/<id>/`

Delete a user. Cannot delete own account.

**Response `204`:** No content.

---

#### `POST /api/v1/users/<id>/role/`

Assign a role to a user.

**Request:**
```json
{ "role": "administrator" }
```
**Response `200`:** Updated user object.  
**Valid roles:** `viewer`, `administrator`

---

#### `POST /api/v1/users/<id>/enable/`
#### `POST /api/v1/users/<id>/disable/`

Enable or disable a user account. Cannot disable own account.

**Response `200`:** Updated user object.

---

### 6.3 Agents — `/api/v1/agents/`

#### `GET /api/v1/agents/`

List all registered agents.

**Permission:** Viewer  
**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tag` | string | Filter by tag |
| `status` | string | Filter by agent status |

**Response `200`:**
```json
[
  {
    "id":           1,
    "agent_id":     "sha256:a3f1b2e4c5d6e7f8...",
    "hostname":     "prod-server-01",
    "os":           "linux",
    "architecture": "x86_64",
    "version":      "1.0.0",
    "tags":         ["production", "web"],
    "status":       "ONLINE",
    "is_active":    true,
    "registered_at": "2024-01-15T10:00:00Z",
    "last_seen":    "2024-01-15T14:23:00Z",
    "is_stale":     false,
    "metadata":     {},
    "collector_health": [
      {
        "collector":     "cpu",
        "status":        "Healthy",
        "last_run":      "2024-01-15T14:23:00Z",
        "last_success":  "2024-01-15T14:23:00Z",
        "last_failure":  null,
        "failure_count": 0,
        "updated_at":    "2024-01-15T14:23:00Z"
      }
    ]
  }
]
```

---

#### `POST /api/v1/agents/register/`

Register a new agent or update existing registration.

**Permission:** None (agent-facing, validated via `X-Agent-ID` + `X-Agent-Secret` headers in production)  
**Request:**
```json
{
  "agent_id":     "sha256:a3f1...",
  "hostname":     "prod-server-01",
  "os":           "linux",
  "architecture": "x86_64",
  "version":      "1.0.0",
  "tags":         ["production"],
  "metadata":     { "datacenter": "us-east-1" },
  "secret":       "agent-shared-secret"
}
```
**Response `201`** (new) or **`200`** (re-registration): Agent object.

---

#### `GET /api/v1/agents/<agent_id>/`

Get agent detail.

**Permission:** Viewer (read), Administrator (write)  
**Response `200`:** Agent object with collector health.

---

#### `DELETE /api/v1/agents/<agent_id>/`

Remove an agent.

**Permission:** Administrator  
**Response `204`.**

---

#### `POST /api/v1/agents/<agent_id>/heartbeat/`

Lightweight heartbeat to update `last_seen`. Called by the agent every 15 seconds.

**Permission:** None (agent-facing)  
**Request:**
```json
{ "status": "ONLINE" }
```
**Response `200`:**
```json
{
  "ack":         true,
  "server_time": "2024-01-15T14:23:01Z"
}
```

---

#### `POST /api/v1/agents/<agent_id>/rename/`

Rename an agent's hostname.

**Permission:** Administrator  
**Request:**
```json
{ "hostname": "new-hostname" }
```
**Response `200`:** Updated agent object.

---

#### `POST /api/v1/agents/<agent_id>/regenerate-id/`

Generate a new agent_id. Returns the new ID; the agent config must be updated.

**Permission:** Administrator  
**Response `200`:**
```json
{
  "agent_id": "regen-<32-hex-chars>",
  "warning":  "Update the agent configuration with the new ID."
}
```

---

#### `POST /api/v1/agents/<agent_id>/enable/`
#### `POST /api/v1/agents/<agent_id>/disable/`

Enable or disable an agent.

**Permission:** Administrator  
**Response `200`:** Updated agent object.

---

#### `POST /api/v1/agents/<agent_id>/collectors/health/`

Update a collector's health status (posted by the agent).

**Permission:** None (agent-facing)  
**Request:**
```json
{
  "collector":     "cpu",
  "status":        "Degraded",
  "last_run":      "2024-01-15T14:23:00Z",
  "last_failure":  "2024-01-15T14:23:00Z",
  "failure_count": 3
}
```
**Response `200`:** `{"ack": true}`

---

### 6.4 Telemetry — `/api/v1/telemetry/`

#### `POST /api/v1/telemetry/ingest/`

Ingest a batch of metrics from an agent. This is the primary agent-to-server data path.

**Permission:** None (agent-facing)  
**Request:**
```json
{
  "agent_id": "sha256:a3f1...",
  "metrics": [
    {
      "metric_type":    "cpu",
      "timestamp":      "2024-01-15T14:23:01.123Z",
      "data":           { "usage_pct": 34.2, "load_avg_1m": 0.72 },
      "schema_version": "1.0",
      "sequence_number": 12345
    }
  ]
}
```
**Response `201`:**
```json
{ "ingested": 1 }
```
**Implementation:** Uses `bulk_create(batch_size=500)` for performance. Broadcasts last metric to WebSocket subscribers on `metrics_<agent_id>` channel.

---

#### `GET /api/v1/telemetry/`

Query stored metrics with optional filters.

**Permission:** Viewer  
**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_id` | string | Filter by agent |
| `metric_type` | string | `cpu`, `ram`, `storage`, etc. |
| `resolution` | string | `raw`, `1min`, `1hour` |
| `start` | ISO datetime | Range start (inclusive) |
| `end` | ISO datetime | Range end (inclusive) |
| `limit` | integer | Max results (1–10000, default 1000) |

**Response `200`:** Array of metric objects ordered by `timestamp DESC`.

---

#### `GET /api/v1/telemetry/latest/<agent_id>/`

Get the most recent metric of each type for the specified agent.

**Permission:** Viewer  
**Response `200`:**
```json
{
  "cpu":     { "timestamp": "...", "data": { ... } },
  "ram":     { "timestamp": "...", "data": { ... } },
  "network": { "timestamp": "...", "data": { ... } }
}
```

---

#### `POST /api/v1/telemetry/prune/`

Manually trigger data retention pruning.

**Permission:** Administrator  
**Response `200`:**
```json
{
  "pruned": {
    "raw_1s_24h":    15234,
    "rollup_1m_30d": 8765,
    "rollup_1h_365d": 120
  }
}
```

---

### 6.5 Metric Config — `/api/v1/metrics/`

#### `GET /api/v1/metrics/config/<agent_id>/`

Get collector configuration for an agent.

**Permission:** Viewer (GET), Administrator (PATCH)  
**Response `200`:** MetricConfig object.

---

#### `PATCH /api/v1/metrics/config/<agent_id>/`

Update collector configuration.

**Request (partial):**
```json
{
  "cpu_enabled":       true,
  "docker_enabled":    false,
  "interval_seconds":  10,
  "retention_days":    60
}
```
**Response `200`:** Updated MetricConfig.

---

### 6.6 Logs — `/api/v1/logs/`

#### `POST /api/v1/logs/ingest/`

Ingest a batch of log entries from an agent.

**Permission:** None (agent-facing)  
**Request:**
```json
{
  "agent_id": "sha256:a3f1...",
  "logs": [
    {
      "source":         "systemd-journald",
      "severity":       "Info",
      "message":        "Service started successfully",
      "timestamp":      "2024-01-15T14:23:01.123Z",
      "schema_version": "1.0",
      "extra":          { "unit": "nginx.service" }
    }
  ]
}
```
**Response `201`:** `{"ingested": 1}`

**Security:** Messages are sanitized before storage — null bytes (`\x00`) and carriage returns (`\r`) stripped, message truncated to 8192 characters.

---

#### `GET /api/v1/logs/`

Query log entries with optional filters.

**Permission:** Viewer  
**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `agent_id` | string | Filter by agent |
| `source` | string | `systemd-journald`, `syslog`, `kernel`, `docker`, `kubernetes`, `internal` |
| `severity` | string | `Trace`, `Debug`, `Info`, `Warning`, `Error`, `Critical` |
| `search` | string | Case-insensitive message substring search |
| `start` | ISO datetime | Range start |
| `end` | ISO datetime | Range end |
| `limit` | integer | Max results (1–10000, default 500) |

**Response `200`:** Array of log entries ordered `timestamp DESC`.

---

#### `GET /api/v1/logs/export/`

Export logs as a downloadable JSON file.

**Permission:** Viewer  
**Response:** JSON file download (`Content-Disposition: attachment`). Max 10,000 records.

---

#### `POST /api/v1/logs/clear/`

Clear logs, optionally filtered by agent or severity.

**Permission:** Administrator  
**Request:**
```json
{
  "agent_id": "sha256:a3f1...",
  "severity": "Debug"
}
```
Both fields are optional. Without them, all logs are cleared.  
**Response `200`:** `{"deleted": 1234}`

---

### 6.7 Audit — `/api/v1/audit/`

All endpoints require **Administrator** role. Records are read-only.

#### `GET /api/v1/audit/`

Query the audit trail.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `user` | string | Filter by username |
| `action` | string | Filter by action (e.g. `LOGIN`, `AGENT_REMOVE`) |
| `resource` | string | Filter by resource type |
| `start` | ISO datetime | Range start |
| `end` | ISO datetime | Range end |
| `limit` | integer | Max results (default 500, max 10000) |

**Response `200`:**
```json
[
  {
    "id":          1,
    "timestamp":   "2024-01-15T14:23:01Z",
    "user":        "admin",
    "ip_address":  "192.168.1.10",
    "action":      "AGENT_REMOVE",
    "resource":    "agents",
    "resource_id": "sha256:a3f1...",
    "details":     {},
    "success":     true
  }
]
```

---

#### `GET /api/v1/audit/export/`

Export up to 50,000 audit records as a downloadable JSON file.

---

### 6.8 Health — `/api/v1/health/`

#### `GET /api/v1/health/`

Get server and fleet health summary.

**Permission:** Viewer  
**Response `200`:**
```json
{
  "server_status": "ONLINE",
  "timestamp":     "2024-01-15T14:23:01Z",
  "agents": {
    "total":    12,
    "online":   10,
    "degraded":  1,
    "offline":   1
  },
  "latest_snapshot": { ... }
}
```

---

#### `GET /api/v1/health/agents/<agent_id>/`

Get per-agent health with collector detail.

**Permission:** Viewer  
**Response `200`:**
```json
{
  "agent_id":  "sha256:a3f1...",
  "hostname":  "prod-server-01",
  "status":    "ONLINE",
  "last_seen": "2024-01-15T14:23:00Z",
  "is_stale":  false,
  "collectors": {
    "cpu":     { "status": "Healthy",  "last_run": "...", "failure_count": 0 },
    "ram":     { "status": "Healthy",  "last_run": "...", "failure_count": 0 },
    "storage": { "status": "Degraded", "last_run": "...", "failure_count": 2 }
  }
}
```

---

### 6.9 Configuration — `/api/v1/config/`

All endpoints require **Administrator** role.

#### `GET /api/v1/config/`

List all server configuration keys.

---

#### `POST /api/v1/config/`

Create a new configuration key.

**Request:**
```json
{
  "key":         "my_setting",
  "value":       { "enabled": true, "threshold": 90 },
  "description": "Optional description",
  "encrypted":   false
}
```

---

#### `GET /api/v1/config/<key>/`
#### `PUT /api/v1/config/<key>/`
#### `DELETE /api/v1/config/<key>/`

Read, update, or delete a specific configuration key.

---

#### `GET /api/v1/config/retention/`

Get the current data retention policy.

**Response `200`:**
```json
{
  "raw_hours":      24,
  "rollup_1m_days": 30,
  "rollup_1h_days": 365
}
```

---

#### `PUT /api/v1/config/retention/`

Update the data retention policy.

---

### 6.10 Server Health Check

#### `GET /health/`

Unauthenticated server liveness check.

**Response `200`:**
```json
{ "status": "ok", "service": "beacon-server" }
```

---

## 7. WebSocket Engine

The WebSocket engine uses **Django Channels** backed by **Redis** as the channel layer. Two consumers are provided.

### 7.1 Endpoints

| URL | Consumer | Purpose |
|-----|----------|---------|
| `wss://<server>/ws/ingest/` | `AgentIngestConsumer` | Agent → Server data push |
| `wss://<server>/ws/subscribe/` | `ClientSubscribeConsumer` | Client real-time subscriptions |

### 7.2 Agent Authentication (WebSocket)

The `ClientSubscribeConsumer` requires authentication via JWT passed as:

- **Query string:** `?token=<access_token>`
- **Header:** `Authorization: Bearer <access_token>`

Authentication is enforced in `JWTAuthMiddleware` before the consumer receives the connection. Unauthenticated connections are rejected with code `4001`.

Agent connections (`/ws/ingest/`) authenticate during the `register` message exchange.

### 7.3 AgentIngestConsumer — Message Protocol

The agent sends JSON messages. MessagePack is also supported (detected by binary frame).

**Inbound message format:**
```json
{
  "type":    "<message_type>",
  "payload": { ... }
}
```

**Supported message types:**

| Type | Payload | Description |
|------|---------|-------------|
| `register` | Agent registration fields | First message; establishes identity |
| `heartbeat` | `{"status": "ONLINE"}` | Keep-alive every 15 seconds |
| `metrics` | Array of metric objects | Telemetry data push |
| `logs` | Array of log objects | Log data push |
| `collector_health` | Collector health object | Per-collector status update |
| `status_update` | `{"status": "<AgentStatus>"}` | Agent status change notification |

**Outbound responses:**

| Type | Sent After |
|------|-----------|
| `registered` | Successful `register` |
| `heartbeat_ack` | Each `heartbeat` |
| `metrics_ack` | Each `metrics` batch, includes `{"ingested": N}` |
| `logs_ack` | Each `logs` batch |
| `collector_health_ack` | Health update |
| `status_ack` | Status update |
| `error` | Any invalid message |

### 7.4 ClientSubscribeConsumer — Channel Subscriptions

Clients subscribe to typed channels per agent:

**Subscribe request:**
```json
{
  "action":   "subscribe",
  "channel":  "metrics",
  "agent_id": "sha256:a3f1..."
}
```

**Unsubscribe request:**
```json
{
  "action":   "unsubscribe",
  "channel":  "logs",
  "agent_id": "sha256:a3f1..."
}
```

**Available channels:**

| Channel | Group Name Pattern | Event Type |
|---------|-------------------|------------|
| `metrics` | `metrics_<agent_id>` | `metric.update` |
| `logs` | `logs_<agent_id>` | `log.entry` |
| `telemetry` | `telemetry_<agent_id>` | `telemetry.update` |
| `health` | `health_<agent_id>` | `health.update` |

**Broadcast format received by subscriber:**
```json
{
  "channel": "metrics",
  "data":    { ... }
}
```

### 7.5 Channel Layer Configuration

```python
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts":    ["redis://localhost:6379/0"],
            "capacity": 1500,
            "expiry":   10,
        },
    }
}
```

---

## 8. Authentication & Authorization

### 8.1 JWT Token Model

```python
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":    timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME":   timedelta(days=7),
    "ROTATE_REFRESH_TOKENS":    True,     # New refresh token issued on each refresh
    "BLACKLIST_AFTER_ROTATION": True,     # Old refresh token blacklisted
    "UPDATE_LAST_LOGIN":        True,
    "ALGORITHM":                "HS256",
    "JTI_CLAIM":                "jti",    # JWT ID for replay prevention
    "AUTH_HEADER_TYPES":        ("Bearer",),
}
```

**Token claims (access token):**
```json
{
  "token_type": "access",
  "user_id":    1,
  "username":   "admin",
  "role":       "administrator",
  "jti":        "<unique-token-id>",
  "exp":        1705329781,
  "iat":        1705327981
}
```

**Session replay prevention:** JTI tracking via token blacklist. Each token has a unique `jti` claim. Blacklisted tokens are rejected even if not yet expired.

### 8.2 Password Storage

```python
class Argon2idHasher(BasePasswordHasher):
    algorithm   = "argon2id"
    time_cost   = 3       # iterations
    memory_cost = 65536   # 64 MB RAM
    parallelism = 4       # parallel threads
    hash_len    = 32      # output length bytes
    salt_len    = 16      # salt bytes
```

Parameters meet or exceed OWASP Argon2id minimum recommendations. Plaintext storage is prohibited at every layer — enforced in the custom hasher class.

### 8.3 Recovery Key Storage

```
raw_key  = "A3F1-B2E4-C5D6-E7F8"
clean    = raw_key.replace("-", "").upper()  → "A3F1B2E4C5D6E7F8"
stored   = SHA-256(clean.encode())
```

The raw key is never stored. Only the SHA-256 hash is persisted. The raw key is shown once on generation and never again.

---

## 9. RBAC Permission System

### 9.1 Roles

| Role | Capabilities |
|------|-------------|
| `viewer` | Read all telemetry, logs, agents, health; export data |
| `administrator` | All viewer capabilities + manage agents, users, config, encryption, retention |

### 9.2 Permission Classes

```python
class IsAdministrator(BasePermission):
    # Only role == 'administrator' passes

class IsViewer(BasePermission):
    # role in ('viewer', 'administrator') passes

class IsAdminOrReadOnly(BasePermission):
    # GET/HEAD/OPTIONS → IsViewer
    # POST/PUT/PATCH/DELETE → IsAdministrator

class IsAgentAuthenticated(BasePermission):
    # Validates X-Agent-ID + X-Agent-Secret headers
    # Looks up Agent.verify_secret(raw_secret)
```

### 9.3 Permission Matrix

| Endpoint | Viewer | Administrator |
|----------|--------|---------------|
| `GET /api/v1/agents/` | ✓ | ✓ |
| `POST /api/v1/agents/register/` | — | — (agent-auth) |
| `DELETE /api/v1/agents/<id>/` | ✗ | ✓ |
| `POST /api/v1/agents/<id>/enable/` | ✗ | ✓ |
| `POST /api/v1/agents/<id>/rename/` | ✗ | ✓ |
| `POST /api/v1/telemetry/ingest/` | — | — (agent-auth) |
| `GET /api/v1/telemetry/` | ✓ | ✓ |
| `POST /api/v1/telemetry/prune/` | ✗ | ✓ |
| `POST /api/v1/logs/ingest/` | — | — (agent-auth) |
| `GET /api/v1/logs/` | ✓ | ✓ |
| `POST /api/v1/logs/clear/` | ✗ | ✓ |
| `GET /api/v1/audit/` | ✗ | ✓ |
| `GET /api/v1/health/` | ✓ | ✓ |
| `GET /api/v1/config/` | ✗ | ✓ |
| `PUT /api/v1/config/retention/` | ✗ | ✓ |
| `GET /api/v1/users/` | ✗ | ✓ |
| `POST /api/v1/users/` | ✗ | ✓ |
| `POST /api/v1/users/<id>/role/` | ✗ | ✓ |
| `GET /api/v1/metrics/config/<id>/` | ✓ | ✓ |
| `PATCH /api/v1/metrics/config/<id>/` | ✗ | ✓ |

### 9.4 Enforcement Boundaries

RBAC is enforced at every boundary. UI-only restrictions are explicitly rejected as insufficient:

- REST API (permission classes on every view)
- WebSocket consumers (JWT middleware + scope check)
- Django Admin (is_staff / is_superuser)
- Database actions (checked before every write)
- CLI commands (role checked before execution)

---

## 10. Audit System

### 10.1 AuditMiddleware

Automatically logs all write operations:

```python
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SKIP_PATHS    = {"/health/", "/api/v1/auth/refresh/"}
```

Fires after response, records: user, IP, HTTP method, path, status code, success flag.

### 10.2 Manual Audit Events

The `audit_log()` utility is called explicitly for significant business events:

| Action | Trigger |
|--------|---------|
| `LOGIN` | Successful password authentication |
| `LOGOUT` | Token blacklisted |
| `PASSWORD_CHANGE` | User changes own password |
| `PASSWORD_RECOVERY` | Recovery key used |
| `RECOVERY_KEY_GENERATED` | New recovery key issued |
| `USER_CREATE` | Administrator creates user |
| `USER_UPDATE` | User record modified |
| `USER_DELETE` | User deleted |
| `USER_ROLE_ASSIGN` | Role changed |
| `USER_ENABLE` / `USER_DISABLE` | Account activated/deactivated |
| `AGENT_REGISTER` | New agent registered |
| `AGENT_RECONNECT` | Existing agent reconnected |
| `AGENT_REMOVE` | Agent deleted |
| `AGENT_RENAME` | Agent hostname changed |
| `AGENT_REGEN_ID` | Agent ID regenerated |
| `AGENT_ENABLE` / `AGENT_DISABLE` | Agent activated/deactivated |
| `LOG_CLEAR` | Logs deleted |
| `CONFIG_SET` | Config key created |
| `CONFIG_UPDATE` | Config key updated |
| `CONFIG_DELETE` | Config key deleted |
| `RETENTION_UPDATE` | Retention policy changed |

### 10.3 IP Address Extraction

```python
ip = (
    request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip()
    or request.META.get("REMOTE_ADDR", "")
) or None
```

Supports reverse proxy environments by reading `X-Forwarded-For` first.

---

## 11. Rate Limiting & Throttling

### 11.1 REST API Throttles

```python
DEFAULT_THROTTLE_RATES = {
    "anon":  "20/minute",   # Unauthenticated requests
    "user":  "1000/minute", # Authenticated user requests
    "login": "5/minute",    # Login endpoint (brute-force protection)
}
```

Login throttle is applied to both the `login/` and `password/recover/` endpoints.

### 11.2 WebSocket Back-pressure

- **Slow consumers:** Back-pressure applied; oldest buffered frames dropped with warning logged
- **Client floods:** Rate limiting per connection; connections exceeding limit are closed
- **Reconnect storms:** Exponential backoff enforced on all reconnects
- **Memory exhaustion:** Per-client buffer cap (`capacity: 1500`); server closes offending connections

### 11.3 Agent-side Rate Limiting

```
BEACON_RATE_LIMIT_PER_AGENT = 100  # messages/second per agent
```

---

## 12. Rust Agent — Architecture

### 12.1 Module Structure

```
src/
├── main.rs             # Entry point, CLI, daemon runner
├── config/
│   └── mod.rs          # AgentConfig (TOML-backed)
├── engines/
│   ├── mod.rs          # Re-exports
│   ├── identity.rs     # AgentIdentity derivation
│   ├── health.rs       # HealthEngine, per-collector tracking
│   ├── queue.rs        # QueueEngine, offline buffering
│   ├── encryption.rs   # EncryptionEngine (AES-256-GCM)
│   └── tui.rs          # Ratatui TUI
├── collectors/
│   ├── mod.rs          # start_all(), TelemetryPayload
│   ├── cpu.rs          # CPU metrics
│   ├── ram.rs          # RAM metrics
│   ├── storage.rs      # Disk metrics
│   ├── network.rs      # Network metrics
│   ├── process.rs      # Process metrics
│   ├── systemd.rs      # Systemd service metrics
│   ├── docker.rs       # Docker container metrics
│   └── kernel.rs       # Kernel / system info
├── storage/
│   └── mod.rs          # StorageManager (4 SQLite DBs)
└── transport/
    └── mod.rs          # WebSocketTransport (TLS 1.3)
```

### 12.2 Async Architecture

The agent is built on the **Tokio** async runtime with `#[tokio::main]`. Each subsystem runs as an independent Tokio task:

```
main()
  └─ run_daemon()
       ├─ StorageManager::new()       (async init)
       ├─ IdentityEngine::new()       (async init)
       ├─ EncryptionEngine::new()     (async init)
       ├─ QueueEngine::new()          (async init)
       ├─ HealthEngine::new()         (sync)
       │
       ├─ collectors::start_all()     → N × tokio::spawn(collector::run())
       │    ├─ tokio::spawn(cpu::run())
       │    ├─ tokio::spawn(ram::run())
       │    ├─ tokio::spawn(storage::run())
       │    ├─ tokio::spawn(network::run())
       │    ├─ tokio::spawn(process::run())
       │    ├─ tokio::spawn(systemd::run())
       │    ├─ tokio::spawn(docker::run())
       │    └─ tokio::spawn(kernel::run())
       │
       └─ tokio::select!
            ├─ transport.run()         → connect_and_run() loop
            └─ tokio::signal::ctrl_c()
```

**Isolation principle:** Each collector is an independent Tokio task. A panic or failure in one collector does not affect any other. The `HealthEngine` tracks each collector's status independently.

---

## 13. Identity Engine

### 13.1 agent_id Derivation

The `agent_id` is a stable SHA-256 hash derived from hardware characteristics. It is computed once and persisted to `config.db`. On subsequent starts, the stored value is loaded directly.

**Input components:**
1. `/etc/machine-id` — kernel-assigned stable machine identifier
2. Hostname — from `/etc/hostname` or `hostname` command
3. CPU architecture — `std::env::consts::ARCH`
4. CPU model — first `model name` or `Hardware` line from `/proc/cpuinfo`
5. RAM total — first line of `/proc/meminfo`
6. Random 256-bit salt — generated once, stored in `/var/lib/beacon/agent/.identity_salt`

**Derivation:**
```
agent_id = "sha256:" + hex(SHA-256(
    machine_id + hostname + arch + cpu_model + ram_total + salt
))
```

**Stability:** Stable across reboots, kernel upgrades, and package updates. Changes only if hardware is replaced or the identity salt file is deleted.

### 13.2 Server Registration

On first WebSocket connection, the agent sends a `register` message:
```json
{
  "type": "register",
  "payload": {
    "agent_id":     "sha256:<hex>",
    "hostname":     "prod-server-01",
    "os":           "linux",
    "architecture": "x86_64",
    "version":      "1.0.0",
    "tags":         [],
    "metadata":     {}
  }
}
```

The server performs `update_or_create` on the `Agent` model — subsequent registrations update metadata without creating duplicates.

---

## 14. Encryption Engine

### 14.1 Payload Encryption

Algorithm: **AES-256-GCM** (authenticated encryption with associated data)

**Encrypted payload format:**
```
[nonce: 12 bytes] || [AES-GCM ciphertext + tag]
```

The nonce is randomly generated per encryption using `OsRng`. It is prepended to the ciphertext and stored/transmitted together.

### 14.2 Key Management

**Key generation:** 256-bit key generated via `OsRng::fill_bytes()`.

**Key storage:** Stored in the `encryption_keys` table in `config.db` as raw bytes. Only the most recently stored key has `active = 1`.

**Key derivation from password** (Argon2id):
```rust
Argon2::new(Algorithm::Argon2id, Version::V0x13, Params {
    m_cost:  65536,  // 64 MB
    t_cost:  3,      // iterations
    p_cost:  4,      // parallelism
    output:  32,     // bytes
})
```

### 14.3 Key Rotation

Key rotation is atomic with rollback support at each step:

```
Step 1: Generate new AES-256-GCM key
Step 2: Fetch all non-Sent queue messages
Step 3: Decrypt each with old key
Step 4: Re-encrypt each with new key
Step 5: Verify round-trip (encrypt + decrypt test vector)
Step 6: Commit: store_encryption_key(new) + update in-memory key
```

If any step fails before Step 6, the old key remains active. The DB is not updated until full verification passes.

### 14.4 What Gets Encrypted

- Queued outbound payloads (stored locally in `queue.db`)
- Sensitive configuration values (`encrypted=True` in ServerConfig)
- Optionally: full log storage

---

## 15. Queue Engine

### 15.1 Message Lifecycle

```
Enqueue → Pending → Processing → Sent (pruned after 24h)
                 ↘ Failed (retried, max 5 times) → DeadLetter
                 ↘ Checksum mismatch → DeadLetter
```

### 15.2 Constants

```rust
const MAX_RETRIES:    u32   = 5;
const MAX_DEAD_LETTER: usize = 10_000;
const BATCH_SIZE:     usize  = 100;
```

### 15.3 Checksum Validation

Every message gets a SHA-256 checksum on enqueue:
```rust
fn compute_checksum(payload: &[u8]) -> String {
    hex::encode(Sha256::digest(payload))
}
```

On dequeue, the checksum is recomputed and compared. Mismatches move the message directly to dead letter without retry.

### 15.4 Dead Letter Queue

When a message enters the DLQ:
- Removed from `queue` table
- Inserted into `dead_letter` table with `reason` field
- If DLQ has ≥ 10,000 entries, oldest entry is archived (deleted) before insertion

Reasons: `"max_retries_exceeded"`, `"checksum_mismatch"`

### 15.5 Offline Buffering

During network loss, the agent continues all local operations:
- Collectors continue running at normal interval
- All telemetry is stored in `metrics.db`
- All queue messages remain as `Pending` in `queue.db`
- On reconnection, `flush_loop` automatically drains the queue

On shutdown, all `Processing` messages are reset to `Pending` to prevent message loss.

### 15.6 Deduplication

Each message has a UUID `message_id`. The `queue` table has `UNIQUE` constraint on `message_id`. Duplicate enqueue attempts are silently ignored via `INSERT OR IGNORE`.

---

## 16. Storage Engine (SQLite)

### 16.1 Database Files

| File | Contents | Tables |
|------|----------|--------|
| `config.db` | Agent identity, config KV, encryption keys | `config`, `agent_identity`, `encryption_keys` |
| `metrics.db` | Telemetry data | `metrics` |
| `logs.db` | Log entries, audit trail | `logs`, `audit_logs` |
| `queue.db` | Outbound message queue | `queue`, `dead_letter` |

### 16.2 SQLite Pragmas (all databases)

```sql
PRAGMA journal_mode = WAL;      -- Write-Ahead Log for concurrent reads
PRAGMA synchronous  = NORMAL;   -- Performance/durability balance
PRAGMA foreign_keys = ON;       -- Enforce FK constraints
PRAGMA cache_size   = -8000;    -- 8 MB page cache
```

WAL mode ensures durability on unexpected power loss — transactions that were committed before the crash are not lost.

### 16.3 Key SQL Schemas

**metrics table:**
```sql
CREATE TABLE metrics (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id        TEXT    NOT NULL,
    metric_type     TEXT    NOT NULL,
    resolution      TEXT    NOT NULL DEFAULT 'raw',
    timestamp       TEXT    NOT NULL,
    data            TEXT    NOT NULL,
    schema_version  TEXT    NOT NULL DEFAULT '1.0',
    sequence_number INTEGER,
    synced          INTEGER NOT NULL DEFAULT 0   -- 0=local only, 1=sent to server
);
CREATE INDEX idx_metrics_agent_type_ts ON metrics(agent_id, metric_type, timestamp);
CREATE INDEX idx_metrics_synced        ON metrics(synced, timestamp);
```

**queue table:**
```sql
CREATE TABLE queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  TEXT    NOT NULL UNIQUE,         -- UUID for deduplication
    payload     BLOB    NOT NULL,
    msg_type    TEXT    NOT NULL,
    state       TEXT    NOT NULL DEFAULT 'Pending',
    retries     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    checksum    TEXT    NOT NULL                  -- SHA-256 for integrity
);
CREATE INDEX idx_queue_state ON queue(state, created_at);
```

**agent_identity table:**
```sql
CREATE TABLE agent_identity (
    id         INTEGER PRIMARY KEY CHECK (id = 1),  -- Exactly one row enforced
    agent_id   TEXT NOT NULL,
    hostname   TEXT NOT NULL,
    created_at TEXT NOT NULL
);
```

### 16.4 Maintenance Operations

| Operation | SQL | Trigger |
|-----------|-----|---------|
| Integrity check | `PRAGMA integrity_check` | On startup, `beacon-agent db verify` |
| WAL checkpoint | `PRAGMA wal_checkpoint(TRUNCATE)` | `beacon-agent db vacuum` |
| Full vacuum | `VACUUM` | `beacon-agent db vacuum` |
| Metric pruning | `DELETE FROM metrics WHERE resolution=? AND timestamp < ?` | Periodic / manual |

---

## 17. Transport Layer

### 17.1 Connection Constants

```rust
const HEARTBEAT_INTERVAL:   Duration = Duration::from_secs(15);
const RECONNECT_BASE_DELAY: Duration = Duration::from_secs(1);
const RECONNECT_MAX_DELAY:  Duration = Duration::from_secs(60);
const FLUSH_BATCH_SIZE:     usize    = 50;
```

### 17.2 Reconnection Logic

```rust
loop {
    match connect_and_run().await {
        Ok(())  => backoff = RECONNECT_BASE_DELAY,     // Clean disconnect: reset backoff
        Err(_)  => {
            sleep(backoff).await;
            backoff = (backoff * 2).min(RECONNECT_MAX_DELAY);  // Exponential, capped at 60s
        }
    }
}
```

Backoff sequence: 1s → 2s → 4s → 8s → 16s → 32s → 60s (held)

### 17.3 TLS Configuration

```rust
ClientConfig::builder()
    .with_root_certificates(root_store)  // System native certs via rustls-native-certs
    .with_no_client_auth()               // mTLS not required
```

`verify_cert = false` is supported for development only (loads WebPKI roots as fallback). A warning is logged; production use is explicitly discouraged.

### 17.4 Concurrent Loops

Inside each connection, three Tokio futures run concurrently via `tokio::select!`:

```
connect_and_run()
  └─ tokio::select!
       ├─ heartbeat_loop()    → sends ping every 15s
       ├─ flush_loop()        → drains queue → server
       └─ read_loop()         → processes server → agent messages
```

The first loop to return (success or error) causes all others to be cancelled, triggering reconnection.

### 17.5 Flush Loop

```
loop:
  batch = queue.dequeue_batch(50)
  if empty: sleep(500ms); continue
  for each msg:
    decrypt(payload)  ← local AES-256-GCM decryption
    wrap in transport envelope
    writer.send(envelope)
    on success: queue.ack(id)
    on error:   queue.nack(id) → retry or DLQ; return Err → reconnect
  sleep(100ms)
```

### 17.6 Offline State

When the transport layer is not connected (between reconnect attempts):
- All collectors continue running normally
- All telemetry is queued to `queue.db` as `Pending`
- The queue accumulates up to `max_queue_size` (default 100,000) messages
- On reconnect, `flush_loop` drains the accumulated queue automatically

---

## 18. Health Engine

### 18.1 Agent Status State Machine

```
BOOTING → INITIALIZING → ONLINE ↔ DEGRADED
                                 ↓
                          OFFLINE_BUFFERING
                                 ↓
                          RECOVERING → ONLINE
                                 ↓
                          FAILED
          
         Any state → SHUTTING_DOWN (on SIGINT/SIGTERM)
```

### 18.2 Collector Status Escalation

```rust
record_failure(name, error):
    failure_count += 1
    if failure_count >= 5:
        status = Failed
    else:
        status = Degraded

    // Re-evaluate agent status
    if any collector.status == Failed AND agent.status == Online:
        agent.status = Degraded

record_success(name):
    status = Healthy
    failure_count = max(0, failure_count - 1)
    
    // De-escalate if all collectors recovered
    if no collector is Failed/Degraded AND agent.status == Degraded:
        agent.status = Online
```

### 18.3 HealthSnapshot

Exported as a WebSocket message on the `health_<agent_id>` channel:

```json
{
  "type":        "health",
  "status":      "ONLINE",
  "uptime_secs": 86400,
  "snapshot_at": "2024-01-15T14:23:01Z",
  "collectors": [
    {
      "name":          "cpu",
      "status":        "Healthy",
      "last_run":      "2024-01-15T14:23:01Z",
      "last_success":  "2024-01-15T14:23:01Z",
      "failure_count": 0
    }
  ]
}
```

---

## 19. Telemetry Collectors

### 19.1 Shared Infrastructure

Each collector is an independent `async fn run(...)` started as a Tokio task. All collectors share the same interface:

```rust
pub async fn run(
    identity: AgentIdentity,    // Agent ID for payload tagging
    queue:    QueueEngine,      // Outbound queue
    storage:  StorageManager,   // Local SQLite storage
    interval: Duration,         // Collection interval
) -> ! { loop { collect(); sleep(interval).await; } }
```

Every collection result is:
1. Stored locally in `metrics.db` (`synced = 0`)
2. Enqueued to `queue.db` as `Pending` for server transmission

**TelemetryPayload schema:**
```json
{
  "agent_id":        "sha256:a3f1...",
  "metric_type":     "cpu",
  "timestamp":       "2024-01-15T14:23:01.123Z",
  "data":            { ... },
  "schema_version":  "1.0",
  "sequence_number": 12345
}
```

`sequence_number` is a process-global monotonic counter (atomic `u64`) to detect out-of-order delivery.

### 19.2 CPU Collector

**Sources:** `sysinfo` crate + `/proc/stat` + `/proc/loadavg` + `/sys/class/thermal/`

```json
{
  "usage_pct":        34.2,
  "core_count":       8,
  "per_core": [
    { "core": 0, "usage_pct": 42.1, "frequency": 3600, "name": "cpu0" }
  ],
  "load_avg_1m":      0.72,
  "load_avg_5m":      0.65,
  "load_avg_15m":     0.58,
  "interrupts":       1234567,
  "context_switches": 9876543,
  "temperatures_c": [
    { "zone": 0, "type": "x86_pkg_temp", "temp_c": 52.0 }
  ]
}
```

**Temperature filtering:** Values outside -50°C to +200°C are silently dropped.

### 19.3 RAM Collector

**Sources:** `sysinfo` crate + `/proc/meminfo`

```json
{
  "total_bytes":     16777216000,
  "used_bytes":      8589934592,
  "free_bytes":      1073741824,
  "available_bytes": 7516192768,
  "usage_pct":       51.2,
  "cached_bytes":    4294967296,
  "buffers_bytes":   536870912,
  "slab_bytes":      268435456,
  "swap": {
    "total_bytes": 8589934592,
    "used_bytes":  0,
    "free_bytes":  8589934592,
    "usage_pct":   0.0
  },
  "hugepages": { "total": 0, "free": 0, "size_kb": 2048 },
  "dirty_bytes":     134217728,
  "mapped_bytes":    268435456
}
```

### 19.4 Storage Collector

**Sources:** `sysinfo::Disks` + `/proc/diskstats`

```json
{
  "filesystems": [
    {
      "name":        "sda1",
      "mount_point": "/",
      "fs_type":     "ext4",
      "total_bytes": 107374182400,
      "used_bytes":  53687091200,
      "free_bytes":  53687091200,
      "usage_pct":   50.0,
      "is_removable": false
    }
  ],
  "io_stats": [
    {
      "device":       "sda",
      "reads_total":  1234567,
      "writes_total": 890123,
      "read_delta":   1024,
      "write_delta":  512
    }
  ]
}
```

Loop and RAM devices (`loop*`, `ram*`) are filtered from IO stats.

### 19.5 Network Collector

**Sources:** `sysinfo::Networks` + `/proc/net/tcp` + `/proc/net/tcp6` + `/proc/net/udp`

```json
{
  "interfaces": [
    {
      "name":          "eth0",
      "rx_bytes":      1073741824,
      "tx_bytes":      536870912,
      "rx_packets":    1234567,
      "tx_packets":    890123,
      "rx_errors":     0,
      "tx_errors":     0,
      "rx_bytes_rate": 2097152,
      "tx_bytes_rate": 1048576
    }
  ],
  "tcp": {
    "established": 42,
    "time_wait":   8,
    "close_wait":  2,
    "listening":   15
  },
  "udp": { "sockets": 12 }
}
```

TCP state decoded from `/proc/net/tcp` state field: `01`=ESTABLISHED, `06`=TIME_WAIT, `08`=CLOSE_WAIT, `0A`=LISTEN.

### 19.6 Process Collector

**Sources:** `sysinfo::System::processes()`

**PID reuse prevention:** Process identity uses the triple `(pid, boot_id, start_time)`:
- `boot_id` from `/proc/sys/kernel/random/boot_id` — changes on every reboot
- `start_time` — process creation time from sysinfo

Collection is **capped at `max_processes`** (default 512), sorted by CPU usage descending. Processes beyond the cap are dropped (not an error condition).

```json
{
  "total_processes": 243,
  "collected":       243,
  "capped":          false,
  "processes": [
    {
      "pid":         1234,
      "boot_id":     "550e8400-e29b-41d4-a716-446655440000",
      "start_time":  1705315200,
      "name":        "nginx",
      "exe":         "/usr/sbin/nginx",
      "cpu_pct":     2.3,
      "mem_bytes":   52428800,
      "virtual_mem": 157286400,
      "status":      "Sleeping",
      "parent_pid":  1,
      "threads":     4
    }
  ]
}
```

### 19.7 Systemd Collector

**Source:** `systemctl list-units --type=service --no-pager --plain --no-legend`

```json
{
  "total_services":   45,
  "running_services": 42,
  "failed_services":  0,
  "services": [
    {
      "name":   "nginx.service",
      "load":   "loaded",
      "active": "active",
      "sub":    "running",
      "desc":   "A high performance web server"
    }
  ]
}
```

Capped at 256 services. Non-critical — if `systemctl` is unavailable, an empty service list is reported and a warning logged (not a failure).

### 19.8 Docker Collector

**Source:** `docker ps -a --format '{{json .}}'`

```json
{
  "total_containers":   8,
  "running_containers": 6,
  "stopped_containers": 2,
  "containers": [ { ... } ]
}
```

Non-critical — if Docker is unavailable, an empty list is returned with a warning.

### 19.9 Kernel Collector

**Sources:** `sysinfo::System` kernel/OS info + `/proc/version` + `/proc/sys/kernel/ostype` + `/proc/cmdline` + `/proc/cpuinfo`

```json
{
  "kernel_version":  "6.1.0-18-amd64",
  "os_version":      "Debian GNU/Linux 12",
  "os_type":         "Linux",
  "hostname":        "prod-server-01",
  "architecture":    "x86_64",
  "uptime_secs":     86400,
  "boot_time_unix":  1705228800,
  "cpu_count":       8,
  "proc_version":    "Linux version 6.1.0-18-amd64 ...",
  "cmdline":         "BOOT_IMAGE=/vmlinuz-6.1.0 root=/dev/sda1 quiet splash"
}
```

---

## 20. Terminal User Interface (TUI)

### 20.1 Implementation

Built with **Ratatui 0.26** + **Crossterm 0.27**. Runs in the alternate screen buffer, restoring the terminal on exit.

### 20.2 Views

| View | Key | Content |
|------|-----|---------|
| Dashboard | `1` | CPU/RAM gauges, metric table, recent logs panel |
| Agents | `2` | Agent list with status and metadata |
| Metrics | `3` | Full metric table with values and units |
| Logs | `4` | Scrollable log list with severity color-coding |
| Health | `5` | Per-collector health status table |
| Network | `6` | Network interface statistics |
| Configuration | `7` | Agent and server configuration display |

### 20.3 Keyboard Bindings

| Key | Action |
|-----|--------|
| `Tab` / `→` | Next view |
| `BackTab` / `←` | Previous view |
| `1` – `7` | Jump directly to view |
| `j` / `↓` | Scroll down (Logs view) |
| `k` / `↑` | Scroll up (Logs view) |
| `/` | Open search overlay |
| `ESC` | Close search |
| `Enter` | Confirm search |
| `Backspace` | Delete search character |
| `q` / `Q` | Quit |
| `Ctrl+C` | Force quit |

### 20.4 Live Updates

The TUI polls with a 100ms timeout on the event loop. In production, WebSocket subscriptions push live data to the state shared via `Arc<RwLock<AppState>>`. Metric history ring buffers (60 samples) drive the gauge visualizations.

### 20.5 Severity Color Coding (Logs View)

| Severity | Color |
|----------|-------|
| Critical | Magenta |
| Error | Red |
| Warning | Yellow |
| Info | Green |
| Debug | Blue |
| Trace | Dark Gray |

---

## 21. CLI Reference

### 21.1 Global Flags

```
beacon-agent [--config <path>] [--log-level <level>] <command>

  --config     Config file path (default: /etc/beacon/agent.toml)
  --log-level  trace|debug|info|warn|error (default: info)
```

### 21.2 Complete Command Reference

```bash
# Initialization & service
beacon-agent init
beacon-agent start
beacon-agent status
beacon-agent tui

# Authentication
beacon-agent login --username <user> [--password <pass>]
beacon-agent logout
beacon-agent whoami

# Systemd service management
beacon-agent service install
beacon-agent service remove
beacon-agent service start|stop|restart|status

# Individual collector control
beacon-agent cpu         enable|disable
beacon-agent ram         enable|disable
beacon-agent storage     enable|disable
beacon-agent network     enable|disable
beacon-agent process     enable|disable
beacon-agent systemd     enable|disable
beacon-agent docker      enable|disable
beacon-agent kubernetes  enable|disable

# Bulk metrics control
beacon-agent metrics enable-all
beacon-agent metrics disable-all
beacon-agent metrics interval 1s|5s|30s|1m
beacon-agent metrics retention 30d
beacon-agent metrics status

# Agent management
beacon-agent agent list
beacon-agent agent show <agent_id>
beacon-agent agent enable <agent_id>
beacon-agent agent disable <agent_id>
beacon-agent agent remove <agent_id>
beacon-agent agent rename <agent_id> <new_name>
beacon-agent agent regenerate-id

# Log management
beacon-agent logs view           # Show last 20 local log entries
beacon-agent logs follow         # Stream logs in real-time
beacon-agent logs export <path>
beacon-agent logs search <query>
beacon-agent logs clear
beacon-agent logs clear-errors
beacon-agent logs clear-warnings

# Audit trail
beacon-agent audit logs          # Show last 50 audit entries
beacon-agent audit export <path>

# Database management
beacon-agent db status
beacon-agent db backup [<path>]
beacon-agent db restore <path>
beacon-agent db compact
beacon-agent db vacuum
beacon-agent db verify           # PRAGMA integrity_check on all DBs
beacon-agent db export <path>
beacon-agent db clear
beacon-agent db reset

# Encryption
beacon-agent encryption enable
beacon-agent encryption disable
beacon-agent encryption rotate-key
beacon-agent encryption status

# Queue management
beacon-agent queue status
beacon-agent queue clear
beacon-agent queue pause
beacon-agent queue resume
beacon-agent queue retry-failed

# Server connectivity
beacon-agent server connect
beacon-agent server disconnect
beacon-agent server status
beacon-agent server ping
beacon-agent server test
```

---

## 22. Configuration Reference

### 22.1 Agent Configuration (`agent.toml`)

```toml
# Beacon Server WebSocket address (TLS required in production)
server_addr      = "wss://beacon.example.com/ws/ingest/"
username         = "admin"
storage_dir      = "/var/lib/beacon/agent"
interval_seconds = 5            # 1, 5, 10, 30, 60

[collectors]
cpu             = true
ram             = true
storage         = true
network         = true
process         = true
systemd         = true
docker          = false
kubernetes      = false
temperature     = true
power           = false
max_processes   = 512           # Cap on process collection

[tls]
verify_cert     = true          # Set false only for dev
ca_cert_path    = ""            # Custom CA (empty = system certs)

[queue]
max_retries      = 5            # Before entering DLQ
max_queue_size   = 100000       # Offline buffer limit
retry_backoff_ms = 1000         # Base backoff in milliseconds

[encryption]
enabled           = true
key_rotation_days = 30          # 0 = manual rotation only
```

### 22.2 Server Environment Variables (`.env`)

```bash
SECRET_KEY=<long-random-string>        # Django secret key
DEBUG=false

DB_NAME=beacon
DB_USER=beacon
DB_PASSWORD=<password>
DB_HOST=localhost
DB_PORT=5432

REDIS_URL=redis://localhost:6379/0

BEACON_AGENT_HEARTBEAT_TIMEOUT=60      # Seconds before agent marked stale
BEACON_MAX_AGENTS=1000
BEACON_WEBSOCKET_BUFFER_SIZE=1000
BEACON_RATE_LIMIT_PER_AGENT=100        # Messages/second

BEACON_TLS_CERT=certs/server.crt
BEACON_TLS_KEY=certs/server.key
BEACON_ENCRYPTION_KEY=                 # Base64-encoded 32-byte key

ALLOWED_HOSTS=localhost,your-domain.com
CORS_ALLOWED_ORIGINS=http://localhost:3000
```

---

## 23. Database Schema

### 23.1 PostgreSQL (Server)

```
beacon_users              BeaconUser
beacon_recovery_keys      RecoveryKey
beacon_agents             Agent
beacon_collector_health   CollectorHealth
beacon_metrics            Metric
beacon_metric_config      MetricConfig
beacon_logs               LogEntry
beacon_audit_log          AuditLog (immutable)
beacon_server_health      ServerHealth
beacon_server_config      ServerConfig

# JWT blacklist (django-simplejwt)
token_blacklist_blacklistedtoken
token_blacklist_outstandingtoken
```

### 23.2 SQLite (Agent — 4 files)

```
config.db
  ├── config              (key, value, encrypted, updated_at)
  ├── agent_identity      (id=1, agent_id, hostname, created_at)
  └── encryption_keys     (id, key_data BLOB, created_at, active)

metrics.db
  └── metrics             (id, agent_id, metric_type, resolution,
                           timestamp, data, schema_version,
                           sequence_number, synced)

logs.db
  ├── logs                (id, agent_id, source, severity, message,
                           timestamp, schema_version, extra,
                           sequence_number, synced)
  └── audit_logs          (id, timestamp, action, resource, details)

queue.db
  ├── queue               (id, message_id UNIQUE, payload BLOB,
                           msg_type, state, retries,
                           created_at, updated_at, checksum)
  └── dead_letter         (id, message_id, payload BLOB,
                           msg_type, reason, archived_at)
```

---

## 24. Security Model

### 24.1 Security Layers

| Layer | Mechanism | Details |
|-------|-----------|---------|
| Transport | TLS 1.3 | rustls (agent) / Daphne (server) |
| Payload | AES-256-GCM | 96-bit nonce, authenticated encryption |
| Key derivation | Argon2id | t=3, m=64MB, p=4 (OWASP minimum) |
| Password storage | Argon2id | Custom Django hasher, same params |
| Session tokens | JWT HS256 | 30-min access, 7-day refresh, blacklisted on rotate |
| Session replay | JTI tracking | JWT blacklist table prevents token reuse |
| RBAC | viewer / administrator | Enforced at REST, WS, DB, and CLI layers |
| Audit | Immutable AuditLog | `save()`/`delete()` raise `ValueError` if `pk` exists |
| Brute force | Progressive lockout | 5→60s, 10→300s, 20→3600s |
| Login rate | 5/minute throttle | Applied to login + recovery endpoints |
| Recovery key | SHA-256 stored | Raw key never stored; invalidated on use |
| Log injection | Input sanitization | Null bytes stripped; max 8192 chars |
| PID reuse | Triple identity | `(pid, boot_id, start_time)` |
| Clock drift | UTC timestamps | Monotonic clocks for durations |
| Agent identity | Hardware SHA-256 | Salt-protected, stable across reboots |

### 24.2 Systemd Hardening (Agent Service)

```
NoNewPrivileges        = yes
ProtectSystem          = strict
ProtectHome            = yes
PrivateTmp             = yes
ProtectKernelTunables  = yes
ProtectControlGroups   = yes
CapabilityBoundingSet  = CAP_DAC_READ_SEARCH CAP_SYS_PTRACE
AmbientCapabilities    = CAP_DAC_READ_SEARCH
MemoryMax              = 256M
CPUQuota               = 25%
ReadWritePaths         = /var/lib/beacon /var/log/beacon
```

`CAP_DAC_READ_SEARCH` — allows reading system files (e.g. `/proc/`) regardless of filesystem permissions.  
`CAP_SYS_PTRACE` — allows inspecting other process memory for metrics.

---

## 25. Edge Cases & Failure Handling

### 25.1 Database Edge Cases

| Case | Handling |
|------|---------|
| Corrupted SQLite | `PRAGMA integrity_check` on startup; trigger restore from backup |
| Full disk | Collectors degrade gracefully; alert emitted; logging continues to queue |
| WAL corruption | WAL checkpointed and rebuilt from last clean state |
| Backup restore mismatch | Schema version validation rejects incompatible restores |
| Concurrent DB access | WAL mode allows concurrent reads while one writer active |

### 25.2 Authentication Edge Cases

| Case | Handling |
|------|---------|
| Brute force | Progressive backoff: 5→60s, 10→300s, 20→3600s lockout |
| Password reset abuse | Rate-limited to 5/minute; all attempts audited |
| Recovery key theft | Invalidated on first use; new key auto-issued |
| Session replay | JWT tokens have unique JTI; blacklisted after rotation |
| Expired access token | Refresh token used to obtain new access token silently |

### 25.3 Metrics Edge Cases

| Case | Handling |
|------|---------|
| Missing sensors | Collector marks status `Degraded`; null values emitted instead of crash |
| Invalid temperature | Out-of-range values (< -50°C or > 200°C) filtered and flagged |
| Process explosion | Collection capped at `max_processes` (default 512) |
| Collector crash | `HealthEngine` detects via absence of success events; marks `Failed`; independent Tokio task restarts |
| PID reuse | `(pid, boot_id, start_time)` triple prevents false attribution |

### 25.4 Queue Edge Cases

| Case | Handling |
|------|---------|
| Infinite retries | Hard cap `MAX_RETRIES = 5`; overflow enters DLQ |
| Duplicate delivery | `UNIQUE(message_id)` at DB level; `INSERT OR IGNORE` deduplicates |
| Message corruption | SHA-256 checksum recomputed on dequeue; mismatches → DLQ |
| DLQ overflow | Oldest DLQ entries archived (deleted) when `MAX_DEAD_LETTER = 10,000` reached |
| Queue pause | `QueueEngine::pause()` prevents dequeue without losing messages |
| Shutdown in-flight | `flush()` called on SIGINT; all `Processing` → `Pending` |

### 25.5 WebSocket Edge Cases

| Case | Handling |
|------|---------|
| Connection refused | Exponential backoff reconnect (1s → 60s) |
| Server close | Clean disconnect detection; immediate reconnect attempt |
| Slow consumers | Back-pressure via Redis channel capacity (`capacity: 1500`) |
| Client floods | Rate limiting per connection; offending connections closed |
| Reconnect storm | Exponential backoff prevents thundering herd |
| TLS cert error | Logged as error; reconnect with backoff |

### 25.6 System-level Edge Cases

| Case | Handling |
|------|---------|
| Clock change / NTP | All timestamps UTC; monotonic clocks for durations |
| Network loss | Offline buffering activates automatically; collectors continue |
| Power loss | SQLite WAL ensures committed transactions survive; Recovery Engine runs on restart |
| Service crash | systemd `Restart=always` with `RestartSec=5s`; 5 attempts per 60 seconds |
| Kernel upgrade | Agent service survives restart; full state in SQLite |
| Log injection | Null bytes + carriage returns stripped; message max 8192 chars |
| Log storms | Rate limiting at server; excess records dropped with counter incremented |

---

## 26. Deployment Guide

### 26.1 Server (Docker Compose)

```bash
cd server

# 1. Configure environment
cp .env.example .env
# Edit .env: set SECRET_KEY, DB_PASSWORD, ALLOWED_HOSTS

# 2. Generate TLS certificates (self-signed for dev)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/server.key \
  -out certs/server.crt -days 365 -nodes -subj "/CN=beacon-server"

# 3. Start services
docker compose up -d

# 4. Run database migrations
docker compose exec server python manage.py migrate

# 5. Initialize (creates admin user + recovery key)
docker compose exec server python manage.py beacon_init

# 6. Collect static files
docker compose exec server python manage.py collectstatic --noinput
```

### 26.2 Agent (Bare Metal)

```bash
# 1. Install Rust (if not present)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Build agent
cd agent
cargo build --release

# 3. Install binary
sudo cp target/release/beacon-agent /usr/local/bin/
sudo chmod 755 /usr/local/bin/beacon-agent

# 4. Create directories
sudo mkdir -p /etc/beacon /var/lib/beacon/agent /var/log/beacon

# 5. Initialize configuration (requires sudo/root)
sudo beacon-agent init --config /etc/beacon/agent.toml
# Enter: server address, username, collection interval

# 6. Run now (foreground)
sudo beacon-agent start --config /etc/beacon/agent.toml

# 7. Start on boot via cron (@reboot)
sudo beacon-agent cron install
# Remove: sudo beacon-agent cron remove
```

### 26.3 Server Initialization Command

```
python manage.py beacon_init
```

Prompts for:
- Administrator username (default: `admin`)
- Administrator password (min 12 characters)

Creates:
- Administrator `BeaconUser` record
- `RecoveryKey` (displayed once — save immediately)
- Default `ServerConfig` entries (retention policy, timeouts)

### 26.4 Production Checklist

- [ ] Set a strong, unique `SECRET_KEY` (50+ random chars)
- [ ] Set `DEBUG=false`
- [ ] Configure `ALLOWED_HOSTS` and `CORS_ALLOWED_ORIGINS`
- [ ] Use a strong PostgreSQL password
- [ ] Enable TLS on the Daphne server (or terminate at nginx/caddy)
- [ ] Set `verify_cert = true` in agent config
- [ ] Store recovery key in a secure secrets manager
- [ ] Set up periodic `beacon-agent db vacuum` via cron
- [ ] Configure log rotation for `/var/log/beacon/`
- [ ] Monitor `/health/` endpoint
- [ ] Back up PostgreSQL regularly
- [ ] Set `BEACON_ENCRYPTION_KEY` for at-rest encryption

---

## 27. Dependencies

### 27.1 Python (Server)

| Package | Version | Purpose |
|---------|---------|---------|
| Django | 5.0.6 | Web framework |
| djangorestframework | 3.15.2 | REST API |
| djangorestframework-simplejwt | 5.3.1 | JWT auth |
| channels | 4.1.0 | WebSocket / ASGI |
| channels-redis | 4.2.0 | Redis channel layer |
| daphne | 4.1.2 | ASGI server |
| psycopg2-binary | 2.9.9 | PostgreSQL adapter |
| django-cors-headers | 4.4.0 | CORS middleware |
| argon2-cffi | 23.1.0 | Argon2id password hashing |
| cryptography | 42.0.8 | Low-level cryptography |
| redis | 5.0.7 | Redis client |
| django-filter | 24.2 | Query filtering |
| python-dotenv | 1.0.1 | Environment variable loading |
| msgpack | 1.0.8 | Binary serialization |

### 27.2 Rust (Agent)

| Crate | Version | Purpose |
|-------|---------|---------|
| tokio | 1.x | Async runtime |
| tokio-tungstenite | 0.21 | Async WebSocket |
| futures-util | 0.3 | Async utilities |
| serde | 1.x | Serialization framework |
| serde_json | 1.x | JSON serialization |
| aes-gcm | 0.10 | AES-256-GCM encryption |
| argon2 | 0.5 | Argon2id key derivation |
| sha2 | 0.10 | SHA-256 hashing |
| rand | 0.8 | Cryptographic randomness |
| base64 | 0.22 | Base64 encoding |
| hex | 0.4 | Hex encoding |
| rustls | 0.22 | TLS 1.3 implementation |
| rustls-native-certs | 0.7 | System certificate loading |
| webpki-roots | 0.26 | WebPKI root certificates |
| rusqlite | 0.31 (bundled) | SQLite storage |
| sysinfo | 0.30 | System metrics collection |
| clap | 4.x | CLI argument parsing |
| toml | 0.8 | Config file parsing |
| tracing | 0.1 | Structured logging |
| tracing-subscriber | 0.3 | Log output |
| uuid | 1.x | UUID generation |
| chrono | 0.4 | Date/time handling |
| anyhow | 1.x | Error handling |
| ratatui | 0.26 | Terminal UI framework |
| crossterm | 0.27 | Terminal manipulation |
| url | 2.x | URL parsing |

---

---

## 28. Internal API Reference (Rust Agent)

### 28.1 StorageManager API

All methods are `async`. The manager wraps four `Arc<Mutex<Connection>>` handles — one per database — so it is cheap to clone and share across tasks.

```rust
// Construction
StorageManager::new(dir: &str) -> Result<Self>

// ── Metrics ───────────────────────────────────────────────────
store_metric(agent_id, metric_type, data: &str) -> Result<()>
get_unsynced_metrics(limit: usize)              -> Result<Vec<MetricRow>>
mark_metrics_synced(ids: &[i64])                -> Result<()>
prune_metrics(raw_hours, rollup_1m_days, rollup_1h_days) -> Result<usize>

// ── Logs ──────────────────────────────────────────────────────
store_log(agent_id, source, severity, message, extra) -> Result<()>
get_unsynced_logs(limit: usize)               -> Result<Vec<LogRow>>
mark_logs_synced(ids: &[i64])                 -> Result<()>
print_recent_logs(n: usize)                   -> Result<()>
clear_logs()                                  -> Result<()>

// ── Audit ─────────────────────────────────────────────────────
write_audit(action, resource, details)        -> Result<()>
print_audit_logs(n: usize)                    -> Result<()>

// ── Queue ─────────────────────────────────────────────────────
queue_db() -> Arc<Mutex<Connection>>          // Direct handle for QueueEngine

// ── Config ────────────────────────────────────────────────────
get_config(key: &str)                         -> Result<Option<String>>
set_config(key, value)                        -> Result<()>
get_agent_identity()                          -> Result<Option<(String, String)>>
store_agent_identity(agent_id, hostname)      -> Result<()>
get_active_encryption_key()                   -> Result<Option<Vec<u8>>>
store_encryption_key(key_data: &[u8])         -> Result<()>

// ── Maintenance ───────────────────────────────────────────────
vacuum()                                      -> Result<()>
verify()                                      -> Result<()>
backup(dest: &str)                            -> Result<()>
restore(src: &str)                            -> Result<()>
print_status()                                -> Result<()>
```

**MetricRow fields:** `id, agent_id, metric_type, resolution, timestamp, data, schema_version, sequence_number`  
**LogRow fields:** `id, agent_id, source, severity, message, timestamp, schema_version, extra, sequence_number`

---

### 28.2 QueueEngine API

```rust
QueueEngine::new(storage: StorageManager) -> Result<Self>

// Producer
enqueue(payload: Vec<u8>, msg_type: &str) -> Result<String>  // returns message_id

// Consumer
dequeue_batch(limit: usize)              -> Result<Vec<QueueMessage>>
ack(id: i64)                             -> Result<()>     // mark Sent
nack(id: i64, message_id: &str)          -> Result<()>     // increment retries or → DLQ

// Control
pause()                                  // stop dequeue (sync)
resume()                                 // resume dequeue (sync)
clear()                                  -> Result<()>
retry_failed()                           -> Result<usize>  // Failed → Pending
flush()                                  -> Result<()>     // Processing → Pending on shutdown

// Maintenance
status()                                 -> Result<QueueStatus>
prune_sent(hours: i64)                   -> Result<usize>
```

**QueueMessage fields:** `id, message_id, payload: Vec<u8>, msg_type, state, retries, created_at, checksum`

**QueueStatus fields:** `pending, processing, sent, failed, dead_letter: i64, paused: bool`

---

### 28.3 EncryptionEngine API

```rust
EncryptionEngine::new(config, storage) -> Result<Self>

// Encryption / Decryption
encrypt(plaintext: &[u8])               -> Result<EncryptedPayload>
decrypt(payload: &EncryptedPayload)     -> Result<Vec<u8>>

// Key Management
rotate_key()                            -> Result<()>   // atomic, rollback on failure
generate_key()                          -> Vec<u8>      // static, 32 random bytes
derive_key_from_password(pw, salt)      -> Result<Vec<u8>>  // Argon2id

is_enabled()                            -> bool
```

**EncryptedPayload:** A struct wrapping `data: Vec<u8>` in the format `[nonce:12] || [ciphertext]`.

---

### 28.4 HealthEngine API

```rust
HealthEngine::new() -> Self

// Status
set_status(status: AgentStatus)                    // fire-and-forget via tokio::spawn
set_status_async(status: AgentStatus)              -> (async)
get_status()                                       -> AgentStatus

// Collector tracking
record_collector_success(name: &str)               -> (async)
record_collector_failure(name: &str, error: &str)  -> (async)
disable_collector(name: &str)                      -> (async)

// Reporting
snapshot()                                         -> HealthSnapshot
to_ws_payload()                                    -> serde_json::Value
```

**CollectorHealthRecord methods:**
- `record_success()` — sets `status=Healthy`, decrements `failure_count`
- `record_failure(error)` — increments `failure_count`; `≥5` → `Failed`, else `Degraded`
- `set_disabled()` — sets `status=Disabled`

---

### 28.5 IdentityEngine API

```rust
// One-time call on startup. Returns stored identity or derives + persists a new one.
IdentityEngine::new(storage: &StorageManager) -> Result<AgentIdentity>
```

**AgentIdentity fields:** `agent_id: String, hostname: String, os: String, arch: String`

---

### 28.6 WebSocketTransport API

```rust
WebSocketTransport::new(config, identity, queue, encryption) -> Self

// Runs forever — reconnects with exponential backoff.
// Returns Err only on unrecoverable failure (e.g. invalid URL).
run() -> Result<()>
```

Internally manages three concurrent async sub-loops per connection:
- `heartbeat_loop` — sends ping every `HEARTBEAT_INTERVAL` (15s)
- `flush_loop` — drains queue in batches of `FLUSH_BATCH_SIZE` (50)
- `read_loop` — processes server-to-agent messages

---

### 28.7 Collector Interface

Every collector exposes a single public async function:

```rust
pub async fn run(
    identity:  AgentIdentity,
    queue:     QueueEngine,
    storage:   StorageManager,
    interval:  Duration,
    // Process collector also takes:
    max_processes: usize,
) // → runs forever, never returns
```

Started via `collectors::start_all()` which returns `Vec<JoinHandle<()>>`. Each handle can be `.abort()`-ed independently on shutdown.

---

### 28.8 TUI AppState

```rust
pub struct AppState {
    current_view:   View,           // Active tab
    tab_index:      usize,          // 0–6
    agent_id:       String,
    hostname:       String,
    server_addr:    String,
    status:         String,         // ONLINE | DEGRADED | OFFLINE_BUFFERING | ...
    uptime_secs:    u64,
    logs:           Vec<LogEntry>,  // Ring buffer, max 1000 entries
    log_state:      ListState,      // Ratatui scroll state
    metrics:        Vec<MetricSample>,
    search_query:   String,
    searching:      bool,
    quit:           bool,
    cpu_history:    Vec<f64>,       // 60-sample ring buffer (0.0–100.0)
    ram_history:    Vec<f64>,       // 60-sample ring buffer
    net_rx_history: Vec<f64>,
    net_tx_history: Vec<f64>,
    queue_status:   String,
    collectors:     Vec<(String, String)>,  // (name, CollectorStatus)
}
```

`AppState` is wrapped in `Arc<RwLock<AppState>>` for sharing between the event loop and WebSocket push tasks.

---

## 29. Django Middleware Stack

Middleware executes in order on request, reverse order on response:

```
Request →
  SecurityMiddleware          (HTTPS redirect, HSTS, X-Content-Type-Options)
  CorsMiddleware              (CORS headers for cross-origin requests)
  SessionMiddleware           (session cookie handling)
  CommonMiddleware            (URL normalization, ETags)
  CsrfViewMiddleware          (CSRF token validation)
  AuthenticationMiddleware    (sets request.user from session)
  MessageMiddleware           (flash message framework)
  XFrameOptionsMiddleware     (clickjacking protection)
  AuditMiddleware             (POST/PUT/PATCH/DELETE audit logging)
← Response
```

**AuditMiddleware detail:**
- Fires only after response is generated (`response.status_code < 500`)
- Skips: `GET`, `HEAD`, `OPTIONS`, `HEAD` methods
- Skips paths: `/health/`, `/api/v1/auth/refresh/`
- Derives `resource` from URL path segment at index 2 (e.g. `/api/v1/agents/` → `agents`)
- Always catches exceptions internally — a failed audit write never breaks the response

---

## 30. Server Logging Configuration

```python
LOGGING = {
    "formatters": {
        "verbose": "{levelname} {asctime} {module} {process:d} {thread:d} {message}"
    },
    "handlers": {
        "console": StreamHandler(verbose),
        "file":    RotatingFileHandler(
            filename    = "logs/beacon.log",
            maxBytes    = 10 * 1024 * 1024,  # 10 MB per file
            backupCount = 5,                  # 5 rotated files kept
        )
    },
    "loggers": {
        "beacon": level=DEBUG  → console + file,
        "django": level=WARNING → console only,
    }
}
```

Agent logging uses `tracing` with JSON output via `tracing-subscriber`. Log level is set via `--log-level` CLI flag or `RUST_LOG` environment variable.

---

## 31. Pagination

REST API uses **CursorPagination** with a default page size of 100:

```python
DEFAULT_PAGINATION_CLASS = "rest_framework.pagination.CursorPagination"
PAGE_SIZE                = 100
```

Cursor pagination is chosen over offset pagination because:
- Consistent performance on large datasets (no `OFFSET` scans)
- Correct handling of concurrent inserts (no record skipping or duplication)
- Works naturally with timestamp-ordered telemetry data

Clients receive `next` and `previous` cursor URLs in paginated responses.

---

## 32. Agent Authentication Against Server

### 32.1 Agent Secret Mechanism

Each agent maintains a `secret_hash` in the `Agent` model:

```python
def set_secret(self, raw_secret: str):
    self.secret_hash = hashlib.sha256(raw_secret.encode()).hexdigest()

def verify_secret(self, raw_secret: str) -> bool:
    return self.secret_hash == hashlib.sha256(raw_secret.encode()).hexdigest()
```

For HTTP REST calls, the agent passes:
```
X-Agent-ID:     sha256:a3f1...
X-Agent-Secret: <raw-secret>
```

The `IsAgentAuthenticated` permission class validates both headers on every request.

### 32.2 WebSocket Agent Registration Flow

```
Agent                          Server
  │                               │
  │──── TCP + TLS handshake ─────►│
  │                               │  TLS 1.3 established
  │◄─── 101 Switching Protocols ──│
  │                               │
  │──── {"type":"register", ──────►│  update_or_create Agent record
  │      "payload": {...}}         │  join channel group agent_<id>
  │                               │
  │◄─── {"type":"registered"} ────│
  │                               │
  │──── {"type":"heartbeat"} ─────►│  touch() → last_seen = now()
  │◄─── {"type":"heartbeat_ack"} ──│
  │                               │
  │──── {"type":"metrics",  ──────►│  bulk_create() + broadcast
  │      "payload": [...]}         │
  │◄─── {"type":"metrics_ack"} ────│
  │                               │
  │  [connection lost]            │
  │                               │  mark_agent_offline()
  │  [reconnect with backoff]     │
  │──── TCP + TLS handshake ─────►│
  ...
```

---

## 33. Data Flow: Metric Collection to Server Storage

End-to-end flow for a single CPU metric sample:

```
1. cpu::run() wakes after interval
   └─ sysinfo::System::refresh_cpu_all()
   └─ /proc/stat, /proc/loadavg, /sys/class/thermal/
   └─ Build TelemetryPayload { agent_id, metric_type:"cpu", timestamp, data: {...} }

2. enqueue_telemetry(payload, queue, storage)
   ├─ storage.store_metric(agent_id, "cpu", json_data)
   │     → INSERT INTO metrics (synced=0) in metrics.db
   └─ payload.to_json_bytes()
      └─ queue.enqueue(bytes, "metrics")
            → SHA-256 checksum
            → INSERT INTO queue (state=Pending, message_id=UUID) in queue.db

3. transport::flush_loop() wakes (500ms poll or immediate if queue non-empty)
   └─ queue.dequeue_batch(50)
         → SELECT ... WHERE state='Pending' LIMIT 50
         → Validate checksum → UPDATE state='Processing'
   └─ For each message:
         enc.decrypt(payload)    ← AES-256-GCM decrypt local encryption
         Wrap in envelope JSON
         writer.send(Message::Text(envelope))
         ├─ On success: queue.ack(id) → UPDATE state='Sent'
         └─ On error:   queue.nack(id) → retries++ or → DLQ

4. Server AgentIngestConsumer.handle_metrics()
   └─ save_metrics() [@database_sync_to_async]
         → Metric.objects.bulk_create(objects, batch_size=500)
   └─ channel_layer.group_send("metrics_<agent_id>", metric.update)

5. ClientSubscribeConsumer.metric_update()
   └─ Forwards to all subscribed WebSocket clients
         → {"channel": "metrics", "data": {...}}
```

---

## 34. Key Rotation — Step-by-Step

Full atomic key rotation process with rollback at each step:

```
rotate_key():
  Step 1: Generate new_key = OsRng::fill_bytes(32)
  Step 2: old_key = current in-memory key (read lock)

  Step 3: reencrypt_queue(old_key, new_key)
    ├─ SELECT id, payload FROM queue WHERE state != 'Sent'
    ├─ For each row:
    │    plaintext   = decrypt_raw(payload, old_key)  # AES-256-GCM
    │    new_payload = encrypt_raw(plaintext, new_key)
    │    UPDATE queue SET payload = new_payload WHERE id = ?
    └─ Returns count of re-encrypted messages

  Step 4: Verify round-trip with new_key
    ├─ test_vector = b"beacon-key-rotation-verify"
    ├─ ct  = Aes256Gcm::new(new_key).encrypt(random_nonce, test_vector)
    └─ pt  = Aes256Gcm::new(new_key).decrypt(nonce, ct)
         → assert pt == test_vector

  Step 5 (COMMIT — only if all above succeeded):
    ├─ storage.store_encryption_key(new_key)
    │    → UPDATE encryption_keys SET active=0
    │    → INSERT encryption_keys (key_data=new_key, active=1)
    └─ *self.key.write() = Some(new_key)

  On any failure before Step 5:
    → Error returned, old_key remains active, DB unchanged
```

---

## 35. Recovery Key — Full Lifecycle

```
Generation (POST /api/v1/auth/recovery-key/generate/):
  raw_key = secrets.token_hex(8)              # 8 bytes = 16 hex chars
  groups  = [raw[0:4], raw[4:8], raw[8:12], raw[12:16]]
  display = "-".join(groups).upper()          # "A3F1-B2E4-C5D6-E7F8"
  clean   = display.replace("-","").upper()   # "A3F1B2E4C5D6E7F8"
  stored  = SHA-256(clean.encode("utf-8"))

  RecoveryKey.objects.filter(user=user).delete()   # delete old key
  RecoveryKey.objects.create(user=user, key_hash=stored)
  Response: {"recovery_key": display, "warning": "..."}

Validation (POST /api/v1/auth/password/recover/):
  input_clean = input_key.replace("-","").upper()
  computed    = SHA-256(input_clean.encode())
  valid       = (computed == stored_hash) and not invalidated

Consumption (on successful recovery):
  rk.used_at     = timezone.now()
  rk.invalidated = True
  rk.save()
  new_raw    = RecoveryKey.generate()
  new_stored = RecoveryKey.hash_key(new_raw)
  RecoveryKey.objects.create(user=user, key_hash=new_stored)
  Response includes new_recovery_key
```

---

## 36. Concurrent Access Patterns

### 36.1 Agent (Rust) — Shared State

All engines that need to be shared across Tokio tasks are wrapped in `Arc<Mutex<T>>` (blocking) or `Arc<RwLock<T>>` (async):

| Resource | Wrapper | Rationale |
|----------|---------|-----------|
| `StorageManager` inner connections | `Arc<Mutex<Connection>>` | SQLite is single-writer; mutex serializes writes |
| `QueueEngine.paused` | `Arc<RwLock<bool>>` | Frequent reads, rare writes |
| `EncryptionEngine.key` | `Arc<RwLock<Option<Vec<u8>>>>` | Key rotations are rare |
| `HealthEngine.status` | `Arc<RwLock<AgentStatus>>` | Read from TUI, written by collectors |
| `HealthEngine.collectors` | `Arc<RwLock<HashMap<...>>>` | Multiple collector writers |
| `AppState` (TUI) | `Arc<RwLock<AppState>>` | Event loop reads, WS push writes |

### 36.2 Server (Django) — Database Concurrency

Django's ORM uses connection pooling via psycopg2. PostgreSQL handles concurrent connections via MVCC (Multi-Version Concurrency Control):
- Metric ingest uses `bulk_create()` — a single INSERT statement per batch (up to 500 rows)
- `update_or_create()` on Agent model uses `SELECT FOR UPDATE` to prevent race conditions on concurrent registrations
- AuditLog immutability is enforced at the Python model level, not at the DB level (no DB trigger needed)

### 36.3 WebSocket — Channel Layer

Redis channel layer (`channels_redis`) handles fan-out to multiple subscribers:

```
Agent pushes metrics → server saves → group_send("metrics_<id>", event)
Redis publishes event to all subscribers of that group
Each ClientSubscribeConsumer instance receives the event and forwards to its WebSocket
```

Channel layer capacity: 1500 messages, expiry 10 seconds. Messages older than 10 seconds are dropped (prefer freshness over completeness for live telemetry).

---

## 37. Build Configuration

### 37.1 Rust Release Profile

```toml
[profile.release]
opt-level     = 3      # Maximum optimization
lto           = true   # Link-time optimization across all crates
codegen-units = 1      # Single codegen unit for maximum LTO effectiveness
strip         = true   # Strip debug symbols from binary
```

Expected release binary size: ~8–12 MB (stripped, statically linked SQLite via `rusqlite/bundled`).

### 37.2 Cargo Features

Key feature flags used:

| Crate | Feature | Purpose |
|-------|---------|---------|
| `tokio` | `full` | Enable all Tokio features (io, net, time, sync, macros) |
| `tokio-tungstenite` | `rustls-tls-native-roots` | TLS via rustls with system cert store |
| `serde` | `derive` | Derive macros for `Serialize`/`Deserialize` |
| `rusqlite` | `bundled` | Statically link libsqlite3 (no system dependency) |
| `rusqlite` | `backup` | Enable SQLite backup API |
| `clap` | `derive` | Derive macros for CLI argument parsing |
| `clap` | `env` | Allow CLI args to be set via environment variables |
| `uuid` | `v4` | Random UUID generation |
| `chrono` | `serde` | DateTime serialization support |
| `tracing-subscriber` | `env-filter` | `RUST_LOG`-style log filtering |
| `tracing-subscriber` | `json` | JSON-formatted log output |
| `reqwest` | `json`, `rustls-tls` | JSON bodies + rustls TLS (no openssl dependency) |

### 37.3 Cross-Compilation Targets

The agent can be cross-compiled for ARM targets:

```bash
# ARM 64-bit (Raspberry Pi 4, AWS Graviton)
rustup target add aarch64-unknown-linux-gnu
cargo build --release --target aarch64-unknown-linux-gnu

# ARM 32-bit (Raspberry Pi 3 and earlier)
rustup target add armv7-unknown-linux-gnueabihf
cargo build --release --target armv7-unknown-linux-gnueabihf
```

---

## 38. Docker Infrastructure

### 38.1 Server Dockerfile

```dockerfile
FROM python:3.12-slim
RUN apt-get install gcc libpq-dev         # PostgreSQL C adapter
COPY requirements.txt → pip install
COPY . .
EXPOSE 8000
CMD daphne -b 0.0.0.0 -p 8000 beacon_server.asgi:application
```

### 38.2 Docker Compose Services

| Service | Image | Port | Health Check |
|---------|-------|------|-------------|
| `db` | postgres:16-alpine | internal | `pg_isready -U beacon` every 5s |
| `redis` | redis:7-alpine | internal | `redis-cli ping` every 5s |
| `server` | built from `Dockerfile` | 8000:8000 | depends_on: db healthy, redis healthy |

**Startup sequence:**
1. `db` + `redis` start and reach healthy state
2. `server` starts: `migrate --noinput` → `collectstatic --noinput` → `daphne`

**Volumes:**
- `pgdata` — PostgreSQL data directory (persistent)
- `redisdata` — Redis RDB snapshot (persistent)
- `static_files` — Django collected statics
- `media_files` — Django media uploads
- `./certs:/app/certs:ro` — TLS certificates (read-only mount)

---

## 39. Systemd Service Details

### 39.1 Service Configuration

```ini
[Unit]
After=network-online.target          # Wait for full network, not just interface-up
StartLimitIntervalSec=60             # Restart limit window
StartLimitBurst=5                    # Max 5 restarts per 60 seconds

[Service]
Type=simple                          # Process runs in foreground
Restart=always                       # Always restart on any exit
RestartSec=5s                        # Wait 5s before restart
TimeoutStopSec=30                    # Allow 30s for graceful shutdown

ExecReload=/bin/kill -HUP $MAINPID   # SIGHUP triggers config reload
```

### 39.2 Graceful Shutdown

The agent handles `SIGINT` (Ctrl+C) via `tokio::signal::ctrl_c()`:

```rust
tokio::select! {
    res = transport.run()            => { error!("Transport exited: {:?}", res); }
    _ = tokio::signal::ctrl_c()     => {
        health.set_status(AgentStatus::ShuttingDown);
        queue.flush().await?;        // Reset Processing → Pending
        for handle in collector_handles { handle.abort(); }
    }
}
```

**Shutdown sequence:**
1. Receive `SIGINT` / `SIGTERM`
2. Set agent status to `SHUTTING_DOWN`
3. `queue.flush()` — move all `Processing` messages back to `Pending`
4. Abort all collector task handles
5. Transport loop exits naturally (WebSocket closes)
6. SQLite WAL checkpoint runs on Connection drop
7. Process exits 0

This ensures no in-flight messages are lost across restarts.

---

## 40. Non-Functional Requirements — Verified

| Requirement | Specification | Implementation |
|-------------|--------------|----------------|
| Language (Agent) | Rust only — no C bindings in core | ✓ Pure Rust; libsqlite3 bundled |
| Runtime | Tokio async, event-driven | ✓ `#[tokio::main]` throughout |
| Architecture | x86_64, ARM, Raspberry Pi | ✓ Cross-compile targets defined |
| Service model | systemd auto-start, crash recovery | ✓ `Restart=always`, `RestartSec=5s` |
| Scalability | 1–1000+ agents per server | ✓ `BEACON_MAX_AGENTS=1000` |
| Offline operation | Full local ops without server | ✓ SQLite WAL + queue buffering |
| Security | Secure by default, no insecure defaults | ✓ TLS required, encryption on by default |
| Graceful shutdown | In-flight transmission completion | ✓ `queue.flush()` on SIGINT |
| Observability | Production-grade internal logging | ✓ `tracing` with JSON output + rotating file |
| Full parity | Remote management = local CLI | ✓ Every CLI op has REST equivalent |
| Auditability | Every action traceable | ✓ `AuditLog` immutable + auto middleware |
| No remote execution | Read-only telemetry | ✓ No command execution endpoints |
| No config management | Observability only | ✓ No Ansible/Chef/Salt integration |

---

## 41. Known Limitations and Future Work

### 41.1 Current Limitations

| Area | Limitation | Planned Fix |
|------|-----------|-------------|
| Kubernetes | Collector implemented as stub | Phase 5: full pod/deployment/event collection |
| Rollup | No automatic 1s→1min→1h rollup job | Phase 6: Celery beat rollup task |
| Agent mTLS | Agent authenticates via secret, not client cert | Future: mutual TLS with per-agent certificates |
| Multi-server | Single server instance | Phase 8: clustering + leader election |
| Alerting | No built-in alert rules | Future: threshold-based alert engine |
| Dashboards | TUI only | Future: web dashboard (React) |
| Search | Simple substring search on logs | Future: full-text search (PostgreSQL `tsvector`) |
| Metrics compression | Raw JSON storage | Future: columnar compression (TimescaleDB) |

### 41.2 Roadmap

| Phase | Milestone | Status |
|-------|-----------|--------|
| 1 | Agent Core — Identity, auth, storage, WebSocket | ✓ Complete |
| 2 | Telemetry Collection — CPU, RAM, disk, network, process | ✓ Complete |
| 3 | Log Collection — Journald, syslog, kernel logs | ✓ Complete |
| 4 | Container Monitoring — Docker and containerd | ✓ Stub (docker ps) |
| 5 | Kubernetes Monitoring — Pods, deployments, events, cluster | ○ Planned |
| 6 | Server Platform — Full storage, indexing, aggregation, rollups | ✓ Complete |
| 7 | TUI Dashboard — Real-time observability | ✓ Complete |
| 8 | Fleet Scaling — Multi-agent clustering | ○ Planned |

---

## 42. Quick Reference

### 42.1 HTTP Status Codes Used

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET, POST returning data |
| 201 | Created | Successful resource creation |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation errors, invalid input |
| 401 | Unauthorized | Missing or invalid JWT |
| 403 | Forbidden | Authenticated but insufficient role |
| 404 | Not Found | Resource does not exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unhandled exception |

### 42.2 All Enum Values

**AgentStatus:** `BOOTING` | `INITIALIZING` | `ONLINE` | `DEGRADED` | `OFFLINE_BUFFERING` | `RECOVERING` | `FAILED` | `SHUTTING_DOWN` | `OFFLINE`

**CollectorStatus:** `Healthy` | `Degraded` | `Failed` | `Disabled`

**Role:** `viewer` | `administrator`

**MetricType:** `cpu` | `ram` | `storage` | `network` | `process` | `systemd` | `docker` | `kubernetes` | `kernel` | `temperature` | `power`

**MetricResolution:** `raw` | `1min` | `1hour`

**LogSeverity:** `Trace` | `Debug` | `Info` | `Warning` | `Error` | `Critical`

**LogSource:** `systemd-journald` | `syslog` | `kernel` | `docker` | `kubernetes` | `internal`

**MessageState (Queue):** `Pending` | `Processing` | `Sent` | `Failed` | `DeadLetter`

### 42.3 Critical Constants Summary

| Constant | Value | Location |
|----------|-------|----------|
| JWT access lifetime | 30 minutes | `SIMPLE_JWT.ACCESS_TOKEN_LIFETIME` |
| JWT refresh lifetime | 7 days | `SIMPLE_JWT.REFRESH_TOKEN_LIFETIME` |
| Agent stale timeout | 60 seconds | `BEACON_AGENT_HEARTBEAT_TIMEOUT` |
| Login throttle | 5/minute | `LoginThrottle.rate` |
| Anonymous throttle | 20/minute | `DEFAULT_THROTTLE_RATES.anon` |
| User throttle | 1000/minute | `DEFAULT_THROTTLE_RATES.user` |
| Argon2id t_cost | 3 iterations | `Argon2idHasher.time_cost` |
| Argon2id m_cost | 65536 KB (64 MB) | `Argon2idHasher.memory_cost` |
| Argon2id parallelism | 4 | `Argon2idHasher.parallelism` |
| Heartbeat interval | 15 seconds | `HEARTBEAT_INTERVAL` |
| Reconnect max backoff | 60 seconds | `RECONNECT_MAX_DELAY` |
| Flush batch size | 50 messages | `FLUSH_BATCH_SIZE` |
| Queue max retries | 5 | `MAX_RETRIES` |
| Dead letter max | 10,000 entries | `MAX_DEAD_LETTER` |
| Dequeue batch size | 100 | `BATCH_SIZE` |
| Log message max | 8,192 bytes | Log ingest sanitization |
| Max processes tracked | 512 | `CollectorConfig.max_processes` |
| AES nonce size | 12 bytes | `NONCE_SIZE` |
| AES key size | 32 bytes (256-bit) | `KEY_SIZE` |
| Recovery key entropy | 64 bits | `secrets.token_hex(8)` |
| Identity salt | 256 bits | `rand::thread_rng().gen::<[u8; 32]>()` |
| Bulk create batch | 500 rows | `bulk_create(batch_size=500)` |
| Log file max size | 10 MB | `RotatingFileHandler.maxBytes` |
| Log file backups | 5 | `RotatingFileHandler.backupCount` |
| Max agents (server) | 1,000 | `BEACON_MAX_AGENTS` |
| WS channel capacity | 1,500 | `CHANNEL_LAYERS.capacity` |
| WS channel expiry | 10 seconds | `CHANNEL_LAYERS.expiry` |
| Page size (API) | 100 | `REST_FRAMEWORK.PAGE_SIZE` |
| Raw retention | 24 hours | Prune cutoff |
| 1min rollup retention | 30 days | Prune cutoff |
| 1hour rollup retention | 365 days | Prune cutoff |
| Agent memory limit | 256 MB | `MemoryMax` (systemd) |
| Agent CPU quota | 25% | `CPUQuota` (systemd) |
| Open file limit | 65,536 | `LimitNOFILE` (systemd) |
| Lockout threshold 1 | 5 failures → 60s | `BeaconUser.record_failed_login` |
| Lockout threshold 2 | 10 failures → 300s | `BeaconUser.record_failed_login` |
| Lockout threshold 3 | 20 failures → 3600s | `BeaconUser.record_failed_login` |

---

*Beacon Technical Reference v1.0 — Complete — Generated from source*
