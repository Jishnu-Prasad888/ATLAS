"""High-level entry to run OpenAI commander with tool-calling."""

from __future__ import annotations

from typing import Any, Dict, List

from .runtime import run_commander


def run_commander_for_messages(
    messages: List[Dict[str, Any]],
    api_key: str | None = None,
    request: Any | None = None,
    provider: str = "openai",
    model: str | None = None,
    base_url: str | None = None,
) -> List[Dict[str, Any]]:
    kwargs: Dict[str, Any] = {
        "api_key": api_key,
        "request": request,
        "provider": provider,
        "base_url": base_url,
    }
    if model:
        kwargs["model"] = model
    return run_commander(messages, **kwargs)


def run_commander_for_question(
    question: str,
    api_key: str | None = None,
    request: Any | None = None,
    provider: str = "openai",
    model: str | None = None,
    base_url: str | None = None,
) -> List[Dict[str, Any]]:
    messages = [{"role": "user", "content": question}]
    return run_commander_for_messages(
        messages,
        api_key=api_key,
        request=request,
        provider=provider,
        model=model,
        base_url=base_url,
    )
