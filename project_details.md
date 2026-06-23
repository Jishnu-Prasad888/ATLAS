# ATLAS / Beacon Platform — Project Details

## 1. Project Identity

| Field | Value |
|-------|-------|
| **Project Name** | Beacon Platform (root directory: ATLAS) |
| **Version** | 1.0.0 |
| **Description** | Distributed Linux observability and telemetry platform with AI-driven incident analysis. Lightweight Rust agents collect telemetry from monitored machines and forward encrypted data to a central Django server via secure WebSocket connections. Includes a multi-agent AI system (ATLAS-AI) for intelligent operations. |
| **Repository** | Git (10 branches, ~85+ commits) |
| **Primary Branch** | `main` |
| **License** | Not specified (proprietary) |

---

## 2. Tech Stack

### 2.1 Backend Server — Python/Django

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | Django | 5.0.6 |
| REST API | Django REST Framework | 3.15.2 |
| JWT Auth | djangorestframework-simplejwt | 5.3.1 |
| WebSocket | Django Channels + Daphne | 4.1.0 / 4.1.2 |
| Channel Backend | channels-redis (Redis) | 4.2.0 |
| Database | PostgreSQL | 14+ |
| Cache/Broker | Redis | 7+ |
| Password Hashing | argon2-cffi | 23.1.0 |
| ASGI Server | Daphne | 4.1.2 |
| GraphQL | Strawberry GraphQL | 0.241.0 |
| AI/LLM | OpenAI SDK, LangChain Core, LangGraph | openai 1.58.1, langchain-core 0.3.12, langgraph 0.2.20 |
| Docker SDK | docker-py | 7.1.0 |
| Task Queue | Celery | 5.4.0 |

### 2.2 Agent — Rust

| Component | Crate | Version |
|-----------|-------|---------|
| Async Runtime | tokio | 1.x |
| WebSocket | tokio-tungstenite | 0.21 |
| TLS | rustls | 0.22 |
| Encryption | aes-gcm | 0.10 |
| Key Derivation | argon2 | 0.5 |
| Hashing | sha2 | 0.10 |
| Local Storage | rusqlite (SQLite) | 0.31 |
| System Metrics | sysinfo | 0.30 |
| GPU Metrics | nvml-wrapper | 0.8 |
| CLI | clap (derive) | 4.x |
| TUI | ratatui | 0.26 |
| Terminal | crossterm | 0.27 |

### 2.3 Frontend (Web) — React/TypeScript

| Component | Technology | Version |
|-----------|------------|---------|
| Framework | React | 19.2.6 |
| Language | TypeScript | 6.0 |
| Bundler | Vite | 8.0.12 |
| Styling | Tailwind CSS | 4.3.0 |
| Routing | react-router-dom | 7.17.0 |
| State Management | Zustand | 5.0.14 |
| Server State | TanStack React Query | 5.101.0 |
| HTTP Client | Axios | 1.17.0 |
| Charts | Recharts | 3.8.1 |
| Icons | Lucide React | 1.20.0 |
| Testing | Vitest + Testing Library | 4.1.8 |
| Mocking | MSW | 2.14.6 |
| Drag/Resize | react-grid-layout | 2.2.3 |

### 2.4 Frontend (Mobile) — Expo/React Native

| Component | Technology |
|-----------|------------|
| Framework | Expo (React Native) |
| Language | TypeScript |
| Styling | NativeWind (Tailwind for RN) |
| Navigation | expo-router |
| State | Zustand |
| Server State | TanStack React Query |
| HTTP | Axios |
| Auth Storage | expo-secure-store |

### 2.5 Infrastructure

| Component | Technology |
|-----------|------------|
| Containerization | Docker / docker-compose |
| Database | PostgreSQL 16 (Alpine) |
| Cache | Redis 7 (Alpine) |

---

## 3. Architecture Overview

