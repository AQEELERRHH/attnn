from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml
from eth_account import Account
from eth_account.messages import encode_typed_data

from conftest import ESCROW, GATEWAY, KEY, USDC, FakeWorld, make_settings, plugin
from attnn_plugin import chain, config, store, tools, x402


def result(raw: str) -> dict[str, Any]:
    return json.loads(raw)


# --- money helpers -------------------------------------------------------------------------


def test_usd_to_atomic() -> None:
    assert config.usd_to_atomic("5") == 5_000_000
    assert config.usd_to_atomic(0.1) == 100_000
    assert config.usd_to_atomic("$1.000001") == 1_000_001
    for bad in ["-1", "abc", "1.0000001", "nan", "inf"]:
        with pytest.raises(ValueError):
            config.usd_to_atomic(bad)


def test_settings_caps_and_validation() -> None:
    s = make_settings(max_bid_usd=5000)()
    assert s.max_bid == config.ESCROW_MAX_BID  # never above the escrow's own maximum
    with pytest.raises(ValueError):
        make_settings(network="base")()
    with pytest.raises(ValueError):
        make_settings(base_url="http://evil.example")()
    assert make_settings(network="testnet")().network.escrow is None


def test_selectors_match_abi() -> None:
    assert chain.SEL_APPROVE == "0x095ea7b3"
    assert chain.SEL_BALANCE_OF == "0x70a08231"
    assert chain.SEL_CLAIM_REFUND == "0x5b7baf64"


# --- x402 ----------------------------------------------------------------------------------


def _option(**over: Any) -> dict[str, Any]:
    opt = {
        "scheme": "exact",
        "network": "eip155:5042",
        "asset": USDC,
        "amount": "1000",
        "payTo": "0x" + "ab" * 20,
        "maxTimeoutSeconds": 604900,
        "extra": {"name": "GatewayWalletBatched", "version": "1", "verifyingContract": GATEWAY},
    }
    opt.update(over)
    return opt


def test_signature_recovers_to_agent_wallet() -> None:
    net = config.NETWORKS["mainnet"]
    payload = x402.sign_payment(KEY, _option(), net, now=1_800_000_000)
    auth = payload["authorization"]
    assert auth["from"] == Account.from_key(KEY).address
    assert int(auth["validBefore"]) - 1_800_000_000 >= 7 * 24 * 3600
    typed = encode_typed_data(
        domain_data={"name": "GatewayWalletBatched", "version": "1", "chainId": 5042, "verifyingContract": GATEWAY},
        message_types=x402.AUTH_TYPES,
        message_data={**{k: auth[k] for k in ("from", "to")}, "value": 1000, "validAfter": int(auth["validAfter"]), "validBefore": int(auth["validBefore"]), "nonce": bytes.fromhex(auth["nonce"][2:])},
    )
    assert Account.recover_message(typed, signature=payload["signature"]) == auth["from"]


@pytest.mark.parametrize(
    "over",
    [
        {"network": "eip155:8453"},
        {"amount": "1001"},
        {"asset": "0x" + "00" * 20},
        {"scheme": "upto"},
        {"extra": {"name": "GatewayWalletBatched", "version": "1", "verifyingContract": "0x" + "ee" * 20}},
    ],
)
def test_refuses_unexpected_payment_options(over: dict[str, Any]) -> None:
    with pytest.raises(x402.PaymentRefused):
        x402.choose_option({"accepts": [_option(**over)]}, config.NETWORKS["mainnet"], 1000)


def test_read_profile_pays_once_and_counts_budget(world: FakeWorld, attnn: tools.Attnn) -> None:
    out = result(attnn.run(attnn.read_profile, {"handle": "@EmDee002"}))
    assert out["ok"] and out["profile"]["floor"] == "$1.00"
    assert world.paid_reads == 1
    assert world.last_payment["accepted"]["amount"] == "1000"
    assert attnn.store.spent_today() == 1_000


# --- bidding -------------------------------------------------------------------------------


