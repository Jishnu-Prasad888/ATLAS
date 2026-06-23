"""Tool adapters for OpenAI multi-agent orchestration.

These wrap internal helpers so OpenAI tool-calling can invoke data fetches
and sandboxed code execution.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, Callable
from types import SimpleNamespace

from rest_framework.test import APIRequestFactory

from apps.tools.data_fetcher import fetch_data
from apps.tools.code_executor import SANDBOX_IMAGE, run_in_sandbox
from graphql import graphql_sync


ToolFn = Callable[[Dict[str, Any], Any | None], Any]
ai_logger = logging.getLogger("ai")


def _tool_fetch_data(args: Dict[str, Any], _request: Any | None = None) -> Dict[str, Any]:
    url = args.get("url")
    if not url:
        raise ValueError("url is required")
    try:
        return fetch_data(
            url=url,
            params=args.get("params"),
            method=args.get("method", "GET"),
            token=args.get("token"),
            timeout=args.get("timeout", 10),
            max_bytes=args.get("max_bytes", 2_000_000),
        )
    except Exception as exc:  # network, decode, size errors
        return {"error": str(exc), "status": None}


def _tool_run_code(args: Dict[str, Any], _request: Any | None = None) -> Dict[str, Any]:
    code = args.get("code")
    input_data = args.get("input_data", {})
    if not code:
        raise ValueError("code is required")
    image_val = args.get("image")
    image_str = str(image_val) if image_val else SANDBOX_IMAGE
    return run_in_sandbox(
        code=code,
        input_data=input_data,
        image=image_str,
        timeout_s=args.get("timeout_s", 15),
        mem_limit=args.get("mem_limit", "256m"),
        cpu_quota=args.get("cpu_quota", 50000),
        retries=args.get("retries", 1),
    )


_GQL_SCHEMA = None
_API_FACTORY = APIRequestFactory()


def _execute_graphql(query: str, variables: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    global _GQL_SCHEMA
    if _GQL_SCHEMA is None:
        from apps.graphql_api.schema import schema

        if hasattr(schema, "as_graphql_schema"):
            _GQL_SCHEMA = schema.as_graphql_schema()  # strawberry >=0.219
        elif hasattr(schema, "get_graphql_schema"):
            _GQL_SCHEMA = schema.get_graphql_schema()  # strawberry older alias
        elif hasattr(schema, "as_schema"):
            _GQL_SCHEMA = schema.as_schema()  # fallback
        elif hasattr(schema, "_schema"):
            _GQL_SCHEMA = schema._schema  # type: ignore[attr-defined]
        else:
            _GQL_SCHEMA = schema  # last resort

    context_value = SimpleNamespace(request=request)
    result = graphql_sync(_GQL_SCHEMA, query, variable_values=variables, context_value=context_value)
    if result.errors:
        raise ValueError(str(result.errors))
    return result.data  # type: ignore[return-value]


def _call_ops_view(view_cls, request: Any | None, path: str, params: Dict[str, Any] | None, **view_kwargs) -> Dict[str, Any]:
    if request is None:
        return {"error": "Request context required"}
    auth = request.META.get("HTTP_AUTHORIZATION", "")
    query = {k: v for k, v in (params or {}).items() if v not in (None, "", [])}
    req = _API_FACTORY.get(path, data=query, HTTP_AUTHORIZATION=auth)
    req.user = getattr(request, "user", None)
    resp = view_cls.as_view()(req, **view_kwargs)
    if resp.status_code != 200:
        return {"error": f"Ops API {path} failed", "status": resp.status_code}
    return resp.data  # type: ignore[return-value]


def _redact(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {k: _redact(v) if k.lower() not in {"token", "authorization", "api_key", "password", "secret"} else "<redacted>" for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    return obj


def _containers_from_metrics(agent_id: str | None) -> list[dict[str, Any]]:
    if not agent_id:
        return []
    from apps.metrics.models import Metric

    metric = (
        Metric.objects.filter(agent_id=agent_id, metric_type="docker")
        .order_by("-timestamp")
        .first()
    )
    if not metric:
        return []
    containers = metric.data.get("inventory", {}).get("containers", [])
    summary = []
    for item in containers:
        if not isinstance(item, dict):
            continue
        summary.append(
            {
                "container_id": item.get("container_id"),
                "name": item.get("name"),
                "image": item.get("image"),
                "state": item.get("state"),
                "status": item.get("status"),
                "created_at": item.get("created_at"),
                "started_at": item.get("started_at"),
                "labels": item.get("labels"),
                "platform": item.get("platform"),
            }
        )
    return summary


def _processes_from_metrics(agent_id: str | None, search: str | None = None, limit: int | None = None) -> list[dict[str, Any]]:
    if not agent_id:
        return []
    from apps.metrics.models import Metric

    metric = (
        Metric.objects.filter(agent_id=agent_id, metric_type="process")
        .order_by("-timestamp")
        .first()
    )
    if not metric:
        return []

    processes = metric.data.get("processes", [])
    if not isinstance(processes, list):
        return []

    def matches(proc: dict[str, Any]) -> bool:
        if not search:
            return True
        needle = search.lower()
        haystack = " ".join(
            str(proc.get(key, ""))
            for key in ("name", "exe")
        ).lower()
        return needle in haystack

    updated_at = None
    try:
        updated_at = metric.timestamp.isoformat() if metric.timestamp else None
    except AttributeError:
        updated_at = None

    summary: list[dict[str, Any]] = []
    for item in processes:
        if not isinstance(item, dict):
            continue
        if not matches(item):
            continue
        start_time = item.get("start_time")
        started_at = None
        if isinstance(start_time, (int, float)):
            try:
                started_at = datetime.fromtimestamp(float(start_time), tz=timezone.utc).isoformat()
            except (OverflowError, ValueError):
                started_at = None
        summary.append(
            {
                "agent_id": agent_id,
                "pid": item.get("pid"),
                "name": item.get("name"),
                "username": item.get("username"),
                "cmdline": item.get("exe"),
                "cpu_pct": item.get("cpu_pct"),
                "mem_pct": item.get("mem_pct"),
                "mem_bytes": item.get("mem_bytes"),
                "started_at": started_at,
                "updated_at": updated_at,
                "meta": {
                    "boot_id": item.get("boot_id"),
                    "threads": item.get("threads"),
                    "virtual_mem": item.get("virtual_mem"),
                    "status": item.get("status"),
                },
            }
        )

    summary.sort(key=lambda p: (p.get("cpu_pct") or 0), reverse=True)
    if limit is not None and limit > 0:
        summary = summary[:limit]
    return summary


def _network_metric(agent_id: str | None):
    if not agent_id:
        return None
    from apps.metrics.models import Metric

    return (
        Metric.objects.filter(agent_id=agent_id, metric_type="network")
        .order_by("-timestamp")
        .first()
    )


def _network_interfaces_from_metrics(agent_id: str | None) -> list[dict[str, Any]]:
    metric = _network_metric(agent_id)
    if not metric:
        return []

    data = metric.data or {}
    interfaces = data.get("interfaces", [])
    if not isinstance(interfaces, list):
        return []

    updated_at = None
    try:
        updated_at = metric.timestamp.isoformat() if metric.timestamp else None
    except AttributeError:
        updated_at = None

    summary: list[dict[str, Any]] = []
    for iface in interfaces:
        if not isinstance(iface, dict):
            continue
        addresses = iface.get("addresses")
        primary_addr = None
        if isinstance(addresses, list) and addresses:
            first = addresses[0]
            if isinstance(first, dict):
                primary_addr = first.get("address")

        meta: dict[str, Any] = {}
        for key in ("rx_bytes_rate", "tx_bytes_rate", "qlen", "state", "flags", "addresses"):
            if key in iface and iface[key] is not None:
                meta[key] = iface[key]

        summary.append(
            {
                "agent_id": agent_id,
                "name": iface.get("name"),
                "address": primary_addr or iface.get("address", ""),
                "mac": iface.get("mac"),
                "mtu": iface.get("mtu"),
                "speed_mbps": iface.get("speed_mbps") or iface.get("speed"),
                "rx_bytes": iface.get("rx_bytes", 0),
                "tx_bytes": iface.get("tx_bytes", 0),
                "rx_errors": iface.get("rx_errors", 0),
                "tx_errors": iface.get("tx_errors", 0),
                "rx_dropped": iface.get("rx_dropped", 0),
                "tx_dropped": iface.get("tx_dropped", 0),
                "meta": meta,
                "updated_at": updated_at,
            }
        )

    summary.sort(key=lambda item: (item.get("tx_bytes") or 0), reverse=True)
    return summary


def _network_connections_from_metrics(
    agent_id: str | None,
    protocol: str | None = None,
    state: str | None = None,
    pid: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    metric = _network_metric(agent_id)
    if not metric:
        return []

    data = metric.data or {}
    connections = data.get("process_connections", [])
    if not isinstance(connections, list):
        return []

    protocol_filter = (protocol or "").lower()
    state_filter = (state or "").lower()
    pid_filter = None
    try:
        pid_filter = int(pid) if pid is not None else None
    except (TypeError, ValueError):
        pid_filter = None

    updated_at = None
    try:
        updated_at = metric.timestamp.isoformat() if metric.timestamp else None
    except AttributeError:
        updated_at = None

    summary: list[dict[str, Any]] = []
    for conn in connections:
        if not isinstance(conn, dict):
            continue
        if protocol_filter and (conn.get("protocol") or "").lower() != protocol_filter:
            continue
        if state_filter and (conn.get("state") or "").lower() != state_filter:
            continue
        if pid_filter is not None and conn.get("pid") != pid_filter:
            continue

        summary.append(
            {
                "agent_id": agent_id,
                "pid": conn.get("pid"),
                "process_name": conn.get("name") or conn.get("process_name"),
                "username": conn.get("username"),
                "laddr": conn.get("local_addr") or conn.get("laddr"),
                "lport": conn.get("local_port") or conn.get("lport"),
                "raddr": conn.get("remote_addr") or conn.get("raddr"),
                "rport": conn.get("remote_port") or conn.get("rport"),
                "protocol": (conn.get("protocol") or "").upper(),
                "state": conn.get("state"),
                "updated_at": updated_at,
            }
        )

    summary.sort(key=lambda item: (item.get("lport") or 0, item.get("pid") or 0))
    if limit is not None and limit > 0:
        summary = summary[:limit]
    return summary


def _tool_agents_list(args: Dict[str, Any], request: Any | None = None) -> Any:
    from apps.agents.views import AgentListView

    params = {
        "status": args.get("status"),
        "tag": args.get("tag"),
        "q": args.get("search") or args.get("query"),
    }
    limit_arg = args.get("limit")
    if limit_arg is not None:
        try:
            limit_int = max(1, min(int(limit_arg), 500))
            params["limit"] = str(limit_int)
        except (TypeError, ValueError):
            pass
    result = _call_ops_view(
        AgentListView,
        request,
        path="/api/v1/agents/",
        params=params,
    )

    if isinstance(result, dict) and "error" in result:
        return result
    if not isinstance(result, list):
        return {"error": "Unexpected response from agents API"}

    agents = result
    total = len(agents)
    limit_raw = args.get("limit", 200)
    applied_limit = None
    truncated = False

    try:
        limit_val = int(limit_raw)
    except (TypeError, ValueError):
        limit_val = None

    if limit_val is not None and limit_val > 0:
        applied_limit = min(limit_val, 500)
        if total > applied_limit:
            truncated = True
        agents = agents[:applied_limit]

    return {
        "agents": agents,
        "total": total,
        "limit": applied_limit,
        "truncated": truncated,
    }


def _tool_ops_docker_containers(args: Dict[str, Any], request: Any | None = None) -> Any:
    from apps.operations.views import DockerContainerListView

    params = {
        "state": args.get("state"),
        "q": args.get("search"),
        "limit": min(int(args.get("limit", 200)), 500),
    }
    result = _call_ops_view(
        DockerContainerListView,
        request,
        path=f"/api/v1/operations/docker/agents/{args['agent_id']}/containers/",
        params=params,
        agent_id=args["agent_id"],
    )
    containers: list
    if isinstance(result, dict) and "error" in result:
        return result
    if isinstance(result, list):
        containers = result
    elif isinstance(result, dict) and isinstance(result.get("results"), list):
        containers = result["results"]
    else:
        containers = []

    if not containers:
        fallback = _containers_from_metrics(args.get("agent_id"))
        if fallback:
            ai_logger.info(
                "ai.tool.metrics_fallback",
                extra={
                    "tool": "ops_docker_containers",
                    "agent_id": args.get("agent_id"),
                    "count": len(fallback),
                },
            )
            return fallback
    return containers


def _tool_ops_docker_container(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import DockerContainerDetailView
    return _call_ops_view(
        DockerContainerDetailView,
        request,
        path=f"/api/v1/operations/docker/agents/{args['agent_id']}/containers/{args['container_id']}/",
        params=None,
        agent_id=args["agent_id"],
        container_id=args["container_id"],
    )


def _tool_ops_k8s_pods(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import KubernetesPodListView
    params = {
        "namespace": args.get("namespace"),
        "phase": args.get("phase"),
        "q": None,
        "limit": min(int(args.get("limit", 200)), 500),
    }
    return _call_ops_view(
        KubernetesPodListView,
        request,
        path=f"/api/v1/operations/k8s/agents/{args['agent_id']}/pods/",
        params=params,
        agent_id=args["agent_id"],
    )


def _tool_ops_k8s_pod(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import KubernetesPodDetailView
    return _call_ops_view(
        KubernetesPodDetailView,
        request,
        path=f"/api/v1/operations/k8s/agents/{args['agent_id']}/pods/{args['uid']}/",
        params=None,
        agent_id=args["agent_id"],
        pod_uid=args["uid"],
    )


def _tool_ops_network_interfaces(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import NetworkInterfaceListView
    result = _call_ops_view(
        NetworkInterfaceListView,
        request,
        path=f"/api/v1/operations/network/agents/{args['agent_id']}/interfaces/",
        params=None,
        agent_id=args["agent_id"],
    )
    if isinstance(result, dict) and "error" in result:
        fallback = _network_interfaces_from_metrics(args.get("agent_id"))
        if fallback:
            return fallback
        return result

    interfaces: list
    if isinstance(result, list):
        interfaces = result
    elif isinstance(result, dict) and isinstance(result.get("results"), list):
        interfaces = result["results"]
    else:
        interfaces = []

    if not interfaces:
        fallback = _network_interfaces_from_metrics(args.get("agent_id"))
        if fallback:
            return fallback
    return interfaces


def _tool_ops_network_connections(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import NetworkConnectionListView
    query = """
    query($agent_id: String!, $pid: Int, $protocol: String, $state: String, $limit: Int) {
      networkConnections(agentId: $agent_id, pid: $pid, protocol: $protocol, state: $state, limit: $limit) {
        agentId
        pid
        processName
        laddr
        lport
        raddr
        rport
        protocol
        state
        updatedAt
      }
    }
    """
    params = {
        "pid": args.get("pid"),
        "protocol": args.get("protocol"),
        "state": args.get("state"),
        "limit": min(int(args.get("limit", 200)), 1000),
    }
    result = _call_ops_view(
        NetworkConnectionListView,
        request,
        path=f"/api/v1/operations/network/agents/{args['agent_id']}/connections/",
        params=params,
        agent_id=args["agent_id"],
    )
    if isinstance(result, dict) and "error" in result:
        fallback = _network_connections_from_metrics(
            args.get("agent_id"),
            protocol=args.get("protocol"),
            state=args.get("state"),
            pid=args.get("pid"),
            limit=params["limit"],
        )
        if fallback:
            return fallback
        return result

    connections: list
    if isinstance(result, list):
        connections = result
    elif isinstance(result, dict) and isinstance(result.get("results"), list):
        connections = result["results"]
    else:
        connections = []

    if not connections:
        fallback = _network_connections_from_metrics(
            args.get("agent_id"),
            protocol=args.get("protocol"),
            state=args.get("state"),
            pid=args.get("pid"),
            limit=params["limit"],
        )
        if fallback:
            return fallback

    return connections


def _tool_ops_processes(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import ProcessSnapshotListView
    limit = min(int(args.get("limit", 200)), 1000)
    params = {
        "q": args.get("search"),
        "limit": limit,
    }
    result = _call_ops_view(
        ProcessSnapshotListView,
        request,
        path=f"/api/v1/operations/processes/agents/{args['agent_id']}/",
        params=params,
        agent_id=args["agent_id"],
    )
    if isinstance(result, dict) and "error" in result:
        fallback = _processes_from_metrics(args.get("agent_id"), args.get("search"), limit)
        if fallback:
            ai_logger.info(
                "ai.tool.metrics_fallback",
                extra={
                    "tool": "ops_processes",
                    "agent_id": args.get("agent_id"),
                    "count": len(fallback),
                },
            )
            return fallback
        return result

    if isinstance(result, dict) and isinstance(result.get("results"), list):
        processes = result["results"]
    elif isinstance(result, list):
        processes = result
    else:
        processes = []

    if not processes:
        fallback = _processes_from_metrics(args.get("agent_id"), args.get("search"), limit)
        if fallback:
            ai_logger.info(
                "ai.tool.metrics_fallback",
                extra={
                    "tool": "ops_processes",
                    "agent_id": args.get("agent_id"),
                    "count": len(fallback),
                },
            )
            return fallback
    return processes


def _tool_ops_process(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import ProcessSnapshotDetailView
    query = """
    query($agent_id: String!, $pid: Int!) {
      process(agentId: $agent_id, pid: $pid) {
        agentId
        pid
        name
        cpuPct
        memPct
        cmdline
        updatedAt
      }
    }
    """
    return _call_ops_view(
        ProcessSnapshotDetailView,
        request,
        path=f"/api/v1/operations/processes/agents/{args['agent_id']}/{args['pid']}/",
        params=None,
        agent_id=args["agent_id"],
        pid=args["pid"],
    )


def _tool_ops_process_connections(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    from apps.operations.views import ProcessConnectionsView
    query = """
    query($agent_id: String!, $pid: Int!) {
      processConnections(agentId: $agent_id, pid: $pid) {
        agentId
        pid
        laddr
        lport
        raddr
        rport
        protocol
        state
        updatedAt
      }
    }
    """
    return _call_ops_view(
        ProcessConnectionsView,
        request,
        path=f"/api/v1/operations/processes/agents/{args['agent_id']}/{args['pid']}/connections/",
        params=None,
        agent_id=args["agent_id"],
        pid=args["pid"],
    )


def _tool_metrics_query(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    query = """
    query($agent_id: String!, $metric_type: String!, $start: DateTime, $end: DateTime, $resolution: String, $limit: Int) {
      metrics(agentId: $agent_id, metricType: $metric_type, start: $start, end: $end, resolution: $resolution, limit: $limit) {
        agentId
        metricType
        timestamp
        data
      }
    }
    """
    return _execute_graphql(query, {
        "agent_id": args["agent_id"],
        "metric_type": args["metric_type"],
        "start": args.get("start"),
        "end": args.get("end"),
        "resolution": args.get("resolution"),
        "limit": min(int(args.get("limit", 500)), 2000),
    }, request=request)


def _tool_metrics_latest(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    query = """
    query($agent_id: String!) {
      latestMetrics(agentId: $agent_id) {
        agentId
        metricType
        timestamp
        data
      }
    }
    """
    return _execute_graphql(query, {"agent_id": args["agent_id"]}, request=request)


def _tool_logs_query(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    query = """
    query($agent_id: String!, $severity: String, $source: String, $search: String, $start: DateTime, $end: DateTime, $limit: Int) {
      logs(agentId: $agent_id, severity: $severity, source: $source, search: $search, start: $start, end: $end, limit: $limit) {
        id
        agentId
        source
        severity
        message
        timestamp
      }
    }
    """
    return _execute_graphql(query, {
        "agent_id": args["agent_id"],
        "severity": args.get("severity"),
        "source": args.get("source"),
        "search": args.get("search"),
        "start": args.get("start"),
        "end": args.get("end"),
        "limit": min(int(args.get("limit", 500)), 2000),
    }, request=request)


def _tool_audit_logs(args: Dict[str, Any], request: Any | None = None) -> Dict[str, Any]:
    query = """
    query($user: String, $action: String, $resource: String, $success: Boolean, $start: DateTime, $end: DateTime, $limit: Int) {
      auditLogs(user: $user, action: $action, resource: $resource, success: $success, start: $start, end: $end, limit: $limit) {
        id
        timestamp
        user
        action
        resource
        success
        details
      }
    }
    """
    return _execute_graphql(query, {
        "user": args.get("user"),
        "action": args.get("action"),
        "resource": args.get("resource"),
        "success": args.get("success"),
        "start": args.get("start"),
        "end": args.get("end"),
        "limit": min(int(args.get("limit", 500)), 2000),
    }, request=request)


TOOL_SPECS = [
    {
        "type": "function",
        "function": {
            "name": "fetch_data",
            "description": "Fetch JSON data from an internal endpoint with optional query/body and auth token.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "Full URL to call"},
                    "params": {"type": "object", "description": "Query/body params"},
                    "method": {"type": "string", "enum": ["GET", "POST", "PUT", "PATCH"], "default": "GET"},
                    "token": {"type": "string", "description": "Bearer token"},
                    "timeout": {"type": "integer", "default": 10},
                    "max_bytes": {"type": "integer", "default": 2000000},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_code",
            "description": "Execute Python code in sandbox with provided JSON input.",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string"},
                    "input_data": {"type": "object", "default": {}},
                    "image": {"type": "string", "description": "Sandbox image tag"},
                    "timeout_s": {"type": "integer", "default": 15},
                    "mem_limit": {"type": "string", "default": "256m"},
                    "cpu_quota": {"type": "integer", "default": 50000},
                    "retries": {"type": "integer", "default": 1},
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agents_list",
            "description": "List registered agents with optional filters.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "description": "Filter by agent status"},
                    "tag": {"type": "string", "description": "Filter by tag"},
                    "search": {"type": "string", "description": "Filter by hostname, agent_id, OS, or tag"},
                    "limit": {"type": "integer", "default": 200, "description": "Maximum agents to return (<=500)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_docker_containers",
            "description": "List docker containers for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "state": {"type": "string"},
                    "search": {"type": "string"},
                    "limit": {"type": "integer", "default": 200},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_docker_container",
            "description": "Get docker container detail for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "container_id": {"type": "string"},
                },
                "required": ["agent_id", "container_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_k8s_pods",
            "description": "List Kubernetes pods for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "namespace": {"type": "string"},
                    "phase": {"type": "string"},
                    "limit": {"type": "integer", "default": 200},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_k8s_pod",
            "description": "Get Kubernetes pod detail for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "uid": {"type": "string"},
                },
                "required": ["agent_id", "uid"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_network_interfaces",
            "description": "List network interfaces for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_network_connections",
            "description": "List network connections for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "pid": {"type": "integer"},
                    "protocol": {"type": "string"},
                    "state": {"type": "string"},
                    "limit": {"type": "integer", "default": 200},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_processes",
            "description": "List processes for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "search": {"type": "string"},
                    "limit": {"type": "integer", "default": 200},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_process",
            "description": "Get process detail for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "pid": {"type": "integer"},
                },
                "required": ["agent_id", "pid"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ops_process_connections",
            "description": "List connections for a process on an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "pid": {"type": "integer"},
                },
                "required": ["agent_id", "pid"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "metrics_query",
            "description": "Query metrics for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "metric_type": {"type": "string"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                    "resolution": {"type": "string"},
                    "limit": {"type": "integer", "default": 500},
                },
                "required": ["agent_id", "metric_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "metrics_latest",
            "description": "Get latest metrics per type for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "logs_query",
            "description": "Query logs for an agent.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_id": {"type": "string"},
                    "severity": {"type": "string"},
                    "source": {"type": "string"},
                    "search": {"type": "string"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                    "limit": {"type": "integer", "default": 500},
                },
                "required": ["agent_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "audit_logs",
            "description": "Query audit logs (admin/moderator only).",
            "parameters": {
                "type": "object",
                "properties": {
                    "user": {"type": "string"},
                    "action": {"type": "string"},
                    "resource": {"type": "string"},
                    "success": {"type": "boolean"},
                    "start": {"type": "string"},
                    "end": {"type": "string"},
                    "limit": {"type": "integer", "default": 500},
                },
                "required": [],
            },
        },
    },
]


TOOL_FN_MAP: Dict[str, ToolFn] = {
    "fetch_data": _tool_fetch_data,
    "run_code": _tool_run_code,
    "agents_list": _tool_agents_list,
    "ops_docker_containers": _tool_ops_docker_containers,
    "ops_docker_container": _tool_ops_docker_container,
    "ops_k8s_pods": _tool_ops_k8s_pods,
    "ops_k8s_pod": _tool_ops_k8s_pod,
    "ops_network_interfaces": _tool_ops_network_interfaces,
    "ops_network_connections": _tool_ops_network_connections,
    "ops_processes": _tool_ops_processes,
    "ops_process": _tool_ops_process,
    "ops_process_connections": _tool_ops_process_connections,
    "metrics_query": _tool_metrics_query,
    "metrics_latest": _tool_metrics_latest,
    "logs_query": _tool_logs_query,
    "audit_logs": _tool_audit_logs,
}


def execute_tool(name: str, arguments_json: str, request: Any | None = None) -> Any:
    fn = TOOL_FN_MAP.get(name)
    if not fn:
        raise ValueError(f"Unknown tool {name}")

    args = json.loads(arguments_json or "{}")
    redacted = _redact(args)
    ai_logger.info(
        "ai.tool.call",
        extra={
            "tool": name,
            "tool_args": redacted,
            "agent_id": args.get("agent_id") or args.get("agentId"),
        },
    )

    try:
        result = fn(args, request)
        count: int | None = None
        if isinstance(result, list):
            count = len(result)
        elif isinstance(result, dict):
            containers_val = result.get("containers")
            agents_val = result.get("agents")
            if isinstance(containers_val, list):
                count = len(containers_val)
            elif isinstance(agents_val, list):
                count = len(agents_val)
        ai_logger.info(
            "ai.tool.result",
            extra={
                "tool": name,
                "tool_args": redacted,
                "agent_id": args.get("agent_id") or args.get("agentId"),
                "status": result.get("status") if isinstance(result, dict) else None,
                "error": result.get("error") if isinstance(result, dict) else None,
                "count": count,
            },
        )
        return result
    except Exception as exc:
        ai_logger.error(
            "ai.tool.error",
            extra={
                "tool": name,
                "agent_id": args.get("agent_id") or args.get("agentId"),
                "error": str(exc),
            },
        )
        raise
