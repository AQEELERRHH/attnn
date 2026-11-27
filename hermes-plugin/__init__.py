"""Attnn. plugin for Hermes Agent: reach creators by bidding USDC on Arc from your agent's own wallet."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

TOOLSET = "attnn"
KEY_ENV = "ATTNN_AGENT_PRIVATE_KEY"

# Tools that move USDC: each one goes through Hermes's human-approval gate.
SPENDING = {"attnn_place_bid", "attnn_fund_reads", "attnn_claim_refund"}


def _approval_message(attnn: Any, tool_name: str, args: dict[str, Any]) -> str:
    from .config import fmt_usd, usd_to_atomic

    try:
        s = attnn.settings
        left = fmt_usd(max(s.daily_budget - attnn.store.spent_today(), 0))
    except Exception:  # settings broken: the tool itself will report it
        return "Attnn.: this action sends a transaction from the agent wallet."
    if tool_name == "attnn_place_bid":
        handle = str(args.get("handle") or "?").lstrip("@")
        try:
            amount = fmt_usd(usd_to_atomic(args["amount_usd"])) if args.get("amount_usd") not in (None, "") else "the creator's floor"
        except (ValueError, KeyError):
            amount = str(args.get("amount_usd"))
        return (
            f"Attnn.: bid {amount} USDC on @{handle} from the agent wallet ({s.network.name}). "
            f"Escrowed: paid only if they reply, refundable after 3 days. "
            f"Cap {fmt_usd(s.max_bid)} per bid; {left} of today's budget left."
        )
    if tool_name == "attnn_fund_reads":
        return f"Attnn.: move {args.get('amount_usd')} USDC from the agent wallet into its profile-read balance (Circle Gateway)."
    return f"Attnn.: claim back unanswered bid {args.get('bid_id')} (one Arc transaction from the agent wallet)."


def register(ctx: Any) -> None:
    from . import schemas
    from .config import load_settings
    from .store import Store
    from .tools import Attnn

    attnn = Attnn(lambda: load_settings(ctx.get_config), Store(ctx.state))

    tools = [
        ("attnn_find_creators", schemas.FIND_CREATORS, attnn.find_creators, False, "🔎"),
        ("attnn_read_profile", schemas.READ_PROFILE, attnn.read_profile, True, "👤"),
        ("attnn_wallet_status", schemas.WALLET_STATUS, attnn.wallet_status, True, "👛"),
        ("attnn_fund_reads", schemas.FUND_READS, attnn.fund_reads, True, "⛽"),
        ("attnn_place_bid", schemas.PLACE_BID, attnn.place_bid, True, "💸"),
        ("attnn_bid_status", schemas.BID_STATUS, attnn.bid_status, False, "📬"),
        ("attnn_list_bids", schemas.LIST_BIDS, attnn.list_bids, False, "📋"),
        ("attnn_claim_refund", schemas.CLAIM_REFUND, attnn.claim_refund, True, "↩️"),
    ]
    for name, schema, fn, needs_key, emoji in tools:
        ctx.register_tool(
            name=name,
            toolset=TOOLSET,
            schema=schema,
            handler=lambda args, _fn=fn, **_kw: attnn.run(_fn, args),
            requires_env=[KEY_ENV] if needs_key else [],
            description=schema["description"].split(".")[0],
            emoji=emoji,
        )

    def pre_tool_call(tool_name: str = "", args: dict[str, Any] | None = None, task_id: str = "", **_kw: Any) -> dict[str, str] | None:
        if tool_name in SPENDING:
            a = args or {}
            # "Always" in the approval prompt then covers only this exact action, never every bid.
            scope = ":".join(str(a.get(k, "")) for k in ("handle", "amount_usd", "bid_id"))
            return {"action": "approve", "message": _approval_message(attnn, tool_name, a), "rule_key": f"{tool_name}:{scope}"}
        return None

    ctx.register_hook("pre_tool_call", pre_tool_call)

    # Bundled skill: when and how to use the tools.
    from pathlib import Path

    skill = Path(__file__).parent / "skills" / "attnn" / "SKILL.md"
    if skill.exists() and hasattr(ctx, "register_skill"):
        ctx.register_skill("attnn", skill)