def test_place_bid_happy_path(world: FakeWorld, attnn: tools.Attnn) -> None:
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2, "message": "hi"}))
    assert out["ok"], out
    assert len(world.raw_txs) == 2  # approve + placeBid, signed locally
    assert out["bid"]["status"] == "pending" and out["bid"]["amount"] == "$2.00"
    assert "secret-token" not in json.dumps(out)  # access token never shown to the model
    assert attnn.store.spent_today() == 2_000_000 + 1_000
    confirm = [c for c in world.calls if c[1].endswith("/confirm")]
    assert confirm and confirm[0][3]["Authorization"] == "Bearer secret-token"


def test_place_bid_defaults_to_floor(world: FakeWorld, attnn: tools.Attnn) -> None:
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002"}))
    assert out["ok"] and out["bid"]["amount"] == "$1.00"


def test_bid_over_cap_is_refused_before_anything_is_sent(world: FakeWorld, attnn: tools.Attnn) -> None:
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 6}))
    assert not out["ok"] and "per-bid cap" in out["error"]
    assert world.raw_txs == []
    assert attnn.store.spent_today() == 1_000  # only the profile read


def test_bid_over_daily_budget_is_refused(world: FakeWorld) -> None:
    a = tools.Attnn(make_settings(daily_budget_usd=3), store.Store(store.MemoryState()), key_fn=lambda: KEY)
    assert result(a.run(a.place_bid, {"handle": "emdee002", "amount_usd": 2}))["ok"]
    out = result(a.run(a.place_bid, {"handle": "emdee002", "amount_usd": 2}))
    assert not out["ok"] and "budget" in out["error"]
    assert len(world.raw_txs) == 2


def test_below_floor_is_refused(world: FakeWorld, attnn: tools.Attnn) -> None:
    world.profile_floor = 3_000_000
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2}))
    assert not out["ok"] and "floor" in out["error"]


def _tampered(world: FakeWorld, mutate: Any) -> None:
    intent = world.intent({"amount": "2000000"})
    mutate(intent)
    world.bid_intent = intent


@pytest.mark.parametrize(
    "mutate",
    [
        lambda i: i["calls"][0].update(data=chain.calldata(chain.SEL_APPROVE, ESCROW, 2**255)),  # unlimited approve
        lambda i: i["calls"][0].update(data=chain.calldata(chain.SEL_APPROVE, "0x" + "66" * 20, 2_000_000)),  # wrong spender
        lambda i: i.update(escrow="0x" + "66" * 20),  # unknown escrow
        lambda i: i["calls"][1].update(data=i["calls"][1]["data"][:-64] + "00" * 32),  # different message hash
        lambda i: i["calls"].append({"to": USDC, "data": "0x", "value": "0"}),  # extra call
        lambda i: i["calls"][1].update(value="1"),
    ],
)
def test_refuses_to_sign_calls_that_dont_match_the_bid(world: FakeWorld, attnn: tools.Attnn, mutate: Any) -> None:
    _tampered(world, mutate)
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2}))
    assert not out["ok"] and "not signing" in out["error"]
    assert world.raw_txs == []
    assert attnn.store.spent_today() == 1_000  # bid reservation released


def test_not_enough_usdc(world: FakeWorld, attnn: tools.Attnn) -> None:
    world.usdc_balance = 2_000_000
    out = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2}))
    assert not out["ok"] and "not enough" in out["error"]


def test_no_key_configured(world: FakeWorld) -> None:
    a = tools.Attnn(make_settings(), store.Store(store.MemoryState()), key_fn=lambda: None)
    out = result(a.run(a.place_bid, {"handle": "emdee002"}))
    assert not out["ok"] and "ATTNN_AGENT_PRIVATE_KEY" in out["error"]


def test_testnet_needs_an_escrow(world: FakeWorld) -> None:
    a = tools.Attnn(make_settings(network="testnet"), store.Store(store.MemoryState()), key_fn=lambda: KEY)
    out = result(a.run(a.place_bid, {"handle": "emdee002"}))
    assert not out["ok"] and "testnet_escrow" in out["error"]


# --- status and refunds ---------------------------------------------------------------------


