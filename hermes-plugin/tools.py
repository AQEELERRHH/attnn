"""Tool handlers. Every handler returns a JSON string; failures are {"ok": false, "error": ...}.

Money rules (all enforced here, not left to the model):
  * bids, read-balance deposits and refunds go through Hermes's approval prompt (the
    pre_tool_call hook in __init__.py), so they fail closed in unattended runs;
  * a bid is never above `max_bid_usd`, and bids + profile reads never take today's spend
    past `daily_budget_usd`;
  * USDC is only ever approved to the network's known Attnn. escrow (or the Gateway wallet
    for deposits), for exactly the amount being spent, and the calldata Attnn.'s API returns
    is checked against the bid before anything is signed.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import quote, urlencode

from eth_account import Account

from . import chain, net, x402
from .config import (
    ESCROW_MAX_BID,
    PROFILE_READ_PRICE,
    Settings,
    fmt_usd,
    read_private_key,
    usd_to_atomic,
)
from .store import BudgetExceeded, Store

HANDLE_RE = re.compile(r"^[a-z0-9_.-]{1,64}$")
BID_ID_RE = re.compile(r"^[A-Za-z0-9-]{8,64}$")
GAS_MARGIN = 50_000  # $0.05 kept for Arc fees (gas is paid in USDC)
SEL_PLACE_BID = chain.selector("placeBid(address,uint256,bytes32)")


class ToolError(Exception):
    pass


def ok(**data: Any) -> str:
    return json.dumps({"ok": True, **data}, default=str)


def fail(message: str, **data: Any) -> str:
    return json.dumps({"ok": False, "error": message, **data}, default=str)


def _handle(value: Any) -> str:
    handle = str(value or "").strip().lstrip("@").lower()
    if not HANDLE_RE.match(handle):
        raise ToolError("Give a creator handle like 'emdee002' (letters, numbers, _ . -).")
    return handle


def _amount(value: Any) -> int:
    try:
        return usd_to_atomic(value)
    except ValueError as exc:
        raise ToolError(str(exc)) from exc


class Attnn:
    def __init__(self, settings_fn: Callable[[], Settings], store: Store, key_fn: Callable[[], str | None] = read_private_key):
        self._settings_fn = settings_fn
        self.store = store
        self._key_fn = key_fn

    # helpers -------------------------------------------------------------------------------

    @property
    def settings(self) -> Settings:
        try:
            return self._settings_fn()
        except ValueError as exc:
            raise ToolError(f"Attnn. plugin settings: {exc}") from exc

    def _key(self) -> str:
        try:
            key = self._key_fn()
        except ValueError as exc:
            raise ToolError(str(exc)) from exc
        if not key:
            raise ToolError("No agent wallet: set ATTNN_AGENT_PRIVATE_KEY (a dedicated, low-balance wallet).")
        return key

    def _rpc(self, s: Settings) -> chain.Rpc:
        return chain.Rpc(s.network.rpc_url, s.network.chain_id)

    def _url(self, path: str) -> str:
        return self.settings.base_url + path

    def _remaining(self, s: Settings) -> int:
        return max(s.daily_budget - self.store.spent_today(), 0)

    def run(self, fn: Callable[[dict[str, Any]], str], args: dict[str, Any]) -> str:
        try:
            return fn(args or {})
        except ToolError as exc:
            return fail(str(exc))
        except BudgetExceeded:
            s = self.settings
            return fail(f"That would go over today's budget ({fmt_usd(s.daily_budget)}; {fmt_usd(self._remaining(s))} left).")
        except x402.PaymentRefused as exc:
            return fail(f"Payment refused: {exc}")
        except chain.ChainError as exc:
            return fail(str(exc))
        except OSError as exc:  # network trouble (urllib raises URLError, a subclass)
            return fail(f"Network error: {exc}")

    # free tools ----------------------------------------------------------------------------

    def find_creators(self, args: dict[str, Any]) -> str:
        limit = int(args.get("limit") or 20)
        query = {"limit": max(1, min(limit, 100))}
        if args.get("tag"):
            query["tag"] = str(args["tag"]).strip().lower()
        resp = net.request("GET", self._url("/api/v1/creators?" + urlencode(query)))
        if resp.status != 200 or not isinstance(resp.body, dict):
            raise ToolError(f"Couldn't list creators: {resp.error}")
        creators = [
            {
                "handle": c.get("handle"),
                "tags": c.get("tags"),
                "floor": fmt_usd(c.get("floor", 0)),
                "availability": c.get("availability"),
                "verified": c.get("verified"),
                "market": f"{self.settings.base_url}/c/{c.get('handle')}",
            }
            for c in resp.body.get("creators") or []
        ]
        return ok(count=len(creators), creators=creators)

    def wallet_status(self, args: dict[str, Any]) -> str:
        s = self.settings
        address = Account.from_key(self._key()).address
        rpc = self._rpc(s)
        usdc = rpc.usdc_balance(s.network.usdc, address)
        reads = x402.gateway_balance(s.network, address)
        return ok(
            network=s.network.name,
            address=address,
            usdc_balance=fmt_usd(usdc),
            read_balance=fmt_usd(reads) if reads is not None else "unknown (Gateway didn't answer)",
            spent_today=fmt_usd(self.store.spent_today()),
            daily_budget=fmt_usd(s.daily_budget),
            max_bid=fmt_usd(s.max_bid),
            explorer=f"{s.network.explorer}/address/{address}",
        )

    def bid_status(self, args: dict[str, Any]) -> str:
        bid_id = str(args.get("bid_id") or "").strip()
        row = self.store.bid(bid_id) if BID_ID_RE.match(bid_id) else None
        if not row:
            raise ToolError("Unknown bid id: use attnn_list_bids to see this agent's bids.")
        view = self._fetch_bid(bid_id, row)
        return ok(bid=self._public(bid_id, self.store.save_bid(bid_id, **view)))

    def list_bids(self, args: dict[str, Any]) -> str:
        rows = sorted(self.store.bids().items(), key=lambda kv: kv[1].get("created", ""), reverse=True)
        return ok(count=len(rows), bids=[self._public(i, r) for i, r in rows])

    # paid tools ----------------------------------------------------------------------------

    def read_profile(self, args: dict[str, Any]) -> str:
        handle = _handle(args.get("handle"))
        profile, paid = self._read_profile(handle)
        return ok(profile=profile, **paid)

    def _read_profile(self, handle: str) -> tuple[dict[str, Any], dict[str, Any]]:
        s = self.settings
        key = self._key()
        self.store.reserve(PROFILE_READ_PRICE, s.daily_budget)
        try:
            result = x402.get_paid(self._url(f"/api/c/{quote(handle)}"), key, s.network, PROFILE_READ_PRICE)
        except BaseException:
            self.store.release(PROFILE_READ_PRICE)
            raise
        if result.amount == 0 or result.replay:
            self.store.release(PROFILE_READ_PRICE)  # free (cached, signed-in) or a replay: nothing new spent
        resp = result.response
        if resp.status == 404:
            raise ToolError(f"No creator @{handle} on Attnn.")
        if resp.status != 200 or not isinstance(resp.body, dict) or not isinstance(resp.body.get("profile"), dict):
            hint = " Top up the read balance with attnn_fund_reads." if resp.status in (400, 402) else ""
            raise ToolError(f"Couldn't read @{handle}: {resp.error}.{hint}")
        p = resp.body["profile"]
        profile = {
            "handle": p.get("handle"),
            "bio": p.get("bio"),
            "tags": p.get("tags"),
            "open_to": p.get("openTo"),
            "availability": p.get("availabilityStatus"),
            "floor": fmt_usd(p.get("minBid", 0)),
            "floor_atomic": str(p.get("minBid", "0")),
            "live": p.get("isActive"),
            "verified": p.get("verified"),
            "market": f"{s.base_url}{p.get('market') or '/c/' + handle}",
        }
        paid = {"paid": fmt_usd(result.amount) if result.amount and not result.replay else "$0 (already read)", "receipt": result.transaction}
        return profile, paid

    def fund_reads(self, args: dict[str, Any]) -> str:
        s = self.settings
        amount = _amount(args.get("amount_usd"))
        if amount <= 0:
            raise ToolError("Give an amount above $0.")
        if amount > s.max_deposit:
            raise ToolError(f"Top-ups are capped at {fmt_usd(s.max_deposit)} (setting max_deposit_usd).")
        account = Account.from_key(self._key())
        rpc = self._rpc(s)
        rpc.check_chain()
        balance = rpc.usdc_balance(s.network.usdc, account.address)
        if balance < amount + GAS_MARGIN:
            raise ToolError(f"The agent wallet holds {fmt_usd(balance)}: not enough for {fmt_usd(amount)} plus Arc fees.")
        approve = rpc.send(account, s.network.usdc, chain.calldata(chain.SEL_APPROVE, s.network.gateway_wallet, amount))
        rpc.wait(approve)
        deposit = rpc.send(account, s.network.gateway_wallet, chain.calldata(chain.SEL_GATEWAY_DEPOSIT, s.network.usdc, amount), gas_floor=120_000)
        rpc.wait(deposit)
        return ok(deposited=fmt_usd(amount), approve_tx=approve, deposit_tx=deposit, note="Gateway can take a minute to show the new balance.")

    def place_bid(self, args: dict[str, Any]) -> str:
        s = self.settings
        handle = _handle(args.get("handle"))
        message = str(args.get("message") or "")
        if len(message) > 2000:
            raise ToolError("Messages are at most 2,000 characters.")
        if not s.network.escrow:
            raise ToolError("Set testnet_escrow (the Attnn. escrow address) before bidding on testnet.")
        account = Account.from_key(self._key())

        # 1. Read the profile from this wallet: Attnn. needs it as proof the wallet is ours.
        profile, _ = self._read_profile(handle)
        floor = int(profile["floor_atomic"])
        if not profile.get("live") or profile.get("availability") == "not_accepting":
            raise ToolError(f"@{handle} isn't accepting bids right now.")
        amount = floor if args.get("amount_usd") in (None, "") else _amount(args["amount_usd"])
        if amount < floor:
            raise ToolError(f"@{handle}'s floor is {fmt_usd(floor)}; bid at least that.")
        if amount > min(s.max_bid, ESCROW_MAX_BID):
            raise ToolError(f"{fmt_usd(amount)} is above the per-bid cap of {fmt_usd(s.max_bid)} (setting max_bid_usd).")

        rpc = self._rpc(s)
        rpc.check_chain()
        balance = rpc.usdc_balance(s.network.usdc, account.address)
        if balance < amount + GAS_MARGIN:
            raise ToolError(f"The agent wallet holds {fmt_usd(balance)}: not enough for {fmt_usd(amount)} plus Arc fees.")

        # 2. Count it against today's budget before anything is signed.
        self.store.reserve(amount, s.daily_budget)
        sent_any = False
        try:
            idem = hashlib.sha256(f"{account.address}|{handle}|{amount}|{message}|{uuid.uuid4()}".encode()).hexdigest()
            resp = net.request(
                "POST",
                self._url("/api/v1/bids"),
                json_body={"handle": handle, "amount": str(amount), "bidder": account.address, "message": message or None},
                headers={"Idempotency-Key": idem},
            )
            if resp.status != 201 or not isinstance(resp.body, dict):
                raise ToolError(f"Attnn. refused the bid: {resp.error}")
            intent = resp.body
            approve_call, place_call = self._checked_calls(intent, amount, s)
            bid_id = str(intent["id"])
            self.store.save_bid(
                bid_id,
                token=intent["accessToken"],
                handle=handle,
                amount=str(amount),
                escrow=intent["escrow"],
                status="waiting",
                created=datetime.now(timezone.utc).isoformat(),
            )

            # 3. Send approve, then placeBid, from the agent's own wallet.
            sent_any = True
            approve_tx = rpc.send(account, approve_call["to"], approve_call["data"])
            rpc.wait(approve_tx)
            place_tx = rpc.send(account, place_call["to"], place_call["data"], gas_floor=200_000)
            self.store.save_bid(bid_id, place_tx=place_tx)
            rpc.wait(place_tx)
        except BaseException:
            if not sent_any:
                self.store.release(amount)
            raise

        # 4. Confirm (the escrow's BidPlaced event records it anyway within a minute).
        confirm = net.request(
            "POST",
            self._url(f"/api/v1/bids/{quote(bid_id)}/confirm"),
            json_body={"txHash": place_tx},
            headers={"Authorization": f"Bearer {intent['accessToken']}"},
        )
        view = self._view(confirm.body.get("bid") if confirm.status == 409 and isinstance(confirm.body, dict) else confirm.body)
        row = self.store.save_bid(bid_id, **view)
        return ok(
            bid=self._public(bid_id, row),
            approve_tx=approve_tx,
            place_tx=place_tx,
            explorer=f"{s.network.explorer}/tx/{place_tx}",
            rules="Paid to the creator only if they reply; a decline refunds at once; no reply in 3 days: claim it back with attnn_claim_refund.",
        )

    def claim_refund(self, args: dict[str, Any]) -> str:
        s = self.settings
        bid_id = str(args.get("bid_id") or "").strip()
        row = self.store.bid(bid_id) if BID_ID_RE.match(bid_id) else None
        if not row:
            raise ToolError("Unknown bid id: use attnn_list_bids to see this agent's bids.")
        view = self._fetch_bid(bid_id, row)
        row = self.store.save_bid(bid_id, **view)
        if row.get("status") not in ("pending", "counter_offered"):
            raise ToolError(f"Nothing to claim: the bid is {row.get('status')}.")
        after = row.get("refundable_after")
        if not after or datetime.fromisoformat(str(after).replace("Z", "+00:00")) > datetime.now(timezone.utc):
            raise ToolError(f"Not refundable yet (refundable after {after}).")
        if str(row.get("escrow", "")).lower() != str(s.network.escrow or "").lower():
            raise ToolError("This bid is in an escrow this plugin doesn't know; claim it from the explorer.")
        account = Account.from_key(self._key())
        rpc = self._rpc(s)
        rpc.check_chain()
        tx = rpc.send(account, row["escrow"], chain.calldata(chain.SEL_CLAIM_REFUND, int(row["on_chain_bid_id"])))
        rpc.wait(tx)
        self.store.save_bid(bid_id, refund_tx=tx)
        return ok(refunded=fmt_usd(row["amount"]), tx=tx, note="Attnn. marks the bid refunded once it reads the escrow.")

    # internals -----------------------------------------------------------------------------

    def _checked_calls(self, intent: dict[str, Any], amount: int, s: Settings) -> tuple[dict[str, Any], dict[str, Any]]:
        """Refuse to sign anything but approve(escrow, amount) + placeBid(_, amount, messageHash)."""
        calls = intent.get("calls")
        escrow = str(intent.get("escrow", "")).lower()
        if escrow != str(s.network.escrow).lower():
            raise ToolError(f"Attnn. named an unexpected escrow ({intent.get('escrow')}); not signing.")
        if not isinstance(calls, list) or len(calls) != 2:
            raise ToolError("Unexpected transactions from Attnn.; not signing.")
        approve, place = calls
        want_approve = chain.calldata(chain.SEL_APPROVE, s.network.escrow, amount)
        if str(approve.get("to", "")).lower() != s.network.usdc.lower() or str(approve.get("data", "")).lower() != want_approve.lower():
            raise ToolError("The approve call doesn't match this bid; not signing.")
        data = str(place.get("data", "")).lower()
        message_hash = str(intent.get("messageHash", "")).lower().removeprefix("0x")
        if (
            str(place.get("to", "")).lower() != escrow
            or not data.startswith(SEL_PLACE_BID)
            or len(data) != 10 + 64 * 3
            or int(data[10 + 64 : 10 + 128], 16) != amount
            or data[10 + 128 :] != message_hash
            or int(str(intent.get("amount", "-1"))) != amount
        ):
            raise ToolError("The placeBid call doesn't match this bid; not signing.")
        if any(str(c.get("value", "0")) not in ("0", "0x0") for c in calls):
            raise ToolError("Attnn. asked to send native value; not signing.")
        return approve, place

    def _fetch_bid(self, bid_id: str, row: dict[str, Any]) -> dict[str, Any]:
        resp = net.request("GET", self._url(f"/api/v1/bids/{quote(bid_id)}"), headers={"Authorization": f"Bearer {row['token']}"})
        if resp.status != 200 or not isinstance(resp.body, dict):
            raise ToolError(f"Couldn't read the bid: {resp.error}")
        return self._view(resp.body)

    @staticmethod
    def _view(body: Any) -> dict[str, Any]:
        if not isinstance(body, dict):
            return {}
        out = {
            "status": body.get("status"),
            "on_chain_bid_id": body.get("onChainBidId"),
            "refundable_after": body.get("refundableAfter"),
            "reply": body.get("reply"),
        }
        return {k: v for k, v in out.items() if v is not None or k == "reply"}

    @staticmethod
    def _public(bid_id: str, row: dict[str, Any]) -> dict[str, Any]:
        """A bid as the model may see it: everything but the access token."""
        return {
            "bid_id": bid_id,
            "handle": row.get("handle"),
            "amount": fmt_usd(row.get("amount", 0)),
            "status": row.get("status"),
            "refundable_after": row.get("refundable_after"),
            "reply": row.get("reply"),
            "place_tx": row.get("place_tx"),
            "created": row.get("created"),
        }
