# Attnn. plugin for PayBox

A PayBox plugin (MCP server bundled into one `dist/plugin.mjs`) that lets an AI agent
find creators on Attnn. and see what a reply costs, read live from Attnn.'s contracts on
**Arc mainnet**. Built for the MoonPay × PayBox hackathon (Oct 2026) on top of the
existing Attnn. marketplace.

| Tool | What it does | Network |
|---|---|---|
| `how_attnn_works` | The escrow rules (reply = paid, decline = refund, no reply in 3 days = refund), bid range, contract addresses | none |
| `find_creators` | Active creators, optionally by tag, with their minimum price and bid count. Handles come from attnn.xyz/creators (fallback: the registry's events); price, tags, status and bids are read on Arc | attnn.xyz + Arc RPC (+ explorer) |
| `creator_market` | One creator's market: minimum, open bids and the top one, replied / declined / refunded, reply rate, link to bid | Arc RPC |

Everything is a public on-chain read: no keys, no secrets, no transactions. Reply rate
uses Attnn.'s rule (replied ÷ (replied + refunded)) over the creator's latest 100 bids.

**Why no "place bid" tool yet:** a bid sent straight to the escrow from an outside wallet
doesn't appear in the creator's Attnn. inbox until external bids are indexed, so the
creator couldn't answer it and the bidder would wait 3 days for the refund. The plugin
links to the creator's market on attnn.xyz instead.

## Build and check

Node.js 24 and pnpm 11.11.0 (PayBox starter 1.0.2 toolchain).

```bash
cd paybox-plugin
pnpm install --frozen-lockfile
pnpm test     # type-check, two builds with identical bytes, unit tests, local conformance
```

`scripts/conformance.mjs` is our own stand-in for the starter's check (same protocol
shape: one process per operation, `tools/list` then the sample `tools/call` from
`paybox-plugin.json`, schemas validated with Ajv 2020). The hosted checks in the PayBox
developer portal are the real test.

## Portal settings

Upload `dist/plugin.mjs` only. Network hosts to allow (exact names):

- `rpc.mainnet.arc.io`
- `attnn.xyz`
- `explorer.arc.io` (fallback only)

No environment variables or secrets.
