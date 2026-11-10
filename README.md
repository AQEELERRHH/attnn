# Attnn. — the agentic attention marketplace

<img width="1658" height="768" alt="Attnn. homepage: live creator markets with bids in USDC" src="https://github.com/user-attachments/assets/36646330-c1e6-4de9-a001-7d1acf21e6c4" />

**Live on Arc mainnet: [attnn.xyz](https://attnn.xyz)**

> Attention is scarce. Let agents negotiate it.

Attnn. is a market for replies. Bidders lock USDC in an escrow contract on [Arc](https://arc.network) to reach a creator or professional. The creator gets paid only by replying. No reply in **3 days**, and the bid goes back to the bidder automatically. A decline refunds at once.

AI agents work both sides: a **bidder agent** finds and bids on creators who fit a goal, and a **creator agent** triages incoming bids. The AI only scores. Fixed rules decide whether money moves and how much.

Built on Circle and Arc: Developer-Controlled Wallets, USDC as gas, x402 nanopayments through Circle Gateway, and the Arc Onramp Kit.

*V1 (PitchSlotArc): 515+ on-chain transactions and $1,148 USDC verified on ArcScan, live since April 2026.*

---

**Contents:** [How it works](#how-it-works) · [Agents](#the-agents) · [Safety](#how-money-is-protected) · [For agent developers](#for-agent-developers) · [Contracts](#contracts) · [Tech stack](#tech-stack) · [Run it locally](#run-it-locally) · [Docs](#docs)

---

## How it works

**Creators and professionals**

1. Sign in with Google or an email link. A Circle wallet is created for you: no seed phrase, no browser extension.
2. Open your market: handle, bio, tags, minimum bid (from $1) and an optional reply template. Verify with X or LinkedIn.
3. Your market is registered on Arc, and bidders and their agents can find you.
4. Bids arrive in your inbox, scored by your creator agent. Reply to collect, decline to refund, or counter for more.

**Bidders**

1. Sign in, then fund your wallet with USDC on Arc (or buy it by card through Circle).
2. Bid by hand on any creator's market, or switch on the bidder agent with a goal, tags, a daily budget and a cap per creator.
3. Your USDC sits in the escrow until the creator replies, declines or the 3 days run out.

**The escrow guarantee** (enforced by `AttnnEscrow` on Arc)

| What happens | Where the USDC goes |
|---|---|
| Creator replies within 3 days | To the creator |
| Creator declines | Straight back to the bidder |
| No reply in 3 days | Back to the bidder, and only to the bidder |

Bid messages and replies never go on-chain as text: the escrow stores only a salted fingerprint (`keccak256(salt ‖ text)`), so the chain proves which reply was paid for without publishing it.

## The agents

### Bidder agent (proactive)

Runs every 30 minutes, or on demand from the dashboard. Each run:

1. Finds live creators whose tags match yours, and checks each one is registered on Arc.
2. Pays **$0.001 over x402** to read each creator's profile (the same price any outside agent pays), from its own wallet through Circle Gateway.
3. Scores each creator 0–10 against your goal with AISA (temperature 0, fixed rubric). Scores are cached for 7 days; "Ask again" asks for a fresh one.
4. Bids **each creator's own floor** when the score clears your minimum, the AI didn't flag the creator, the floor is within your cap, and your daily budget and agent wallet cover it. At most 5 bids a run, highest score first.
5. Records every decision (queued, skipped, blocked, failed) with the reason, shown in **Decision history** on the Agent tab.

If the AI can't score a creator, the agent doesn't bid on them. It never guesses with your money.

### Creator agent (reactive)

Runs when a bid is escrowed. AISA scores the bid; the creator's settings decide:

| Score | Action |
|---|---|
| At or above your auto-accept setting (8+, 9+, 10, or Off) | Accept with **your saved template**. With no template, it's surfaced to you with an AI draft to approve |
| 8 and up, below your setting | Surfaced in your inbox |
| 5–7 | Counter at 85% of your highest pending bid (when that's more), otherwise surfaced |
| Below 5 | Declined, and the bidder is refunded |

The agent never sends AI-written text on its own: an AI draft only goes out if you approve it. If AISA is down, a rule based on the bid amount takes over.

## How money is protected

- **The AI recommends, rules authorize.** The AI never sees prices and never sets an amount.
- **Separate agent wallet.** The bidder agent spends only what you move into its wallet, never your main wallet.
- **Daily allowance.** Sends, bids by hand and agent top-ups share one $500 per 24 hours allowance. Going over it, a new send address, or raising your agent's limits needs an emailed security code.
- **Idempotent money moves.** Every Circle transaction has a stable key, so retries and double clicks can't pay twice. Statuses change only after Arc confirms.
- **Pause switches.** An app-wide switch, and the escrow's own `pause()` (new bids only: replies, declines and refunds can never be paused, and the escrow admin can't move USDC).
- **Reconciliation.** An hourly health check, a daily full escrow-versus-database audit, and sweeps that finish anything a job left half done.

The full list, with your live limits, is on the dashboard's Spending policy card and on [attnn.xyz/about](https://attnn.xyz/about#agent-safety).

## For agent developers

<img width="1041" height="685" alt="An x402 402 Payment Required response from a creator profile" src="https://github.com/user-attachments/assets/13365e62-0073-443b-b583-83619bf6d4c8" />

**Read a creator profile over x402.** `GET https://attnn.xyz/api/c/{handle}` answers `402 Payment Required` with an x402 v2 challenge: `exact` scheme, USDC on Arc, $0.001, `GatewayWalletBatched`. Pay with Circle's `GatewayClient` (EIP-3009) and get the profile JSON plus a `PAYMENT-RESPONSE` receipt. Signed-in people read free. Public receipts: `GET /api/x402/receipts`.

**Bid from your own wallet.** Outside agents bid with keys they hold; Attnn. never holds them:

1. Read the creator's profile over x402 (that payment proves you own the wallet).
2. `POST /api/v1/bids` with `{handle, amount, bidder, message?}` and get back the `approve` and `placeBid` calldata.
3. Send both transactions from your wallet, then `POST /api/v1/bids/{id}/confirm` with the transaction hash.
4. Poll `GET /api/v1/bids/{id}` for the status and, once accepted, the reply. If there's no reply in 3 days, claim your refund from the escrow.

Live markets: `GET /api/v1/creators?tag=…` (free). Full guide: [docs/AGENT-API.md](docs/AGENT-API.md) · spec: [docs/openapi.yaml](docs/openapi.yaml) · demos: `scripts/x402-demo.mjs`, `scripts/external-bid-demo.mjs`.

## Contracts

### Arc mainnet (chain 5042)

Deployed 14 October 2026 (block 25927568) from `contracts/src`, after a CertiK AI scan. Escrow v2: fingerprints only, $1 minimum, each creator's floor enforced, 3-day refund window, pause for new bids only.

| Contract | Address |
|---|---|
| AttnnRegistry | `0x024Bd6D6bdD990274Be4e99F919e7D71349782D8` |
| AttnnEscrow | `0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8` |
| Escrow admin (can pause new bids only) | `0xF326854e41AB46366E1b4711C2a8653ea2bfE253` |
| USDC | `0x3600000000000000000000000000000000000000` |

```solidity
// AttnnEscrow (v2)
function placeBid(address creator, uint256 amount, bytes32 messageHash) external returns (uint256 bidId);
function acceptBid(uint256 bidId, bytes32 replyHash) external;   // creator only
function rejectBid(uint256 bidId) external;                      // creator only, refunds now
function claimRefund(uint256 bidId) external;                    // bidder only, after REFUND_PERIOD
function getBid(uint256 bidId) external view returns (...);
function getBidderBidsPage(address bidder, uint256 offset, uint256 limit) external view returns (uint256[] memory);

// AttnnRegistry
function registerCreator(string handle, uint256 minBid, string[] tags, string profileURI) external;
function getCreatorsByTagPage(string tag, uint256 offset, uint256 limit) external view returns (address[] memory);
function isActiveCreator(address creator) external view returns (bool);
function minBidOf(address creator) external view returns (uint256);
```

Foundry project with 51 tests, including fuzzing, re-entrancy, pause and admin limits, and creator floors: `npm run test:contracts`.

### Arc Testnet (chain 5042002)

| Contract | Address |
|---|---|
| AttnnRegistry | `0x853C43338A3FAA52DE3AB79aEBc6AF2F51c41dA3` |
| AttnnEscrow | `0x7B43B155aCC2B191C121FB2fC724669a6F7Fbb86` |
| AttnnEscrow (original, 14-day, legacy bids only) | `0x3066138a56f75206AeDd1A6E7d11c8244E278aB3` |
| PitchSlotArc V1 | `0x8cE043782da362f3e9caf5fd995061765a993138` |
| USDC | `0x3600000000000000000000000000000000000000` |

## Tech stack

| Area | What |
|---|---|
| App | Next.js 15 (App Router), React 19, TypeScript strict, Tailwind, Radix/shadcn |
| Auth | Auth.js v5: Google and email magic links (Resend), database sessions |
| Database | Supabase Postgres with Drizzle ORM, Row Level Security on every table |
| Chain | Arc mainnet and testnet, viem, Foundry |
| Wallets | Circle Developer-Controlled Wallets (`@circle-fin/developer-controlled-wallets`) |
| Payments | x402 v2 with Circle Gateway batching (`@circle-fin/x402-batching`), Arc Onramp Kit for cards |
| AI | AISA (OpenAI-compatible), default model `deepseek-v4.1-flash` |
| Jobs | Inngest: bid placement, settlement, refunds, agent runs, health checks |
| Hosting | Vercel |

**Why Arc:** USDC is the gas token, so every fee and bid is in dollars and nobody needs a second token. That's also why Attnn. doesn't need a Paymaster.

**Why Circle wallets:** wallet setup is the biggest barrier for people new to crypto. With Developer-Controlled Wallets, signing in is enough. Attnn. holds the wallet keys; the escrow contract is what limits where escrowed USDC can go.

## Run it locally

You'll need Node.js 20+, a Postgres database (Supabase works), a Circle developer account, and an AISA key. An Inngest account, Resend, Google OAuth and the X/LinkedIn apps are optional for local work.

```bash
git clone https://github.com/AQEELERRHH/attnn.git
cd attnn
npm install
cp .env.example .env.local   # fill in the values; every variable is listed there
npm run db:migrate           # applies the migrations in ./drizzle to DATABASE_URL
npm run dev                  # http://localhost:3000
npx inngest-cli@latest dev   # local Inngest, in a second terminal
```

`ARC_NETWORK` picks the network (`testnet` by default). On testnet, get USDC from [faucet.circle.com](https://faucet.circle.com) (choose Arc Testnet). Set `X402_MOCK=1` locally to accept any x402 payment header. Switching to mainnet is covered step by step in [docs/MAINNET.md](docs/MAINNET.md).

**Checks** (CI runs all of them on every pull request):

```bash
npx tsc --noEmit            # type-check
npm run lint
npm run test:unit           # pure rules, no database
npm run test:integration    # money paths against a real local Postgres (TEST_DATABASE_URL); Circle, Arc and Inngest faked
npm run test:contracts      # Foundry (first time: npm run setup:contracts)
npm run build
```

## Project layout

```
app/                Next.js routes: market pages, dashboard, API (app/api), legal pages
  api/v1/           external bid API for outside agents
  api/c/[handle]/   x402-gated creator profile
lib/                business logic: bids.ts (every money move), agent.ts, ai.ts, x402.ts, gateway.ts,
                    external-bids.ts, withdrawals.ts, circle.ts, escrow.ts, db/schema.ts
inngest/            background jobs: placement, settlement, refunds, agents, health checks
components/market/  the market design system (reference page at /design)
contracts/          Foundry: AttnnEscrow.sol, AttnnRegistry.sol, tests, deploy script
drizzle/            SQL migrations
tests/              unit and integration tests (see tests/README.md)
docs/               AGENT-API.md, openapi.yaml, MAINNET.md, RUNBOOK.md
scripts/            read-only checks, escrow admin helper, x402 and external-bid demos
```

## Docs

- [docs/AGENT-API.md](docs/AGENT-API.md) and [docs/openapi.yaml](docs/openapi.yaml): integrate an outside agent
- [docs/MAINNET.md](docs/MAINNET.md): switching networks safely
- [docs/RUNBOOK.md](docs/RUNBOOK.md): pause switch, alerts and incidents
- [PRODUCT_DECISIONS.md](PRODUCT_DECISIONS.md): why the product works the way it does
- [tests/README.md](tests/README.md): how the test suites are set up
- [Privacy](https://attnn.xyz/privacy) · [Terms](https://attnn.xyz/terms)

**Resources:** [Arc docs](https://docs.arc.network) · [Circle developers](https://developers.circle.com) · [Circle x402 batching](https://www.npmjs.com/package/@circle-fin/x402-batching) · [Inngest](https://www.inngest.com/docs) · [AISA](https://aisa.one) · [ArcScan testnet](https://testnet.arcscan.app)

## License

MIT

---

*Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. Attnn. is built on Arc Network and is not affiliated with or endorsed by Circle.*
