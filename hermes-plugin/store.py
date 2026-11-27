"""Plugin state: today's spend ledger and the bids this agent placed (with their access tokens).

Backed by Hermes's `ctx.state` (profile-scoped, atomically replaced). Access tokens let the
agent read a bid's status and the creator's reply; they can't move money. They never leave
this store: tools refer to bids by id only.
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Protocol


class StateLike(Protocol):
    def get(self, key: str, default: Any = None) -> Any: ...
    def set(self, key: str, value: Any) -> None: ...


class BudgetExceeded(RuntimeError):
    pass


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


class Store:
    def __init__(self, state: StateLike):
        self.state = state
        self._lock = threading.Lock()

    # spend ledger -------------------------------------------------------------------------

    def spent_today(self) -> int:
        ledger = self.state.get("ledger", default=None) or {}
        return int(ledger.get("spent", 0)) if ledger.get("day") == _today() else 0

    def reserve(self, amount: int, budget: int) -> None:
        """Count `amount` against today's budget, or raise BudgetExceeded."""
        with self._lock:
            spent = self.spent_today()
            if spent + amount > budget:
                raise BudgetExceeded(f"over today's budget: {spent} spent + {amount} > {budget}")
            self.state.set("ledger", {"day": _today(), "spent": str(spent + amount)})

    def release(self, amount: int) -> None:
        """Undo a reservation for spend that never happened."""
        with self._lock:
            spent = self.spent_today()
            self.state.set("ledger", {"day": _today(), "spent": str(max(spent - amount, 0))})

    # bids ---------------------------------------------------------------------------------

    def bids(self) -> dict[str, dict[str, Any]]:
        return dict(self.state.get("bids", default=None) or {})

    def bid(self, bid_id: str) -> dict[str, Any] | None:
        return self.bids().get(bid_id)

    def save_bid(self, bid_id: str, **fields: Any) -> dict[str, Any]:
        with self._lock:
            bids = self.bids()
            row = {**bids.get(bid_id, {}), **fields}
            bids[bid_id] = row
            self.state.set("bids", bids)
            return row


class MemoryState:
    """Dict-backed stand-in for ctx.state (tests, scripts)."""

    def __init__(self) -> None:
        self.data: dict[str, Any] = {}

    def get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.data[key] = value
