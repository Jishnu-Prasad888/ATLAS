"""Data fetcher tool.

Lightweight helper to fetch data from Beacon REST/GraphQL endpoints with
timeouts, retries, and response-size capping. Intended for agent pipelines.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

import requests
from requests.adapters import HTTPAdapter, Retry


DEFAULT_TIMEOUT = 10  # seconds
DEFAULT_MAX_BYTES = 2_000_000  # 2 MB response cap


def _session() -> requests.Session:
    sess = requests.Session()
    retries = Retry(total=2, backoff_factor=0.2, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retries)
    sess.mount("http://", adapter)
    sess.mount("https://", adapter)
    return sess


def fetch_data(
    url: str,
    params: Optional[Dict[str, Any]] = None,
    method: str = "GET",
    token: Optional[str] = None,
    timeout: int = DEFAULT_TIMEOUT,
    max_bytes: int = DEFAULT_MAX_BYTES,
) -> Dict[str, Any]:
    """Fetch data from an endpoint with sane defaults.

    Returns a dict: {"status": int, "data": object, "headers": dict}
    Raises requests.HTTPError on bad responses.
    """

    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    sess = _session()
    method = method.upper()

    resp = sess.request(method, url, params=params if method == "GET" else None,
                        json=params if method != "GET" else None,
                        headers=headers, timeout=timeout, stream=True)
    resp.raise_for_status()

    # Cap response body size
    content = resp.raw.read(max_bytes, decode_content=True)
    remainder = resp.raw.read(1)
    if remainder:
        # Truncated
        raise ValueError("Response too large; truncated")

    if not content:
        return {"status": resp.status_code, "data": None, "headers": dict(resp.headers)}

    try:
        data = json.loads(content.decode(resp.encoding or "utf-8"))
    except Exception:
        data = content.decode(resp.encoding or "utf-8", errors="replace")

    return {"status": resp.status_code, "data": data, "headers": dict(resp.headers)}
