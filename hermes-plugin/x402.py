"""x402 v2 buyer for Circle Gateway batched payments (the scheme Attnn. charges with).

Mirrors @circle-fin/x402-batching's BatchEvmScheme: the wallet signs an EIP-3009
TransferWithAuthorization against the GatewayWallet domain ("GatewayWalletBatched", "1"),
and Gateway settles it from the wallet's Gateway balance. No gas, no on-chain transaction
per read. Only an option matching the expected network, asset, contract and price is ever
signed: anything else is refused unsigned.
"""

from __future__ import annotations

import base64
import json
import secrets
import time
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from eth_account import Account
from eth_utils import to_checksum_address

from . import net
from .config import GATEWAY_DOMAIN, Network

BATCHING_NAME = "GatewayWalletBatched"
BATCHING_VERSION = "1"
MIN_VALIDITY = 7 * 24 * 60 * 60 + 100  # Gateway needs at least 7 days (+ buffer)

AUTH_TYPES = {
    "TransferWithAuthorization": [
        {"name": "from", "type": "address"},
        {"name": "to", "type": "address"},
        {"name": "value", "type": "uint256"},
        {"name": "validAfter", "type": "uint256"},
        {"name": "validBefore", "type": "uint256"},
        {"name": "nonce", "type": "bytes32"},
    ]
}


class PaymentRefused(RuntimeError):
    """The seller asked for something this plugin won't sign."""


@dataclass
class Paid:
    response: net.Response
    amount: int
    transaction: str | None
    replay: bool


def _decode_header(value: str) -> dict[str, Any]:
    try:
        return json.loads(base64.b64decode(value))
    except (ValueError, json.JSONDecodeError) as exc:
        raise PaymentRefused("Malformed PAYMENT-REQUIRED header.") from exc


def choose_option(required: dict[str, Any], network: Network, max_amount: int) -> dict[str, Any]:
    """The one payment option we're willing to sign, or PaymentRefused with the reason."""
    reasons: list[str] = []
    for opt in required.get("accepts") or []:
        extra = opt.get("extra") or {}
        if opt.get("scheme") != "exact":
            reasons.append("scheme")
        elif opt.get("network") != f"eip155:{network.chain_id}":
            reasons.append(f"network {opt.get('network')}")
        elif str(opt.get("asset", "")).lower() != network.usdc.lower():
            reasons.append("asset is not USDC")
        elif extra.get("name") != BATCHING_NAME or str(extra.get("version")) != BATCHING_VERSION:
            reasons.append("not Circle Gateway batching")
        elif str(extra.get("verifyingContract", "")).lower() != network.gateway_wallet.lower():
            reasons.append("unexpected Gateway contract")
        elif not str(opt.get("amount", "")).isdigit() or int(opt["amount"]) > max_amount:
            reasons.append(f"price {opt.get('amount')} above the {max_amount} limit")
        elif not opt.get("payTo"):
            reasons.append("no payTo")
        else:
            return opt
    raise PaymentRefused("No acceptable payment option (" + (", ".join(reasons) or "none offered") + ").")


def sign_payment(key: str, option: dict[str, Any], network: Network, now: int | None = None) -> dict[str, Any]:
    now = int(time.time()) if now is None else now
    account = Account.from_key(key)
    validity = max(int(option.get("maxTimeoutSeconds") or 0), MIN_VALIDITY)
    authorization = {
        "from": account.address,
        "to": to_checksum_address(option["payTo"]),
        "value": str(option["amount"]),
        "validAfter": str(now - 600),
        "validBefore": str(now + validity),
        "nonce": "0x" + secrets.token_hex(32),
    }
    domain = {
        "name": BATCHING_NAME,
        "version": BATCHING_VERSION,
        "chainId": network.chain_id,
        "verifyingContract": to_checksum_address(option["extra"]["verifyingContract"]),
    }
    message = {
        "from": authorization["from"],
        "to": authorization["to"],
        "value": int(authorization["value"]),
        "validAfter": int(authorization["validAfter"]),
        "validBefore": int(authorization["validBefore"]),
        "nonce": bytes.fromhex(authorization["nonce"][2:]),
    }
    signed = Account.sign_typed_data(key, domain_data=domain, message_types=AUTH_TYPES, message_data=message)
    return {"authorization": authorization, "signature": "0x" + bytes(signed.signature).hex()}


def get_paid(url: str, key: str, network: Network, max_amount: int) -> Paid:
    """GET `url`; on 402 pay once (within `max_amount`) and retry. Non-402 answers pass through."""
    first = net.request("GET", url)
    if first.status != 402:
        return Paid(response=first, amount=0, transaction=None, replay=False)
    header = first.header("payment-required")
    if not header:
        raise PaymentRefused("402 without a PAYMENT-REQUIRED header.")
    required = _decode_header(header)
    option = choose_option(required, network, max_amount)
    payload = {
        "x402Version": required.get("x402Version", 2),
        "payload": sign_payment(key, option, network),
        "resource": required.get("resource"),
        "accepted": option,
    }
    encoded = base64.b64encode(json.dumps(payload).encode()).decode()
    second = net.request("GET", url, headers={"Payment-Signature": encoded})
    receipt = second.body.get("payment") if isinstance(second.body, dict) else None
    receipt = receipt if isinstance(receipt, dict) else {}
    return Paid(
        response=second,
        amount=int(option["amount"]) if second.status == 200 else 0,
        transaction=receipt.get("transaction"),
        replay=bool(receipt.get("replay")),
    )


def gateway_balance(network: Network, depositor: str) -> int | None:
    """Available Gateway balance (atomic USDC) for profile reads, or None if Gateway can't say."""
    resp = net.request(
        "POST",
        f"{network.gateway_api}/balances",
        json_body={"token": "USDC", "sources": [{"depositor": depositor, "domain": GATEWAY_DOMAIN}]},
    )
    if resp.status != 200 or not isinstance(resp.body, dict):
        return None
    balances = resp.body.get("balances") or []
    if not balances:
        return 0
    try:
        return int(Decimal(str(balances[0].get("balance", "0"))) * 1_000_000)
    except (InvalidOperation, ValueError):
        return None