def test_status_list_and_refund_timing(world: FakeWorld, attnn: tools.Attnn) -> None:
    placed = result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2}))
    bid_id = placed["bid"]["bid_id"]
    world.bid_view = {"status": "pending", "onChainBidId": "7", "refundableAfter": "2999-01-01T00:00:00Z", "reply": None}
    early = result(attnn.run(attnn.claim_refund, {"bid_id": bid_id}))
    assert not early["ok"] and "Not refundable yet" in early["error"]

    world.bid_view = {"status": "pending", "onChainBidId": "7", "refundableAfter": "2020-01-01T00:00:00Z", "reply": None}
    sent_before = len(world.raw_txs)
    refund = result(attnn.run(attnn.claim_refund, {"bid_id": bid_id}))
    assert refund["ok"] and len(world.raw_txs) == sent_before + 1

    world.bid_view = {"status": "accepted", "onChainBidId": "7", "refundableAfter": None, "reply": "x" * 120}
    status = result(attnn.run(attnn.bid_status, {"bid_id": bid_id}))
    assert status["bid"]["status"] == "accepted" and status["bid"]["reply"] == "x" * 120
    listed = result(attnn.run(attnn.list_bids, {}))
    assert listed["count"] == 1 and "token" not in listed["bids"][0]


def test_fund_reads_capped(world: FakeWorld, attnn: tools.Attnn) -> None:
    assert not result(attnn.run(attnn.fund_reads, {"amount_usd": 2}))["ok"]
    out = result(attnn.run(attnn.fund_reads, {"amount_usd": 0.1}))
    assert out["ok"] and len(world.raw_txs) == 2


def test_find_creators_is_free(world: FakeWorld, attnn: tools.Attnn) -> None:
    out = result(attnn.run(attnn.find_creators, {"tag": "Web3"}))
    assert out["ok"] and out["creators"][0]["floor"] == "$1.00"
    assert "tag=web3" in world.calls[0][1]


# --- registration ---------------------------------------------------------------------------


class FakeCtx:
    def __init__(self) -> None:
        self.tools: dict[str, dict] = {}
        self.hooks: dict[str, Any] = {}
        self.skills: dict[str, Path] = {}
        self.state = store.MemoryState()

    def get_config(self, key: str, default: Any = None) -> Any:
        return default

    def register_tool(self, **kw: Any) -> None:
        self.tools[kw["name"]] = kw

    def register_hook(self, name: str, fn: Any) -> None:
        self.hooks[name] = fn

    def register_skill(self, name: str, path: Path) -> None:
        self.skills[name] = path


def test_register_matches_manifest_and_gates_spending() -> None:
    ctx = FakeCtx()
    plugin.register(ctx)
    manifest = yaml.safe_load((Path(plugin.__file__).parent / "plugin.yaml").read_text())
    assert sorted(ctx.tools) == sorted(manifest["provides_tools"])
    assert sorted(ctx.hooks) == sorted(manifest["provides_hooks"])
    assert "attnn" in ctx.skills
    hook = ctx.hooks["pre_tool_call"]
    for name in ("attnn_place_bid", "attnn_fund_reads", "attnn_claim_refund"):
        directive = hook(tool_name=name, args={"handle": "emdee002", "amount_usd": 2}, task_id="t")
        assert directive and directive["action"] == "approve"
    assert "$2.00" in hook(tool_name="attnn_place_bid", args={"handle": "emdee002", "amount_usd": 2}, task_id="t")["message"]
    assert hook(tool_name="attnn_find_creators", args={}, task_id="t") is None
    assert hook(tool_name="terminal", args={}, task_id="t") is None
    for schema_name, tool in ctx.tools.items():
        assert tool["schema"]["name"] == schema_name


def test_signed_transactions_are_what_we_meant(world: FakeWorld, attnn: tools.Attnn) -> None:
    from eth_account.typed_transactions import TypedTransaction
    from hexbytes import HexBytes

    assert result(attnn.run(attnn.place_bid, {"handle": "emdee002", "amount_usd": 2}))["ok"]
    approve, place = (TypedTransaction.from_bytes(HexBytes(raw)).as_dict() for raw in world.raw_txs)
    assert approve["chainId"] == 5042 and place["chainId"] == 5042
    assert "0x" + HexBytes(approve["to"]).hex().removeprefix("0x") == USDC.lower() and approve["value"] == 0
    assert HexBytes(approve["data"]).hex().removeprefix("0x") == chain.calldata(chain.SEL_APPROVE, ESCROW, 2_000_000)[2:]
    assert "0x" + HexBytes(place["to"]).hex().removeprefix("0x") == ESCROW.lower()
    assert Account.recover_transaction(world.raw_txs[1]) == Account.from_key(KEY).address
