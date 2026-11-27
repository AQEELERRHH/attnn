---
name: attnn
description: Reach a creator through Attnn. — find them, read their profile, bid USDC from the agent wallet, then check for the reply.
version: 0.1.0
author: Attnn.
license: MIT
metadata:
  hermes:
    tags: [Payments, x402, USDC, Arc, Creators, Outreach]
---

# Attnn.: reach creators with an escrowed bid

Attnn. (https://attnn.xyz) is a marketplace for attention. A bidder puts USDC into an escrow on
Arc to reach a creator. The creator gets the money only by replying (at least 100 characters).
A decline refunds at once, and with no reply in 3 days the bidder can take it back.

## When to Use

- "Get @someone's attention", "pay a creator to look at my project", "find a web3 designer who'll reply"
- The user wants a reply from a busy creator and is willing to pay only if they answer
- Checking on a bid placed earlier, or claiming back an unanswered one

## Procedure

1. **Find candidates** with `attnn_find_creators` (free), by a topic tag if the user gave one.
   Show handles, floors and verified accounts; let the user pick unless they told you to choose.
2. **Read the profile** with `attnn_read_profile` ($0.001). Check the bio and "open to" fit the
   user's goal. If it fails for lack of read balance, call `attnn_wallet_status`, then offer
   `attnn_fund_reads` with a small amount (e.g. 0.10).
3. **Write the message** with the user: who they are, what they want, why this creator. It is
   private (only its fingerprint goes on-chain) and the creator sees it with the bid.
4. **Bid** with `attnn_place_bid`. Omit `amount_usd` to bid the creator's floor; never bid more
   than the user asked for. The user approves every bid in Hermes; stop if they decline.
5. **Report** the bid id, amount, refund date and explorer link. Later, `attnn_bid_status`
   shows the reply once the creator accepts.
6. **After the refund date** with no reply, offer `attnn_claim_refund`.

## Pitfalls

- A bid needs a profile read from the same wallet within 24 h; `attnn_place_bid` does the read itself.
- Bids above the per-bid cap or today's budget are refused by the plugin: tell the user which
  setting to change (`max_bid_usd`, `daily_budget_usd`) instead of retrying.
- A creator with availability `not_accepting` can't be bid on.
- Never ask for or repeat the wallet's private key. It lives in Hermes's secret store only.
- Counter offers aren't sent to outside agents: a bid is accepted or declined as placed.

## Verification

`attnn_place_bid` returns `ok: true` with a `place_tx`; `attnn_bid_status` then shows `pending`
(escrowed) and later `accepted` with the reply, `rejected` (refunded) or `refunded`.
