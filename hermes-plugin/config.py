"""Networks, settings and money helpers for the Attnn. plugin."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal, InvalidOperation
from typing import Any, Callable

KEY_ENV = "ATTNN_AGENT_PRIVATE_KEY"

USDC_DECIMALS = 6
ONE_USDC = 10**USDC_DECIMALS
ESCROW_MAX_BID = 1_000 * ONE_USDC  # the escrow's MAX_BID
PROFILE_READ_PRICE = 1_000  # $0.001, the price Attnn. charges per profile read
GATEWAY_DOMAIN = 26  # Circle Gateway's domain id for Arc


@dataclass(frozen=True)
class Network:
    name: str
    chain_id: int
    rpc_url: str
    usdc: str
    gateway_wallet: str
    gateway_api: str
    explorer: str
    escrow: str | None  # the only escrow this plugin approves USDC to; None = must be configured


NETWORKS: dict[str, Network] = {
    "mainnet": Network(
        name="mainnet",
        chain_id=5042,
        rpc_url="https://rpc.mainnet.arc.io",
        usdc="0x3600000000000000000000000000000000000000",
        gateway_wallet="0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE",
        gateway_api="https://gateway-api.circle.com/v1",
        explorer="https://explorer.arc.io",
        escrow="0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8",
    ),
    "testnet": Network(
        name="testnet",
        chain_id=5042002,
        rpc_url="https://rpc.testnet.arc.network",
        usdc="0x3600000000000000000000000000000000000000",
        gateway_wallet="0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
        gateway_api="https://gateway-api-testnet.circle.com/v1",
        explorer="https://testnet.arcscan.app",
        escrow=None,
    ),
}

DEFAULT_BASE_URL = "https://attnn.xyz"


@dataclass(frozen=True)
class Settings:
    network: Network
    base_url: str
    max_bid: int  # atomic USDC
    daily_budget: int  # atomic USDC
    max_deposit: int  # atomic USDC


def _usd_setting(value: Any, default: str) -> int:
    try:
        atomic = usd_to_atomic(value if value not in (None, "") else default)
    except ValueError:
        atomic = usd_to_atomic(default)
    return max(atomic, 0)


def load_settings(get_config: Callable[..., Any]) -> Settings:
    """Read this plugin's settings. Unknown or broken values fall back to safe defaults."""
    net_name = str(get_config("network", default="mainnet") or "mainnet").strip().lower()
    base = NETWORKS.get(net_name)
    if base is None:
        raise ValueError(f"Unknown network {net_name!r}: use mainnet or testnet.")
    rpc = str(get_config("rpc_url", default="") or "").strip()
    escrow = base.escrow
    if base.name == "testnet":
        configured = str(get_config("testnet_escrow", default="") or "").strip()
        if configured and not re.fullmatch(r"0x[0-9a-fA-F]{40}", configured):
            raise ValueError("testnet_escrow must be a 0x address.")
        escrow = configured or None
    network = Network(**{**base.__dict__, "rpc_url": rpc or base.rpc_url, "escrow": escrow})
    url = str(get_config("base_url", default="") or "").strip().rstrip("/") or DEFAULT_BASE_URL
    if not url.startswith("https://") and not re.match(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", url):
        raise ValueError("base_url must be https:// (plain http only for localhost).")
    max_bid = min(_usd_setting(get_config("max_bid_usd", default=5), "5"), ESCROW_MAX_BID)
    return Settings(
        network=network,
        base_url=url,
        max_bid=max_bid,
        daily_budget=_usd_setting(get_config("daily_budget_usd", default=20), "20"),
        max_deposit=_usd_setting(get_config("max_deposit_usd", default=1), "1"),
    )


def read_private_key() -> str | None:
    """The agent wallet's key, through Hermes's secret scope (honours the active profile)."""
    value: str | None
    try:
        from agent.secret_scope import get_secret  # type: ignore[import-not-found]

        value = get_secret(KEY_ENV)
    except ImportError:  # outside Hermes (tests, local scripts)
        value = os.environ.get(KEY_ENV)
    value = (value or "").strip()
    if not value:
        return None
    if not value.startswith("0x"):
        value = "0x" + value
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        raise ValueError(f"{KEY_ENV} is not a 32-byte hex private key.")
    return value


# --- money ---------------------------------------------------------------------------------


def usd_to_atomic(value: Any) -> int:
    """'5', 5, 5.25 -> atomic USDC. Refuses negatives, NaN and sub-micro amounts."""
    try:
        dec = Decimal(str(value).strip().lstrip("$"))
    except (InvalidOperation, AttributeError) as exc:
        raise ValueError(f"Not an amount: {value!r}") from exc
    if not dec.is_finite() or dec < 0:
        raise ValueError(f"Not an amount: {value!r}")
    atomic = dec * ONE_USDC
    if atomic != atomic.to_integral_value(rounding=ROUND_DOWN):
        raise ValueError("USDC has 6 decimals: use at most 6 digits after the point.")
    return int(atomic)


def fmt_usd(atomic: int | str) -> str:
    n = int(atomic)
    if n % 10_000 == 0:
        return f"${n / ONE_USDC:,.2f}"
    return f"${Decimal(n) / ONE_USDC:f}"
