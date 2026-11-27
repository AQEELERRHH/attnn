"""Arc JSON-RPC: reads, and signing + sending transactions from the agent's own wallet."""

from __future__ import annotations

import itertools
import time
from typing import Any

from eth_utils import keccak, to_checksum_address

from . import net

_ids = itertools.count(1)


def selector(signature: str) -> str:
    return "0x" + keccak(text=signature)[:4].hex()


SEL_BALANCE_OF = selector("balanceOf(address)")
SEL_APPROVE = selector("approve(address,uint256)")
SEL_GATEWAY_DEPOSIT = selector("deposit(address,uint256)")  # GatewayWallet.deposit(token, value)
SEL_CLAIM_REFUND = selector("claimRefund(uint256)")


class ChainError(RuntimeError):
    pass


def word(value: int | str) -> str:
    """One 32-byte ABI word: an int, or an 0x address."""
    if isinstance(value, str):
        value = int(value, 16)
    if value < 0 or value >= 1 << 256:
        raise ValueError("value out of range for uint256")
    return f"{value:064x}"


def calldata(selector: str, *args: int | str) -> str:
    return selector + "".join(word(a) for a in args)


class Rpc:
    def __init__(self, url: str, chain_id: int):
        self.url = url
        self.chain_id = chain_id

    def call(self, method: str, params: list[Any]) -> Any:
        resp = net.request("POST", self.url, json_body={"jsonrpc": "2.0", "id": next(_ids), "method": method, "params": params})
        body = resp.body
        if resp.status != 200 or not isinstance(body, dict):
            raise ChainError(f"Arc RPC {method}: HTTP {resp.status}")
        if body.get("error"):
            err = body["error"]
            raise ChainError(f"Arc RPC {method}: {err.get('message', err) if isinstance(err, dict) else err}")
        return body.get("result")

    # reads ---------------------------------------------------------------------------------

    def eth_call(self, to: str, data: str) -> str:
        return str(self.call("eth_call", [{"to": to, "data": data}, "latest"]))

    def usdc_balance(self, usdc: str, owner: str) -> int:
        return int(self.eth_call(usdc, calldata(SEL_BALANCE_OF, owner)), 16)

    def check_chain(self) -> None:
        got = int(self.call("eth_chainId", []), 16)
        if got != self.chain_id:
            raise ChainError(f"RPC is on chain {got}, expected {self.chain_id}: check the network setting.")

    # writes --------------------------------------------------------------------------------

    def send(self, account: Any, to: str, data: str, *, gas_floor: int = 60_000) -> str:
        """Sign and send one call from `account` (an eth_account LocalAccount); returns the hash."""
        sender = account.address
        to = to_checksum_address(to)
        tx: dict[str, Any] = {
            "chainId": self.chain_id,
            "from": sender,
            "to": to,
            "data": data,
            "value": 0,
            "nonce": int(self.call("eth_getTransactionCount", [sender, "pending"]), 16),
        }
        estimate = int(self.call("eth_estimateGas", [{"from": sender, "to": to, "data": data, "value": "0x0"}]), 16)
        tx["gas"] = max(gas_floor, estimate * 12 // 10)
        block = self.call("eth_getBlockByNumber", ["latest", False]) or {}
        base_fee = block.get("baseFeePerGas")
        if base_fee is not None:
            try:
                tip = int(self.call("eth_maxPriorityFeePerGas", []), 16)
            except ChainError:
                tip = 1
            tx["maxPriorityFeePerGas"] = tip
            tx["maxFeePerGas"] = int(base_fee, 16) * 2 + tip
            tx["type"] = 2
        else:
            tx["gasPrice"] = int(self.call("eth_gasPrice", []), 16)
        signed = account.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or signed.rawTransaction
        return str(self.call("eth_sendRawTransaction", ["0x" + bytes(raw).hex()]))

    def wait(self, tx_hash: str, timeout: float = 90, poll: float = 1.5) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            receipt = self.call("eth_getTransactionReceipt", [tx_hash])
            if receipt:
                if int(receipt.get("status", "0x0"), 16) != 1:
                    raise ChainError(f"Transaction {tx_hash} reverted on Arc.")
                return receipt
            time.sleep(poll)
        raise ChainError(f"Transaction {tx_hash} not confirmed within {int(timeout)} s; check it on the explorer.")