```
Users / TUI / Dashboard / Mobile App
      |
      ▼
Beacon Server (Django + Channels + Daphne ASGI)
  ├── Authentication & RBAC (Argon2id, JWT, recovery keys)
  ├── Audit System (Immutable append-only)
  ├── Telemetry Manager (ingestion, query, pruning)
  ├── REST API  (/api/v1/...)
  ├── GraphQL  (/api/v1/graphql/)
  ├── ATLAS-AI (LangGraph multi-agent, sandboxed code execution)
  ├── Operations (Docker, K8s, Network, Processes)
  └── WebSocket (/ws/ingest/ · /ws/subscribe/)
          |  Secure WebSocket (TLS 1.3 + AES-256-GCM)
      ▼
Beacon Agents (Rust, 1 to N)
  ├── Identity Engine    (SHA-256 hardware fingerprint)
  ├── Encryption Engine  (AES-256-GCM, key rotation)
  ├── Queue Engine       (offline buffering + dead letter queue)
  ├── Storage Engine     (4 SQLite WAL databases)
  ├── Collectors (CPU, RAM, Storage, Network, Process, Systemd,
  │               Docker, K3s, Kernel, GPU, Temperature, Inventory)
  ├── Transport          (TLS WebSocket, exponential backoff)
  ├── Health Engine      (per-collector status tracking)
  ├── Log Engine         (rate-limited logging)
  └── TUI                (Ratatui keyboard-driven dashboard)
```

### 3.1 Binaries

| Binary | Language | Role |
|--------|----------|------|
| `beacon-server` | Python/Django | Central ingestion, auth, storage, APIs, AI |
| `beacon-agent` | Rust | Agent collector, local storage, secure transport |
| `beacon-frontend` | React/TypeScript | Web dashboard UI |
| `beacon-mobile` | React Native/Expo | Mobile app |

### 3.2 Key Design Principles

- **Observability-focused:** Read-only telemetry collection; no remote execution
- **Offline-first:** SQLite queue buffers data during disconnects, replays on reconnect
- **Secure by default:** TLS 1.3 + AES-256-GCM + Argon2id; no insecure defaults
- **Immutable telemetry & audit:** Records cannot be deleted or modified
- **Async throughout:** Tokio runtime (agent), Django Channels (server)
- **Full CLI/API parity:** Every CLI operation has an equivalent REST endpoint

---

## 4. Directory Structure

### 4.1 Root Level (`/home/jishnu/Desktop/ATLAS/`)

| Path | Purpose |
|------|---------|
| `beacon-platform/` | **Core backend**: Django server + Rust agent |
| `beacon-mobile/` | **Mobile app**: Expo/React Native project |
| `frontend/` | **Web dashboard**: Vite + React + TypeScript project |
| `docs/` | Documentation files |
| `proposals/` | Academic/architectural proposals (LaTeX, PDFs) |
| `logo.svg` | Project logo |
| `load_test_components.py` | GUI tool for generating CPU/RAM/GPU load |
| `notes.md` | Developer notes |
| `AI_implementation_plan.md` | Plan for ATLAS-AI multi-agent system |
| `API Reference guide.md` | Complete REST API documentation |
| `beacon-agent commands.md` | CLI reference for the Rust agent |
| `.gitignore` | Git ignore rules |

### 4.2 `beacon-platform/` — Core Platform

| Path | Purpose |
|------|---------|
| `README.md` | Comprehensive platform documentation |
| `TECHNICALS.md` | Deep technical reference (data models, modules, permissions) |
| `reinstall-agent.py` | Script to reinstall the Rust agent binary |
| `agent/` | **Rust agent** source code |
| `server/` | **Django server** source code |

### 4.3 `beacon-platform/agent/` — Rust Agent (~6,920+ lines, 89 files)

| Path | Purpose |
|------|---------|
| `Cargo.toml` | Rust package config (dependencies, build profiles) |
| `Cargo.lock` | Locked dependency versions |
| `agent.toml.example` | Example agent configuration file |
| `src/main.rs` | Entry point, CLI parser (clap), daemon runner |
| `src/config/` | AgentConfig (TOML-backed configuration loader) |
| `src/auth.rs` | Authentication module |
| `src/registration.rs` | Server registration logic |
| `src/engines/` | Core engines subsystem (7 files) |
| `src/engines/identity.rs` | IdentityEngine — SHA-256 hardware fingerprint |
| `src/engines/encryption.rs` | EncryptionEngine — AES-256-GCM with key rotation |
| `src/engines/health.rs` | HealthEngine — per-collector status tracking |
| `src/engines/queue.rs` | QueueEngine — offline buffering with dead letter queue |
| `src/engines/logging.rs` | LogEngine — rate-limited log management |
| `src/engines/tui.rs` | Ratatui terminal UI dashboard |
| `src/collectors/` | Telemetry collectors (15 files) |
| `src/storage/` | StorageManager — manages 4 SQLite databases |
| `src/transport/` | WebSocketTransport — TLS 1.3 WebSocket with reconnect |

