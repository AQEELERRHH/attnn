"""Small stdlib HTTP client: JSON in, JSON out, no redirects followed, bounded bodies."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any

MAX_BODY = 256_000
TIMEOUT = 30
USER_AGENT = "attnn-hermes-plugin/0.1.0"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args: Any, **kwargs: Any) -> None:  # noqa: D401
        return None  # never follow: a redirect could carry a payment header elsewhere


_opener = urllib.request.build_opener(_NoRedirect)


@dataclass
class Response:
    status: int
    headers: dict[str, str] = field(default_factory=dict)
    body: Any = None  # parsed JSON, or text when not JSON

    def header(self, name: str) -> str | None:
        return self.headers.get(name.lower())

    @property
    def error(self) -> str:
        if isinstance(self.body, dict) and self.body.get("error"):
            return str(self.body["error"])
        return f"HTTP {self.status}"


def request(
    method: str,
    url: str,
    *,
    json_body: Any = None,
    headers: dict[str, str] | None = None,
    timeout: float = TIMEOUT,
) -> Response:
    data = None
    hdrs = {"Accept": "application/json", "User-Agent": USER_AGENT, **(headers or {})}
    if json_body is not None:
        data = json.dumps(json_body).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with _opener.open(req, timeout=timeout) as resp:
            return _read(resp.status, resp.headers, resp.read(MAX_BODY))
    except urllib.error.HTTPError as err:
        return _read(err.code, err.headers, err.read(MAX_BODY) if err.fp else b"")


def _read(status: int, headers: Any, raw: bytes) -> Response:
    text = raw.decode("utf-8", errors="replace")
    try:
        body: Any = json.loads(text) if text else None
    except json.JSONDecodeError:
        body = text
    return Response(status=status, headers={k.lower(): v for k, v in (headers or {}).items()}, body=body)
