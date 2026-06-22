"""LangGraph-based multi-agent incident graph.

Nodes: Commander -> DataFetcher -> CodeExecutor -> Commander (merge) -> END
State carries messages, fetch params, code, input payload, and results.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TypedDict, cast

from langgraph.graph import END, StateGraph

from .tools import TOOL_SPECS, execute_tool


class IncidentState(TypedDict, total=False):
    messages: List[Dict[str, Any]]
    fetch: Dict[str, Any]
    code: str
    input_data: Dict[str, Any]
    fetch_result: Dict[str, Any]
    exec_result: Dict[str, Any]
    timeout_s: int
    mem_limit: str
    cpu_quota: int
    retries: int


def commander_node(state: IncidentState) -> IncidentState:
    msgs = state.get("messages", [])
    summary_parts = []
    if "fetch_result" in state:
        summary_parts.append("fetch_done")
    if "exec_result" in state:
        summary_parts.append("exec_done")
    msgs = msgs + [{"role": "system", "content": ";".join(summary_parts) or "continue"}]
    return {**state, "messages": msgs}


def data_fetcher_node(state: IncidentState) -> IncidentState:
    fetch_spec = state.get("fetch") or {}
    result = execute_tool("fetch_data", json_args(fetch_spec))
    return {**state, "fetch_result": result}


def code_executor_node(state: IncidentState) -> IncidentState:
    payload = state.get("input_data")
    fetch_result = state.get("fetch_result")
    if payload is None and isinstance(fetch_result, dict):
        payload = fetch_result.get("data")
    args = {
        "code": state.get("code", ""),
        "input_data": payload or {},
        "timeout_s": state.get("timeout_s", 15),
        "mem_limit": state.get("mem_limit", "256m"),
        "cpu_quota": state.get("cpu_quota", 50_000),
        "retries": state.get("retries", 1),
    }
    result = execute_tool("run_code", json_args(args))
    return {**state, "exec_result": result}


def build_incident_graph():
    graph = StateGraph(IncidentState)
    graph.add_node("commander", commander_node)
    graph.add_node("fetcher", data_fetcher_node)
    graph.add_node("executor", code_executor_node)

    graph.set_entry_point("commander")
    graph.add_edge("commander", "fetcher")
    graph.add_edge("fetcher", "executor")
    graph.add_edge("executor", END)
    return graph.compile()


def json_args(obj: Dict[str, Any]) -> str:
    import json

    return json.dumps(obj or {})


def run_graph(
    fetch: Dict[str, Any],
    code: str,
    input_data: Optional[Dict[str, Any]] = None,
    *,
    timeout_s: int = 15,
    mem_limit: str = "256m",
    cpu_quota: int = 50_000,
    retries: int = 1,
) -> IncidentState:
    compiled = build_incident_graph()
    initial: IncidentState = {
        "messages": [],
        "fetch": fetch,
        "code": code,
        "input_data": input_data or {},
        "timeout_s": timeout_s,
        "mem_limit": mem_limit,
        "cpu_quota": cpu_quota,
        "retries": retries,
    }
    return cast(IncidentState, compiled.invoke(initial))
