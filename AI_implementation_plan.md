# AI Implementation Plan

## Overview
- Add granular operations APIs (docker, k8s, network, processes) + GraphQL layer for ops/metrics.
- Add LangGraph multi-agent system: Incident Commander orchestrates domain agents; new Data Fetcher/Passer agent and Code Executor agent/tools.
- Add sandboxed code execution using Docker SDK and a hardened Python image with data libraries.
- Align tools with frontend filters for logs/audit/metrics/ops; ensure scoping and permissions mirror REST.

## Current Backend Additions (already coded)
- Ops REST (mounted at `/api/v1/operations/`):
  - Docker: containers list/detail/logs; ingest.
  - K8s: pods list/detail/logs; ingest.
  - Network: interfaces list/detail; connections list; ingest interfaces/connections.
  - Processes: list/detail; per-process connections; ingest.
- GraphQL (`/api/v1/graphql/`, Strawberry):
  - Queries: dockerContainers/container; kubernetesPods/pod; networkInterfaces; networkConnections; processes/process; processConnections; metrics; latestMetrics.
  - Auth required; agent-scope checks reused from REST.
- Settings/URLs updated; Strawberry dependency added.

## REST Filters & Frontend Parity
- Logs (frontend `LogsPage.tsx`): `agent_id`, `severity` {Trace,Debug,Info,Warning,Error,Critical}, `source` {systemd-journald,syslog,kernel,docker,kubernetes,internal}, `search`, `start`, `end`, `limit`.
- Audit (frontend `AuditPage.tsx`): `user`, `action`, `resource`, `success` (to add server-side), `start`, `end`, `limit`; client “failures” toggle maps to `success=false`.
- Metrics: `agent_id`, `metric_type`, `resolution`, `start`, `end`, `limit`.
- Ops: docker `state/search`; k8s `namespace/phase`; connections `pid/protocol/state`; processes `search`.

## GraphQL Coverage Needed Next
- Add `logs` query with filters above.
- Add `auditLogs` query with filters above incl. `success`.
- Keep pagination/limits and scope checks.

## Multi-Agent Architecture (LangGraph)
- Root: Incident Commander (plan, delegate, merge, re-plan, remediate gate).
- Domain agents (parallel): Kubernetes, Network, Security, Processes, Telemetry; plus new:
  - DataFetcherAgent: calls data fetcher tool; returns sampled/filtered data and schema summary.
  - CodeExecutorAgent: runs user-provided Python against provided input in sandbox; returns parsed output + stdout/stderr.
- Message schema (example): `{task_id, from, to, domain, summary, findings[], evidence_refs[], confidence, next_actions?, done?}`.
- Flow: plan → fan-out → domain work → merge → re-plan → remediation agent (guarded).

## Tools (to define for LangGraph)
- `tool_fetch_data`:
  - Input: `{endpoint: "logs|audit|metrics|operations|custom", params: {...}, method?, authToken?, limitCaps}`.
  - Behavior: call REST/GraphQL with timeouts/retries; cap rows; return `{data, meta, status}`.
  - Reuse exact frontend filter enums for logs/audit; reuse ops filters noted above.
- `tool_run_code` (sandbox executor):
  - Input: `{code: str, input_data: object, image?: str = "sandbox-python:1.0", timeout_s?: int = 15, mem_limit?: str = "256m", cpu_quota?: int = 50000}`.
  - Behavior: run in Docker; feed `input.json`; capture stdout/stderr; read `output.json` if produced; return `{exit_code, stdout, stderr?, output_json?, duration_ms, logs}`.
  - Retry once on transient Docker errors; no retry on user code failures.
- Optional helper tools:
  - `tool_logs_export`, `tool_audit_export`.
  - Analysis helpers: `detect_network_spikes`, `log_bursts`, `top_processes`, `unhealthy_containers`, `pod_anomalies`, `iface_errors`.

## Sandbox Execution Design
- Docker image `sandbox-python:1.0` (example Dockerfile):
  ```dockerfile
  FROM python:3.11-slim
  RUN useradd -m sandboxuser
  RUN pip install --no-cache-dir pandas numpy scipy scikit-learn pyarrow fastparquet requests
  WORKDIR /app
  USER sandboxuser
  ```
- Runner (Python, using Docker SDK):
  - Create temp dir; write `main.py`, `input.json`.
  - Wrap code to load `input.json`; allow writing `output.json`; capture stdout/stderr.
  - Container options: `network_disabled=True`, `mem_limit="256m"`, `cpu_quota=50000`, optional `pids_limit`, `read-only` root if feasible; mount temp dir to `/app`; `working_dir=/app`; `user=sandboxuser`.
  - Timeout: kill after `timeout_s` (default 15s). Always remove container.
  - Return structured result; truncate large stdout/stderr; audit log runs.
- Security guardrails:
  - No outbound network.
  - Resource limits enforced.
  - Optional AST lint to block dangerous imports (`os`, `subprocess`, `socket`) if desired.
  - Validate input size (cap ~5–10 MB).
  - Do not mount host paths except temp dir; no docker socket.

## Data Flow for Code Execution
1) Commander (or requesting agent) sends task → DataFetcherAgent.
2) DataFetcherAgent calls `tool_fetch_data` with filters; samples/compacts data; sends to CodeExecutorAgent.
3) CodeExecutorAgent calls `tool_run_code` with code + compacted data; receives result; returns summary + parsed JSON to Commander.
4) Commander merges into findings; may iterate or trigger remediation.

## API Extensions Recommended
- Audit REST: add `success` query param to filter failures server-side.
- GraphQL: add `logs` and `auditLogs` queries with same filters as REST.

## Testing Strategy
- Runner unit tests: success path (pandas script), nonzero exit, timeout, missing output.json, large stdout, container removal.
- Security smoke: attempt network access (should fail), long sleep (should timeout), memory blowup (respect mem_limit).
- Tools tests: `tool_fetch_data` respects limits/filters; `tool_run_code` handles retries and timeouts.
- GraphQL tests: new `logs`/`auditLogs` queries filter correctly; scope enforcement.
- Integration: DataFetcher → CodeExecutor chain with sample code.

## Observability & Audit
- Log each sandbox run: user/agent, image, duration, exit_code, stdout/stderr sizes.
- Metrics: run counts, failures, timeouts, bytes processed.
- Keep audit logs for data fetches if sensitive.

## Step-by-Step Execution (when editing is allowed)
1) Add `sandbox-python:1.0` Dockerfile; build/push image (contains pandas/numpy/etc., non-root).
2) Add server module (e.g., `apps/sandbox`) with `run_in_sandbox` using Docker SDK and limits/timeouts.
3) Define LangGraph tool schemas for `tool_fetch_data` and `tool_run_code`; bind DataFetcherAgent and CodeExecutorAgent.
4) Extend audit REST (`success` filter) and add GraphQL `logs`/`auditLogs` queries.
5) Add analysis helper utilities (spike detection, log bursts, pod/container health, etc.).
6) Add tests (runner, tools, GraphQL).
7) Wire observability (audit logs, metrics on runs).
8) Document available packages in sandbox so invoking agents craft correct code.

## Reference: Existing Ops & GraphQL (already in backend)
- Ops REST: `/api/v1/operations/` with docker/k8s/network/process endpoints and ingest endpoints.
- GraphQL: `/api/v1/graphql/` with ops + metrics queries; auth + agent-scope.

## Frontend Filter Alignment
- Logs severity/source enums as in `LogsPage.tsx`.
- Audit action/resource lists as in `AuditPage.tsx`; add `success` server-side for “failures” toggle parity.
