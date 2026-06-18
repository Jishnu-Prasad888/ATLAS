# Beacon Server API Reference

**Base URL:** `{host}/api/v1`
**Authentication:** JWT Bearer

## Rate Limits

| Endpoint Type          | Limit    |
| ---------------------- | -------- |
| Anonymous requests     | 20/min   |
| Authenticated requests | 1000/min |
| Login endpoint         | 5/min    |

---

# Authentication

**Base Path:** `/api/v1/auth/`

| Method | Endpoint                       | Auth             | Request                                    | Response                                                           |
| ------ | ------------------------------ | ---------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| POST   | `/auth/login/`                 | None (5/min)     | `{ username, password }`                   | `{ access, refresh }`                                              |
| POST   | `/auth/logout/`                | IsAuthenticated  | `{ refresh }`                              | `{ detail }`                                                       |
| POST   | `/auth/refresh/`               | None             | `{ refresh }`                              | `{ access, refresh }` (rotated)                                    |
| GET    | `/auth/whoami/`                | IsAuthenticated  | —                                          | `{ id, username, email, role, is_active, created_at, last_login }` |
| POST   | `/auth/password/change/`       | IsAuthenticated  | `{ old_password, new_password }`           | `{ detail }`                                                       |
| POST   | `/auth/password/recover/`      | AllowAny (5/min) | `{ username, recovery_key, new_password }` | `{ detail, new_recovery_key }`                                     |
| POST   | `/auth/recovery-key/generate/` | IsAuthenticated  | `{}`                                       | `{ recovery_key, warning }`                                        |

### JWT Configuration

| Setting                | Value                             |
| ---------------------- | --------------------------------- |
| Access Token Lifetime  | 30 minutes                        |
| Refresh Token Lifetime | 7 days                            |
| Rotation               | Enabled                           |
| Blacklisting           | Refresh tokens blacklisted on use |
| Algorithm              | HS256                             |

---

# Users

**Base Path:** `/api/v1/users/`
**Authorization:** `IsAdministrator`

| Method | Endpoint               | Request                                    | Response         |
| ------ | ---------------------- | ------------------------------------------ | ---------------- |
| GET    | `/users/`              | `?search=`                                 | `[User]`         |
| POST   | `/users/`              | `{ username, email?, password, role? }`    | `User` (201)     |
| GET    | `/users/<pk>/`         | —                                          | `User`           |
| PATCH  | `/users/<pk>/`         | `{ username?, email?, role?, is_active? }` | `User`           |
| DELETE | `/users/<pk>/`         | —                                          | `204 No Content` |
| POST   | `/users/<pk>/role/`    | `{ role }`                                 | `User`           |
| POST   | `/users/<pk>/enable/`  | —                                          | `User`           |
| POST   | `/users/<pk>/disable/` | —                                          | `User`           |

---

# Agents

**Base Path:** `/api/v1/agents/`

| Method | Endpoint                                | Auth              | Request                                                                          |
| ------ | --------------------------------------- | ----------------- | -------------------------------------------------------------------------------- |
| GET    | `/agents/`                              | IsViewer          | `?tag=&status=`                                                                  |
| POST   | `/agents/register/`                     | None              | `{ agent_id, hostname, os?, arch?, version?, tags?, metadata?, secret? }`        |
| GET    | `/agents/<agent_id>/`                   | IsAdminOrReadOnly | —                                                                                |
| DELETE | `/agents/<agent_id>/`                   | IsAdminOrReadOnly | —                                                                                |
| POST   | `/agents/<agent_id>/heartbeat/`         | None              | `{ status? }`                                                                    |
| POST   | `/agents/<agent_id>/rename/`            | IsAdministrator   | `{ hostname }`                                                                   |
| POST   | `/agents/<agent_id>/regenerate-id/`     | IsAdministrator   | —                                                                                |
| POST   | `/agents/<agent_id>/enable/`            | IsAdministrator   | —                                                                                |
| POST   | `/agents/<agent_id>/disable/`           | IsAdministrator   | —                                                                                |
| POST   | `/agents/<agent_id>/collectors/health/` | None              | `{ collector, status, last_run?, last_success?, last_failure?, failure_count? }` |

## Agent Object