**Collectors:**
| Collector | File | Description |
|-----------|------|-------------|
| CPU | `cpu.rs` | CPU metrics (usage, load, frequency, temperatures) |
| RAM | `ram.rs` | Memory metrics (total, used, swap) |
| Storage | `storage.rs` | Disk metrics (usage, I/O, mount points) |
| Network | `network.rs` | Network interfaces, connections, bandwidth |
| Process | `process.rs` | Process list with CPU/RAM per process |
| Systemd | `systemd.rs` | Systemd service states and metrics |
| Docker | `docker.rs` | Docker container metrics and stats |
| K3s | `k3s.rs` | K3s/Kubernetes pod and node metrics |
| Kernel | `kernel.rs` | Kernel parameters and system info |
| GPU | `gpu.rs` | NVIDIA GPU metrics via NVML |
| Temperature | (included) | Temperature sensor readings |
| Power | (included) | Power consumption metrics |
| System Inventory | `system_inventory.rs` | Hardware and OS inventory |

### 4.4 `beacon-platform/server/` — Django Server

| Path | Purpose |
|------|---------|
| `requirements.txt` | Python dependencies (23 packages) |
| `manage.py` | Django management utility |
| `Dockerfile` | Docker image for the server |
| `docker-compose.yml` | Docker Compose for PostgreSQL + Redis |
| `.env.example` | Environment variable template |
| `beacon_server/settings.py` | Central settings (258 lines) |
| `beacon_server/urls.py` | Root URL routing |
| `beacon_server/asgi.py` | ASGI config (HTTP + WebSocket) |
| `beacon_server/wsgi.py` | WSGI fallback |
| `apps/` | **15 Django apps** (see below) |
| `certs/` | TLS certificate storage |
| `sandbox/` | Sandboxed code execution (Dockerfile for `sandbox-python:1.0`) |
| `staticfiles/` | Collected static files |
| `media/` | Uploaded media |
| `logs/` | Application logs |
| `tests/` | Test directory |

**Django Apps (`beacon-platform/server/apps/`):**

| App | Purpose |
|-----|---------|
| `auth_rbac/` | Authentication, RBAC (4 roles), JWT, recovery keys, user management |
| `agents/` | Agent registry, registration, heartbeat, collector health |
| `metrics/` | Telemetry ingestion, query, pruning, metric config |
| `logs/` | Log ingestion, query, export, clear |
| `audit/` | Immutable audit trail, middleware, audit_log() utility |
| `health/` | Server + fleet health summary |
| `config/` | Server configuration key-value store |
| `websocket/` | Channels consumers (AgentIngestConsumer, ClientSubscribeConsumer) |
| `operations/` | Docker, K8s, network, process operations endpoints |
| `graphql_api/` | Strawberry GraphQL schema and views |
| `atlas_ai/` | ATLAS-AI backend (models, views, serializers) |
| `ai_agents/` | LangGraph multi-agent system (commander, graph, tools, runtime) |
| `tools/` | Tool implementations |
| `sandbox/` | Local sandbox module reference |

### 4.5 `frontend/` — Web Dashboard

| Path | Purpose |
|------|---------|
| `package.json` | NPM dependencies and scripts |
| `vite.config.ts` | Vite build config |
| `tsconfig.json` | TypeScript configuration |
| `eslint.config.js` | ESLint configuration |
| `index.html` | HTML entry point |
| `src/App.tsx` | Root component with routing |
| `src/main.tsx` | Entry point with MSW mock support |
| `src/pages/` | **20 page components** (Dashboard, Agents, Operations, Metrics, Logs, Health, Audit, Users, Config, Settings, AI Workbench, AI Analyst, etc.) |
| `src/api/` | **10 API modules** (auth, agents, telemetry, logs, ai, atlasAi, users, commander, resources, client) |
| `src/store/` | **3 Zustand stores** (authStore, atlasAiStore, uiStore) |
| `src/components/` | **15 component directories** (layout, auth, common, charts, dashboard, agents, metrics, logs, health, audit, config, atlasAi, copilot, users, UI) |
| `src/hooks/` | Custom hooks (queryKeys, useCommanderChat, usePersistedState) |
| `src/types/` | TypeScript type definitions |
| `src/ws/` | WebSocket client singleton |
| `src/atlas-ai/` | Client-side ATLAS-AI engine |
| `src/mocks/` | MSW mock service worker handlers |
| `src/test/` | Test files |

