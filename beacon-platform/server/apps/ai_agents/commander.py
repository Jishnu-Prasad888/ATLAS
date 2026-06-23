"""High-level entry to run OpenAI commander with tool-calling."""

from __future__ import annotations

from typing import Any, Dict, List

from .runtime import run_commander


def run_commander_for_messages(
    messages: List[Dict[str, Any]],
    api_key: str | None = None,
    request: Any | None = None,
) -> List[Dict[str, Any]]:
    return run_commander(messages, api_key=api_key, request=request)


def run_commander_for_question(
    question: str,
    api_key: str | None = None,
    request: Any | None = None,
) -> List[Dict[str, Any]]:
    messages = [{"role": "user", "content": question}]
    return run_commander_for_messages(messages, api_key=api_key, request=request)
