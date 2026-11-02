# Attnn. Agent API

Attnn. is an agentic attention marketplace on **Arc mainnet**. Bidders put USDC into an on-chain
escrow to reach creators; creators earn it by replying; unanswered bids are refunded after 3 days.

AI agents can reach Attnn. these ways, all live on mainnet:

| Way | Cost | What you get |
|---|---|---|
| `GET https://attnn.xyz/api/v1/creators?tag=…` | Free | Live markets an agent can bid on: handle, topics, floor, verified accounts |
| `GET https://attnn.xyz/api/c/{handle}` | **$0.001 USDC via x402** (Circle Gateway, gas-free) | A creator's profile: bio, tags, what they're open to, availability, minimum bid, market link |
| `POST https://attnn.xyz/api/v1/bids` | The bid itself, from **your own wallet** | Bid on a creator programmatically ([below](#bid-from-your-own-wallet)) |
| Read the contracts on Arc | Free | Live markets: creators by tag, minimum bids, bid counts and statuses |
| PayBox plugin "Attnn." | Free | Find creators and check prices from a PayBox-connected agent |

Machine-readable spec: [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1).

## Paid endpoint: creator profile

```
GET https://attnn.xyz/api/c/{handle}
```

- **Price:** $0.001 USDC (`amount: "1000"`, 6 decimals) per read.
- **Payment:** x402 v2, scheme `exact`, network `eip155:5042` (Arc mainnet), asset USDC
  `0x3600000000000000000000000000000000000000`, settled through **Circle Gateway**
  (`extra.name: "GatewayWalletBatched"`, Gateway wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`).
- **Flow:** call without payment → `402` with a base64 `PAYMENT-REQUIRED` header → pay →
  `200` with the profile, a `payment` receipt in the body and a `PAYMENT-RESPONSE` header.
- **No charge for a miss:** an unknown handle returns `404` before any payment is requested.
- **Safe retries:** re-sending the same payment returns the stored receipt (`replay: true`), never a second charge.

### Example (Node.js, Circle's client)

```js
import { GatewayClient } from "@circle-fin/x402-batching/client";

const client = new GatewayClient({ chain: "arc", privateKey: process.env.AGENT_KEY });
await client.deposit("0.10");                       // once: fund the agent's Gateway balance
const res = await client.pay("https://attnn.xyz/api/c/emdee002");
console.log(res.data.profile, res.data.payment);   // profile + Gateway receipt
```

### Response (200)

```json
{
  "handle": "emdee002",
  "unlocked": true,
  "payer": "0xbbac…c58a",
  "profile": {
    "handle": "emdee002",
    "bio": "…",
    "tags": ["crypto", "web3", "ai", "design"],
    "openTo": [],
    "availabilityStatus": "available",
    "minBid": "1000000",
    "isActive": true,
    "market": "/c/emdee002",
    "verified": [{ "provider": "x", "handle": "emdee002", "displayName": "Emdee" }]
  },
  "payment": { "success": true, "transaction": "6058b27a-…", "network": "eip155:5042", "payer": "0xbbac…c58a", "amount": "1000" }
}
```

`verified` lists the social accounts the creator proved they control by signing in with X or
LinkedIn (an X handle, or a LinkedIn name; LinkedIn shares no profile link). It proves control of the
account, not real-world identity. New markets need at least one before they go live.

To bid, use the bid API below (agents) or open `https://attnn.xyz` + `profile.market` (people).
The USDC waits in the escrow: paid to the creator only when they reply (at least 100 characters),
refunded at once if they decline, and refundable after 3 days with no reply.

## Bid from your own wallet

Your agent bids from **its own wallet**. Attnn. never holds your USDC or your keys: you send the
transactions yourself, and the escrow contract decides where the money goes (to the creator when
they reply, back to you when they decline or after 3 days).

**1. Read the profile over x402, paying from the wallet you'll bid from.** This is how Attnn. knows
the wallet is yours: Circle Gateway only settles a payment that wallet signed. A read is good for
bids on that creator for 24 hours.

**2. Prepare the bid.**

```
POST https://attnn.xyz/api/v1/bids
Content-Type: application/json
Idempotency-Key: <any unique string>        (optional: a retry returns the same bid; reusing
                                             the key for a different bid is refused with 409)

{ "handle": "emdee002", "amount": "1000000", "bidder": "0xYourWallet", "message": "Optional, up to 2,000 characters" }
```

`amount` is atomic USDC (6 decimals): at least the creator's floor, at most `1000000000` ($1,000).
The same rules apply as for any bid: the creator must be live and accepting bids, and new bids can
be paused. Your message stays private with Attnn.: only its fingerprint goes on-chain.

Response `201`:

```json
{
  "id": "6f1c…",
  "accessToken": "keep this secret",
  "status": "waiting",
  "escrow": "0xff00aa5414e205367af5dd29927e23a1ccf3bad8",
  "amount": "1000000",
  "messageHash": "0x9a…",
  "calls": [
    { "to": "0x3600…0000", "data": "0x095ea7b3…", "value": "0", "description": "USDC approve(escrow, amount)" },
    { "to": "0xFF00…bAD8", "data": "0x…",         "value": "0", "description": "placeBid(creator, amount, messageHash)" }
  ]
}
```

**3. Send both calls from your wallet, in order,** on Arc (gas is paid in USDC on Arc, so keep a few
cents more than the bid).

**4. Confirm.** Attnn. reads the transaction from Arc itself and records the bid only if it escrowed
exactly this one (your wallet, this creator, this amount, this message fingerprint):

```
POST https://attnn.xyz/api/v1/bids/{id}/confirm
Authorization: Bearer <accessToken>

{ "txHash": "0x…the placeBid transaction" }
```

If you skip this step, the escrow's `BidPlaced` event records it anyway, usually within a minute.
Confirming more than once is safe: it never records a bid twice.

**5. Check status and read the reply.**

```
GET https://attnn.xyz/api/v1/bids/{id}
Authorization: Bearer <accessToken>
```

`status` is `waiting` (not escrowed yet), `pending` (escrowed, waiting for the creator), `accepted`
(the creator replied and was paid: `reply` holds their answer, for you only), `rejected` (declined,
your USDC is back), or `refunded`. `refundableAfter` says when you may take an unanswered bid back.

**Refunds are yours to claim.** Attnn. can't send transactions from your wallet, so after
`refundableAfter` call `claimRefund(onChainBidId)` on the escrow from the same wallet. A creator
who declines refunds you at once, with nothing to do on your side. Attnn. marks the bid `refunded`
once the escrow's own record shows the refund.

**Keep the access token secret.** It is the only way to read this bid's status and the creator's
reply (which is for you only). It can't move money: only your wallet can.

**Counter offers** aren't sent to outside agents: the creator accepts or declines your bid as is.

| Status | Meaning |
|---|---|
| `400` | Invalid input (address, amount, message, floor, your own market, or a wallet that belongs to an Attnn. account) |
| `402` | Pay for this creator's profile from this wallet first (`GET /api/c/{handle}`) |
| `404` | No such creator, or (status/confirm) wrong id or token |
| `409` | Creator not accepting bids; an Idempotency-Key already used for a different bid; or (confirm) the transaction didn't escrow this bid (yet), or the bid was already settled on-chain |
| `429` | Too many requests, or 10 bids already waiting to be placed from this wallet |
| `503` | New bids are paused |

A runnable end-to-end example (testnet by default): `scripts/external-bid-demo.mjs`.

## Free endpoint: payment receipts

```
GET https://attnn.xyz/api/x402/receipts
```

Totals and the latest 20 Gateway receipts for paid profile reads: public proof that the x402 flow settles.

## Reading the contracts directly (free)

Arc mainnet, chain id `5042`, RPC `https://rpc.mainnet.arc.io`.

| Contract | Address | Useful reads |
|---|---|---|
| AttnnRegistry | `0x024Bd6D6bdD990274Be4e99F919e7D71349782D8` | `getCreatorProfile(string handle)`, `getCreatorsByTagPage(string tag, uint256 offset, uint256 limit)`, `minBidOf(address)`, `isActiveCreator(address)`, `getCreatorCount()` |
| AttnnEscrow | `0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8` | `getCreatorBidCount(address)`, `getCreatorBidsPage(address, uint256, uint256)`, `getBid(uint256)`, `paused()`, `REFUND_PERIOD()`, `MIN_BID()`, `MAX_BID()` |

USDC amounts use 6 decimals (`1000000` = $1). Bid status: 0 Pending, 1 Accepted (replied), 2 Rejected (declined, refunded), 3 Refunded (no reply in 3 days).
Bid messages and replies are never stored on-chain as text, only as fingerprints.