```json
{
  "id": 1,
  "agent_id": "agent-001",
  "hostname": "server-01",
  "os": "linux",
  "architecture": "amd64",
  "version": "1.0.0",
  "tags": ["production"],
  "status": "ONLINE",
  "is_active": true,
  "registered_at": "2026-01-01T00:00:00Z",
  "last_seen": "2026-01-01T00:05:00Z",
  "metadata": {},
  "collector_health": [
    {
      "collector": "cpu",
      "status": "healthy",
      "last_run": "...",
      "last_success": "...",
      "last_failure": null,
      "failure_count": 0
    }
  ],
  "is_stale": false
}
```

### Agent Status Values

```text
BOOTING
INITIALIZING
ONLINE
DEGRADED
OFFLINE_BUFFERING
RECOVERING
FAILED
SHUTTING_DOWN
OFFLINE
```

---

# Telemetry & Metrics

**Base Path:** `/api/v1/telemetry/`

| Method | Endpoint                        | Auth            | Request                                                  | Response                                                    |
| ------ | ------------------------------- | --------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/telemetry/`                   | IsViewer        | `?agent_id=&metric_type=&resolution=&start=&end=&limit=` | `[Metric]`                                                  |
| POST   | `/telemetry/ingest/`            | None            | `{ agent_id, metrics: [...] }`                           | `{ ingested: count }` (201)                                 |
| GET    | `/telemetry/latest/<agent_id>/` | IsViewer        | —                                                        | `{ cpu: Metric, ram: Metric, ... }`                         |
| POST   | `/telemetry/prune/`             | IsAdministrator | —                                                        | `{ pruned: { raw_1s_24h, rollup_1m_30d, rollup_1h_365d } }` |

## Metric Object

```json
{
  "id": 1,
  "agent_id": "agent-001",
  "metric_type": "cpu",
  "resolution": "raw",
  "timestamp": "2026-01-01T00:00:00Z",
  "data": {},
  "schema_version": 1
}
```

### Metric Types

```text
cpu
ram
storage
network
process
systemd
docker
kubernetes
kernel
temperature
power
```

### Resolutions

```text
raw
1min
1hour
```

---

# Metrics Configuration

**Base Path:** `/api/v1/metrics/config/`

| Method | Endpoint                      | Auth              | Request                                                                   |
| ------ | ----------------------------- | ----------------- | ------------------------------------------------------------------------- |
| GET    | `/metrics/config/<agent_id>/` | IsAdminOrReadOnly | —                                                                         |
| PATCH  | `/metrics/config/<agent_id>/` | IsAdminOrReadOnly | `{ cpu_enabled?, ram_enabled?, ..., interval_seconds?, retention_days? }` |

## MetricConfig Object

```json
{
  "agent_id": "agent-001",
  "cpu_enabled": true,
  "ram_enabled": true,
  "storage_enabled": true,
  "network_enabled": true,
  "process_enabled": true,
  "systemd_enabled": true,
  "docker_enabled": true,
  "kubernetes_enabled": true,
  "temperature_enabled": true,
  "power_enabled": true,
  "interval_seconds": 30,
  "retention_days": 30,
  "updated_at": "2026-01-01T00:00:00Z"
}
```

---

# Logs

**Base Path:** `/api/v1/logs/`

| Method | Endpoint        | Auth            | Request / Query                                           | Response                    |
| ------ | --------------- | --------------- | --------------------------------------------------------- | --------------------------- |
| GET    | `/logs/`        | IsViewer        | `?agent_id=&source=&severity=&search=&start=&end=&limit=` | `[LogEntry]`                |
| POST   | `/logs/ingest/` | None            | `{ agent_id, logs: [...] }`                               | `{ ingested: count }` (201) |
| GET    | `/logs/export/` | IsViewer        | `?agent_id=&severity=`                                    | JSON download               |
| POST   | `/logs/clear/`  | IsAdministrator | `{ agent_id?, severity? }`                                | `{ deleted: count }`        |

## LogEntry Object

```json
{
  "id": 1,
  "agent_id": "agent-001",
  "source": "systemd-journald",
  "severity": "Info",
  "message": "Service started",
  "timestamp": "2026-01-01T00:00:00Z",
  "schema_version": 1,
  "extra": {},
  "sequence_number": 42
}
```

### Severity Levels

```text
Trace
Debug
Info
Warning
Error
Critical
```

### Log Sources

```text
systemd-journald
syslog
kernel
docker
kubernetes
internal
```

---

# Audit

**Base Path:** `/api/v1/audit/`
**Authorization:** `IsAdministrator`

| Method | Endpoint         | Query                                         | Response                           |
| ------ | ---------------- | --------------------------------------------- | ---------------------------------- |
| GET    | `/audit/`        | `?user=&action=&resource=&start=&end=&limit=` | `[AuditEntry]`                     |
| GET    | `/audit/export/` | —                                             | JSON download (max 50,000 entries) |

## AuditEntry Object

```json
{
  "id": 1,
  "timestamp": "2026-01-01T00:00:00Z",
  "user": "admin",
  "ip_address": "192.168.1.10",
  "action": "delete",
  "resource": "agent",
  "resource_id": "agent-001",
  "details": {},
  "success": true
}
```

---

# Configuration

**Base Path:** `/api/v1/config/`
**Authorization:** `IsAdministrator`

| Method | Endpoint             | Request                                            | Response                                        |
| ------ | -------------------- | -------------------------------------------------- | ----------------------------------------------- |
| GET    | `/config/`           | —                                                  | `[ConfigItem]`                                  |
| POST   | `/config/`           | `{ key, value, encrypted?, description? }`         | `ConfigItem` (201)                              |
| GET    | `/config/retention/` | —                                                  | `{ raw_hours, rollup_1m_days, rollup_1h_days }` |
| PUT    | `/config/retention/` | `{ raw_hours?, rollup_1m_days?, rollup_1h_days? }` | Same shape                                      |
| GET    | `/config/<key>/`     | —                                                  | `ConfigItem`                                    |
| PUT    | `/config/<key>/`     | `{ value?, encrypted?, description? }`             | `ConfigItem`                                    |
| DELETE | `/config/<key>/`     | —                                                  | `204 No Content`                                |

## ConfigItem Object

```json
{
  "key": "retention_days",
  "value": 30,
  "encrypted": false,
  "updated_by": "admin",
  "updated_at": "2026-01-01T00:00:00Z",
  "description": "Retention period"
}
```

---

# Health

**Base Path:** `/api/v1/health/`
**Authorization:** `IsViewer`

| Method | Endpoint                     | Response                                                          |
| ------ | ---------------------------- | ----------------------------------------------------------------- |
| GET    | `/health/`                   | `{ server_status, timestamp, agents, latest_snapshot }`           |
| GET    | `/health/agents/<agent_id>/` | `{ agent_id, hostname, status, last_seen, is_stale, collectors }` |

## Health Summary Response

```json
{
  "server_status": "healthy",
  "timestamp": "2026-01-01T00:00:00Z",
  "agents": {
    "total": 100,
    "online": 95,
    "degraded": 3,
    "offline": 2
  },
  "latest_snapshot": {}
}
```

---

# WebSocket Endpoints

**Note:** WebSocket routes are not under `/api/v1/`.

| Endpoint                    | Authentication                  | Purpose                                                                                                          |
| --------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ws://<host>/ws/ingest/`    | Agent ID + Secret               | Agent sends registration, heartbeat, metrics, logs, collector health, status updates, and configuration requests |
| `ws://<host>/ws/subscribe/` | JWT (header or query parameter) | Client subscribes to real-time events                                                                            |

## Subscribe Message

```json
{
  "action": "subscribe",
  "channel": "logs",
  "agent_id": "agent-001"
}
```

### Available Channels

```text
logs
metrics
telemetry
health
```

### Actions

```text
subscribe
unsubscribe
```

---

# Root Endpoint

| Method | Endpoint   | Auth | Response                                         |
| ------ | ---------- | ---- | ------------------------------------------------ |
| GET    | `/health/` | None | `{ "status": "ok", "service": "beacon-server" }` |

---

# Permission Model

| Permission Class  | Anonymous | Viewer   | Administrator |
| ----------------- | --------- | -------- | ------------- |
| AllowAny          | ✅         | ✅        | ✅             |
| IsViewer          | ❌         | ✅        | ✅             |
| IsAdminOrReadOnly | ❌         | GET only | ✅             |
| IsAdministrator   | ❌         | ❌        | ✅             |

---

# Common HTTP Status Codes

| Code | Meaning               |
| ---- | --------------------- |
| 200  | Success               |
| 201  | Created               |
| 204  | No Content            |
| 400  | Bad Request           |
| 401  | Unauthorized          |
| 403  | Forbidden             |
| 404  | Not Found             |
| 429  | Rate Limited          |
| 500  | Internal Server Error |