### 4.6 `beacon-mobile/` — Mobile App

| Path | Purpose |
|------|---------|
| `package.json` | Expo/RN dependencies |
| `App.tsx` | Root component |
| `app.json` | Expo configuration |
| `src/screens/` | **11 screens** (Dashboard, Agents, Metrics, Logs, Health, Audit, Operations, Users, Config, Settings, Login) |
| `src/navigation/` | AppNavigator + AppHeader |
| `src/api/` | API client modules |
| `src/store/` | authStore, settingsStore |
| `src/components/` | Shared components |
| `src/hooks/` | Custom hooks |
| `src/ws/` | WebSocket client |
| `src/theme/` | Theming |
| `src/types/` | TypeScript types |

---

## 5. Data Models

### 5.1 Server-Side (PostgreSQL)

| Model | Table | Key Fields |
|-------|-------|------------|
| `BeaconUser` | `auth_rbac_beaconuser` | username, email, role (viewer/moderator/administrator/guest), is_active, failed_logins, locked_until |
| `RecoveryKey` | `auth_rbac_recoverykey` | user (FK), key_hash (SHA-256), invalidated |
| `Agent` | `agents_agent` | agent_id (SHA-256), hostname, os, arch, version, tags, status (9 states), is_active |
| `CollectorHealth` | `agents_collectorhealth` | agent (FK), collector, status, last_run, failure_count |
| `Metric` | `beacon_metrics_metric` | agent_id, metric_type (11 types), resolution (raw/1min/1hour), timestamp, data (JSON) |
| `MetricConfig` | `metrics_metricconfig` | agent_id, per-collector enable flags, interval_seconds, retention_days |
| `LogEntry` | `beacon_logs_logentry` | agent_id, source (6 types), severity (6 levels), message, timestamp, extra (JSON) |
| `AuditLog` | `audit_auditlog` | timestamp, user, ip_address, action, resource, resource_id, details, success |
| `ServerConfig` | `config_serverconfig` | key, value (JSON), encrypted, updated_by |
| `ServerHealth` | `health_serverhealth` | timestamp, status, agents counts, metrics/logs rate, db_size |

### 5.2 Agent-Side (SQLite WAL)

The agent manages 4 SQLite databases under `/var/lib/beacon/agent/`:

| Database | Purpose |
|----------|---------|
| `metrics.db` | Collected telemetry |
| `logs.db` | System and application logs |
| `queue.db` | Outbound message queue + dead letter queue |
| `config.db` | Agent configuration, identity, encryption keys |

---

## 6. RBAC & Permissions

### 6.1 Roles

| Role | Capabilities |
|------|-------------|
| `guest` | Limited read-only, time-bound access |
| `viewer` | Read all telemetry, logs, agents, health; export data |
| `moderator` | Viewer + manage agents, operations, audit read |
| `administrator` | Full access: manage users, agents, config, encryption, retention, audit |

### 6.2 Permission Classes

- `IsAdministrator` — Only `administrator` role
- `IsViewer` — `viewer`, `moderator`, `administrator`
- `IsAdminOrReadOnly` — GET for viewers, mutating methods for admins
- `IsAgentAuthenticated` — Validates agent ID + secret headers
- `IsModeratorOrAdmin` — moderator + administrator

### 6.3 Security Features

| Feature | Detail |
|---------|--------|
| Password Hashing | Argon2id (time_cost=3, memory_cost=64MB, parallelism=4) |
| JWT | HS256, 30min access, 7-day refresh with rotation + blacklisting |
| Recovery Keys | `XXXX-XXXX-XXXX-XXXX` hex format, SHA-256 hashed, one-time use |
| Account Lockout | Progressive (5 failures = 60s, 10 = 5min, 20 = 1hr) |
| Rate Limiting | 20/min anonymous, 1000/min authenticated, 5/min login |
| Log Sanitization | Null bytes and carriage returns stripped, truncated at 8192 chars |
| Agent Secret | Shared secret between server and agent for registration |

---

## 7. APIs

### 7.1 REST API (`/api/v1/`)

