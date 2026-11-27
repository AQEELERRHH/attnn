# Attnn. plugin for Hermes Agent

Lets a [Hermes](https://github.com/NousResearch/hermes-agent) agent reach creators on
[Attnn.](https://attnn.xyz), the attention marketplace on Arc. The agent finds creators by
topic, reads a profile for $0.001 over x402, and bids USDC from **its own wallet** into the
Attnn. escrow. The creator is paid only by replying (at least 100 characters). A decline
refunds at once, and with no reply in 3 days the agent claims the bid back.

| Tool | What it does | Cost | Asks you first |
|---|---|---|---|
| `attnn_find_creators` | Live creator markets, optionally by tag: handle, tags, floor, verified accounts | Free | No |
| `attnn_read_profile` | One creator's full profile (bio, open to, availability, floor) | $0.001 USDC (x402, Circle Gateway) | No (counts in the daily budget) |
| `attnn_wallet_status` | Agent wallet address, USDC balance, read balance, today's spend, caps | Free | No |
| `attnn_fund_reads` | Move USDC into the read balance (Gateway `approve` + `deposit`) | The amount, ≤ `max_deposit_usd` | **Yes** |
| `attnn_place_bid` | Read the profile, then bid: `approve` + `placeBid` on Arc, then confirm with Attnn. | The bid, ≤ `max_bid_usd` and the daily budget | **Yes** |
| `attnn_bid_status` | Status, refund date, and the creator's reply once they accept | Free | No |
| `attnn_list_bids` | Bids this agent placed (from local state) | Free | No |
| `attnn_claim_refund` | `claimRefund` on the escrow after the refund date | Arc fee | **Yes** |

A bundled skill (`attnn:attnn`) tells the agent when to use them and in what order.

## Install

```bash
hermes plugins install attnn          # from the Hermes plugin catalog
hermes plugins enable attnn
```

Hermes asks for `ATTNN_AGENT_PRIVATE_KEY` during install and keeps it in its secret store.

### Set up a wallet

1. Create a **new** wallet just for the agent (any EVM wallet; export its private key).
   Never use a wallet that holds more than you're willing to let the agent spend.
2. Send it a few dollars of **USDC on Arc** (Arc's gas is paid in USDC, so no other token is needed).
3. Ask the agent to "top up the Attnn. read balance with 0.10" (`attnn_fund_reads`).
   That pays for 100 profile reads.

### Settings

`hermes config set plugins.entries.attnn.settings.<key> <value>`

| Key | Default | Meaning |
|---|---|---|
| `network` | `mainnet` | `mainnet` (real USDC) or `testnet` |
| `max_bid_usd` | `5` | Largest single bid (never above the escrow's $1,000) |
| `daily_budget_usd` | `20` | Most spent per UTC day on bids + profile reads |
| `max_deposit_usd` | `1` | Largest single read-balance top-up |
| `base_url` | `https://attnn.xyz` | Attnn. site (testing only) |
| `rpc_url` | public Arc RPC | Arc RPC endpoint |
| `testnet_escrow` | none | Testnet escrow address (required to bid on testnet) |

## How your money is protected

- **You approve every transaction.** Bids, top-ups and refunds go through Hermes's approval
  prompt (the plugin's `pre_tool_call` hook). "Always" covers only that exact action. In cron
  and other unattended runs, where nobody can answer, they are refused.
- **Hard caps in code.** A bid above `max_bid_usd`, or a bid or read that would take today's
  spend past `daily_budget_usd`, is refused before anything is signed.
- **Only the expected transactions are signed.** USDC is approved only to the built-in Attnn.
  escrow (`0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8` on mainnet) or the Circle Gateway wallet,
  for exactly the amount being spent. The `approve` and `placeBid` calldata Attnn.'s API returns
  is checked against the bid (spender, amount, message fingerprint, no native value) and refused
  otherwise.
- **x402 payments are checked too.** A profile read signs only an Arc USDC, Circle Gateway
  batched payment of at most $0.001 to the price Attnn. publishes.
- **The escrow decides where bid money goes**, not Attnn.: to the creator on a reply, back to
  your wallet on a decline or after 3 days.

## Disclosure

- **Network calls:** `attnn.xyz` (creator list, profiles, bid API), the Arc RPC
  (`rpc.mainnet.arc.io` by default) and Circle Gateway (`gateway-api.circle.com`, read balance and
  x402 settlement through Attnn.).
- **Credentials:** `ATTNN_AGENT_PRIVATE_KEY`, read through Hermes's secret scope; it signs
  transactions and x402 payments locally and is never sent anywhere.
- **Stored data:** today's spend total and the bids this agent placed (with their Attnn. access
  tokens, which can read a bid's status and reply but can't move money) in the plugin's Hermes
  state. No telemetry.
- **No shell commands, no background processes, no self-updates.**

## Develop

```bash
cd hermes-plugin
python -m pip install "eth-account>=0.11,<0.14" pytest pyyaml
python -m pytest            # 29 tests: x402 signing, caps, calldata checks, refunds, registration
hermes plugins validate . --install-deps
```

Built on Attnn.'s public agent API: [`docs/AGENT-API.md`](../docs/AGENT-API.md). MIT licensed.
