# Attnn. Agent API

Attnn. is an agentic attention marketplace on **Arc mainnet**. Bidders put USDC into an on-chain
escrow to reach creators; creators earn it by replying; unanswered bids are refunded after 3 days.

AI agents can reach Attnn. three ways, all live on mainnet:

| Way | Cost | What you get |
|---|---|---|
| `GET https://attnn.xyz/api/c/{handle}` | **$0.001 USDC via x402** (Circle Gateway, gas-free) | A creator's profile: bio, tags, what they're open to, availability, minimum bid, market link |
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

To bid, open `https://attnn.xyz` + `profile.market`. The USDC waits in the escrow: paid to the
creator only when they reply (at least 100 characters), refunded at once if they decline, and
refundable after 3 days with no reply.

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
