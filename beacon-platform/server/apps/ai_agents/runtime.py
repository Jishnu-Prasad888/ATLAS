"""OpenAI-powered incident commander orchestration with tool-calling.

This is a lightweight loop that lets the model call our internal tools
(`fetch_data`, `run_code`). It stops when the model returns a message without
tool calls or after a max turn count.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, cast

from openai import OpenAI

from .tools import TOOL_SPECS, execute_tool
from .prompts import COMMANDER_SYSTEM_PROMPT


DEFAULT_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
DEFAULT_MAX_TURNS = 6
COMMANDER_PROMPT = os.environ.get(
    "OPENAI_COMMANDER_PROMPT",
    COMMANDER_SYSTEM_PROMPT,
)


def run_commander(
    messages: List[Dict[str, Any]],
    model: str = DEFAULT_MODEL,
    max_turns: int = DEFAULT_MAX_TURNS,
    tools: Optional[List[Dict[str, Any]]] = None,
    api_key: Optional[str] = None,
    request: Any | None = None,
    provider: str = "openai",
    base_url: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Run an OpenAI chat loop with tool-calling.

    messages: list of {role, content, name?} dicts.
    Returns the full transcript including tool results.
    """

    provider_normalized = (provider or "openai").strip().lower()
    client_kwargs: Dict[str, Any] = {}

    if base_url:
        client_kwargs["base_url"] = base_url.rstrip("/")

    if provider_normalized == "local":
        if not base_url:
            raise ValueError("base_url is required when provider is 'local'")
        if not api_key:
            api_key = os.environ.get("LOCAL_OPENAI_API_KEY", "local-key")
    elif provider_normalized != "openai":
        raise ValueError(f"Unknown provider '{provider}'")

    client = OpenAI(api_key=api_key, **client_kwargs)
    tool_defs = tools or TOOL_SPECS
    turn = 0
    transcript = [
        {"role": "system", "content": COMMANDER_PROMPT},
        *messages,
    ]

    while turn < max_turns:
        turn += 1
        resp = client.chat.completions.create(
            model=model,
            messages=transcript,
            tools=cast(Any, tool_defs),
            tool_choice="auto",
            max_tokens=800,
        )

        choice = resp.choices[0]
        message = choice.message
        tool_calls_serialized = []
        if message.tool_calls:
            for tc in message.tool_calls:
                try:
                    tool_calls_serialized.append(tc.model_dump())
                except Exception:
                    tool_calls_serialized.append({"id": getattr(tc, "id", None), "function": getattr(tc, "function", None)})

        transcript.append({
            "role": "assistant",
            "content": message.content,
            "tool_calls": tool_calls_serialized,
        })

        tool_calls = message.tool_calls or []
        if not tool_calls:
            break

        # Execute tool calls in order and append results
        for tc in tool_calls:
            result = execute_tool(tc.function.name, tc.function.arguments, request=request)
            transcript.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "name": tc.function.name,
                "content": str(result),
            })

    return transcript