| Endpoint Group | Purpose |
|----------------|---------|
| `/api/v1/auth/*` | Login, logout, refresh, whoami, password change/recover, recovery keys |
| `/api/v1/users/*` | User CRUD (admin only), role assignment, enable/disable |
| `/api/v1/agents/*` | Agent registration, heartbeat, listing, rename, enable/disable, collector health |
| `/api/v1/telemetry/*` | Metric ingestion (agent), query, latest per-agent, prune |
| `/api/v1/metrics/config/*` | Per-agent collector configuration |
| `/api/v1/logs/*` | Log ingestion, query, export, clear |
| `/api/v1/audit/*` | Immutable audit trail query and export |
| `/api/v1/health/*` | Server + fleet health summary |
| `/api/v1/config/*` | Server configuration key-value store, retention policy |
| `/api/v1/operations/*` | Docker, K8s, network, processes operations |
| `/api/v1/graphql/` | Strawberry GraphQL endpoint |
| `/api/v1/atlas-ai/*` | ATLAS-AI endpoints |
| `/api/v1/ai/run-graph/` | Run LangGraph multi-agent workflow |
| `/api/v1/ai/commander/` | Commander chat interface |
| `/health/` | Unauthenticated liveness check |

### 7.2 WebSocket Endpoints

| Endpoint | Consumer | Purpose |
|----------|----------|---------|
| `/ws/ingest/` | AgentIngestConsumer | Agent sends registration, heartbeat, metrics, logs, collector health |
| `/ws/subscribe/` | ClientSubscribeConsumer | Client subscribes to real-time channels (metrics, logs, health, telemetry) |

### 7.3 Subscription Channels

| Channel | Content |
|---------|---------|
| `metrics` | Live metric updates per agent |
| `logs` | Live log entries per agent |
| `health` | Health status changes per agent |
| `telemetry` | Telemetry updates per agent |

---

## 8. AI System (ATLAS-AI)

### 8.1 Architecture

```
Incident Commander (LangGraph)
  ├── Domain Agents:
  │   ├── Kubernetes Agent
  │   ├── Network Agent
  │   ├── Security Agent
  │   ├── Processes Agent
  │   └── Telemetry Agent
  ├── DataFetcherAgent
  │     (fetches from REST/GraphQL APIs with filters)
  └── CodeExecutorAgent
        (sandboxed Python in Docker container)
```

### 8.2 Sandbox Execution

| Parameter | Value |
|-----------|-------|
| Docker Image | `sandbox-python:1.0` (Python 3.11 slim) |
| Packages | pandas, numpy, scipy, scikit-learn, pyarrow, requests |
| Network | Disabled (`network_disabled=True`) |
| Memory Limit | 256m |
| CPU Quota | 50000 |
| User | Non-root |
| Timeout | 15 seconds |
| Cleanup | Container auto-removed |
| I/O | `input.json` / `output.json` files |

### 8.3 Frontend ATLAS-AI Engine

- Located in `frontend/src/atlas-ai/`
- Supports OpenAI and local LLM providers (e.g., Ollama with qwen2.5-coder)
- Runs entirely client-side with user-provided API keys
- Includes tooling, audit logging, encryption key store, model configuration

---

## 9. Data Retention Policy

| Resolution | Collection Interval | Retention |
|------------|--------------------|-----------|
| Raw | 1 second | 24 hours |
| Rollup (1min) | 1 minute | 30 days |
| Rollup (1hour) | 1 hour | 365 days |

Configurable via `/api/v1/config/retention/` or `MetricConfig` per-agent.

---

## 10. How to Build, Run, Test, Deploy

### 10.1 Server (Docker)

```bash
cd beacon-platform/server
cp .env.example .env
# Edit .env — set SECRET_KEY, DB_PASSWORD, BEACON_AGENT_SECRET, etc.

docker compose up -d
docker compose exec server python manage.py migrate
docker compose exec server python manage.py beacon_init
```

Server starts on `http://localhost:8000` (HTTP + WebSocket via Daphne).

### 10.2 Server (Manual)

```bash
cd beacon-platform/server
source beacon_venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py beacon_init
daphne -b 0.0.0.0 -p 8000 beacon_server.asgi:application
```

### 10.3 Agent (Rust)

