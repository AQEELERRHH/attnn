"""Load the plugin directory as a package (its folder name has a hyphen) and fake the network."""

from __future__ import annotations

import base64
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any, Callable

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("attnn_plugin", ROOT / "__init__.py", submodule_search_locations=[str(ROOT)])
assert _spec and _spec.loader
plugin = importlib.util.module_from_spec(_spec)
sys.modules["attnn_plugin"] = plugin
_spec.loader.exec_module(plugin)

from attnn_plugin import chain, config, net, store, tools, x402  # noqa: E402

KEY = "0x" + "11" * 32
ESCROW = config.NETWORKS["mainnet"].escrow
USDC = config.NETWORKS["mainnet"].usdc
GATEWAY = config.NETWORKS["mainnet"].gateway_wallet
SELLER = "0x" + "ab" * 20
CREATOR = "0x" + "cd" * 20
MESSAGE_HASH = "0x" + "9a" * 32


class FakeWorld:
    """Routes net.request calls to handlers; records everything sent."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, Any, dict]] = []
        self.raw_txs: list[str] = []
        self.usdc_balance = 50 * config.ONE_USDC
        self.profile_floor = 1_000_000
        self.bid_intent: dict[str, Any] | None = None
        self.paid_reads = 0
        self.bid_view: dict[str, Any] = {"status": "pending", "onChainBidId": "7", "refundableAfter": "2026-12-01T00:00:00Z", "reply": None}
        self.routes: dict[str, Callable[..., net.Response]] = {}

    def __call__(self, method: str, url: str, *, json_body: Any = None, headers: dict | None = None, timeout: float = 30) -> net.Response:
        headers = headers or {}
        self.calls.append((method, url, json_body, headers))
        if url.startswith("https://rpc.mainnet.arc.io"):
            return net.Response(200, {}, {"jsonrpc": "2.0", "id": 1, "result": self.rpc(json_body["method"], json_body["params"])})
        if url.startswith("https://gateway-api.circle.com"):
            return net.Response(200, {}, {"balances": [{"balance": "0.250000"}]})
        path = url.removeprefix("https://attnn.xyz")
        for prefix, handler in self.routes.items():
            if path.startswith(prefix):
                return handler(method, path, json_body, headers)
        if path.startswith("/api/c/"):
            return self.profile(headers)
        if path == "/api/v1/bids" and method == "POST":
            return net.Response(201, {}, self.intent(json_body))
        if path.endswith("/confirm"):
            return net.Response(200, {}, self.bid_view)
        if path.startswith("/api/v1/bids/"):
            return net.Response(200, {}, self.bid_view)
        if path.startswith("/api/v1/creators"):
            return net.Response(200, {}, {"creators": [{"handle": "emdee002", "tags": ["web3"], "floor": "1000000", "availability": "available", "verified": ["x"]}]})
        return net.Response(404, {}, {"error": "not found"})

    def profile(self, headers: dict) -> net.Response:
        if "Payment-Signature" not in headers:
            required = {
                "x402Version": 2,
                "resource": {"url": "https://attnn.xyz/api/c/emdee002"},
                "accepts": [
                    {
                        "scheme": "exact",
                        "network": "eip155:5042",
                        "asset": USDC,
                        "amount": "1000",
                        "payTo": SELLER,
                        "maxTimeoutSeconds": 604900,
                        "extra": {"name": "GatewayWalletBatched", "version": "1", "verifyingContract": GATEWAY},
                    }
                ],
            }
            return net.Response(402, {"payment-required": base64.b64encode(json.dumps(required).encode()).decode()}, {"error": "Payment required"})
        self.paid_reads += 1
        self.last_payment = json.loads(base64.b64decode(headers["Payment-Signature"]))
        return net.Response(
            200,
            {},
            {
                "profile": {"handle": "emdee002", "bio": "builder", "tags": ["web3"], "openTo": [], "availabilityStatus": "available", "minBid": str(self.profile_floor), "isActive": True, "market": "/c/emdee002"},
                "payment": {"success": True, "transaction": "tx-1", "amount": "1000"},
            },
        )

    def intent(self, body: dict) -> dict:
        amount = int(body["amount"])
        if self.bid_intent is not None:
            return self.bid_intent
        return {
            "id": "6f1c0000-aaaa-bbbb-cccc-000000000001",
            "accessToken": "secret-token",
            "status": "waiting",
            "escrow": ESCROW.lower(),
            "amount": str(amount),
            "messageHash": MESSAGE_HASH,
            "calls": [
                {"to": USDC, "data": chain.calldata(chain.SEL_APPROVE, ESCROW, amount), "value": "0"},
                {"to": ESCROW, "data": tools.SEL_PLACE_BID + chain.word(CREATOR) + chain.word(amount) + MESSAGE_HASH[2:], "value": "0"},
            ],
        }

    def rpc(self, method: str, params: list) -> Any:
        if method == "eth_chainId":
            return hex(5042)
        if method == "eth_call":
            return "0x" + chain.word(self.usdc_balance)
        if method == "eth_getTransactionCount":
            return hex(len(self.raw_txs))
        if method == "eth_estimateGas":
            return hex(50_000)
        if method == "eth_getBlockByNumber":
            return {"baseFeePerGas": hex(20 * 10**9)}
        if method == "eth_maxPriorityFeePerGas":
            return hex(10**9)
        if method == "eth_sendRawTransaction":
            self.raw_txs.append(params[0])
            return "0x" + f"{len(self.raw_txs):064x}"
        if method == "eth_getTransactionReceipt":
            return {"status": "0x1"}
        raise AssertionError(f"unexpected rpc {method}")


@pytest.fixture
def world(monkeypatch: pytest.MonkeyPatch) -> FakeWorld:
    w = FakeWorld()
    monkeypatch.setattr(net, "request", w)
    monkeypatch.setattr(chain.time, "sleep", lambda _s: None)
    return w


def make_settings(**overrides: Any) -> Callable[[], config.Settings]:
    values = {"network": "mainnet", "max_bid_usd": 5, "daily_budget_usd": 20, "max_deposit_usd": 1, **overrides}
    return lambda: config.load_settings(lambda key, default=None: values.get(key, default))


@pytest.fixture
def attnn() -> tools.Attnn:
    return tools.Attnn(make_settings(), store.Store(store.MemoryState()), key_fn=lambda: KEY)