```bash
cd beacon-platform/agent
cargo build --release

# Install
sudo cp target/release/beacon-agent /usr/local/bin/
sudo mkdir -p /etc/beacon /var/lib/beacon/agent /var/log/beacon

# First-time init
sudo beacon-agent init

# Run
sudo beacon-agent start --config /etc/beacon/agent.toml

# Run on boot via cron
sudo beacon-agent cron install
```

**Prerequisite:** Rust 1.76+ via rustup.

### 10.4 Frontend (Web)

```bash
cd frontend
npm install
npm run dev      # Development on :5173 (proxies to :8000)
npm run build    # Production build
npm run preview  # Preview build
npm run test     # Run tests (Vitest)
npm run test:ui  # Test UI
npm run test:coverage  # Test coverage
```

### 10.5 Mobile App

```bash
cd beacon-mobile
npm install
npx expo start
npx expo start --android
npx expo start --ios
```

### 10.6 Sandbox Code Execution Image

```bash
cd beacon-platform/server/sandbox
docker build -t sandbox-python:1.0 .
```

### 10.7 Utility Scripts

| Script | Purpose |
|--------|---------|
| `load_test_components.py` | GUI load tester for CPU/RAM/GPU (`pip install psutil`) |
| `reinstall-agent.py` | Interactive agent reinstall script |

---

## 11. Dependencies

### 11.1 Server (Python) — `requirements.txt`

```
Django==5.0.6
djangorestframework==3.15.2
djangorestframework-simplejwt==5.3.1
channels==4.1.0
channels-redis==4.2.0
daphne==4.1.2
psycopg2-binary
django-cors-headers
cryptography
argon2-cffi==23.1.0
redis
celery==5.4.0
django-filter
Pillow
python-dotenv
websockets
msgpack
strawberry-graphql==0.241.0
docker==7.1.0
requests
openai==1.58.1
langchain-core==0.3.12
langgraph==0.2.20
```

### 11.2 Agent (Rust) — `Cargo.toml`

```
tokio, tokio-tungstenite, futures-util, serde, serde_json, libc
aes-gcm, argon2, sha2, rand, base64, hex, flate2
rustls, rustls-native-certs, webpki-roots
rusqlite (bundled), reqwest
sysinfo, nvml-wrapper
clap, toml, dirs
tracing, tracing-subscriber
uuid, chrono, anyhow, thiserror
async-trait, once_cell, regex, url
ratatui, crossterm
```

(35+ crates total)

### 11.3 Frontend (Web) — `package.json`

**Dependencies:** React 19, React Router 7, TanStack React Query 5, Axios, Zustand 5, Tailwind CSS 4, Recharts, Lucide React, react-grid-layout, react-markdown, date-fns, clsx

**DevDependencies:** TypeScript 6, Vite 8, Vitest 4, Testing Library, MSW 2, ESLint, jsdom, @types

### 11.4 Mobile (Expo) — `package.json`

**Dependencies:** Expo SDK 54, React Native 0.81, NativeWind 4, Expo Router, Zustand, Axios, TanStack React Query, Lucide React Native, date-fns, clsx, react-native-reanimated, react-native-gesture-handler, expo-secure-store, expo-linear-gradient, expo-blur, expo-haptics

---

## 12. Git Branches

| Branch | Purpose |
|--------|---------|
| `main` | Primary development branch |
| `beacon` | Beacon-specific feature branch |
| `feat/atlas_frontend` | Frontend feature development |
| `feat/new_sys_design` | New system design |
| `remotes/origin/HEAD` | Origin HEAD (main) |
| `remotes/origin/beacon` | Remote beacon branch |
| `remotes/origin/feat/atlas_frontend` | Remote frontend feature |
| `remotes/origin/feat/new_sys_design` | Remote new design |
| `remotes/origin/main` | Remote main branch |

---

## 13. Key Documents

| File | Description |
|------|-------------|
| `beacon-platform/README.md` | Comprehensive platform documentation |
| `beacon-platform/TECHNICALS.md` | Deep technical reference |
| `AI_implementation_plan.md` | Plan for ATLAS-AI multi-agent system |
| `API Reference guide.md` | Complete REST API documentation |
| `beacon-agent commands.md` | CLI reference for the Rust agent |
| `notes.md` | Developer notes |
| `docs/auth_migration.md` | Auth & RBAC upgrade rollout instructions |
| `proposals/beacon.tex` | Beacon LaTeX proposal source |
| `proposals/Proposal.tex` | General proposal LaTeX |
