# CLAUDE.md

Attnn. is an agentic attention marketplace on Arc (Circle's USDC-gas L1). Bidders put USDC into an on-chain escrow to reach creators. Creators earn it by replying, and bidders get a refund if there's no reply within 3 days. AI agents work both sides. Product rationale lives in `PRODUCT_DECISIONS.md`, and the pitch plus setup steps are in `README.md`. Where the README and the code disagree, trust the code.

Known issues are tracked privately in `KNOWN_ISSUES.local.md` (gitignored, never commit it or copy its contents into tracked files).

## Rules (always follow)

- **Never commit or push to `main`.** Work on branches. The user opens PRs.
- **Never run `npm run db:push`, `npm run db:migrate` or `npm run deploy:contracts` without asking first.** They hit the shared Supabase DB and Arc.
- **Never print, commit or edit `.env.local` or any secrets.** Don't `cat` env files, echo secret env vars or paste keys into code or logs. `.env.example` holds the variable names, with empty values only.
- **Do not run `npm audit fix`** (with or without `--force`).
- **After every change, run `npx tsc --noEmit` and fix any errors** before calling the work done.

## Stack

| Area | What | Notes |
|---|---|---|
| Framework | Next.js 15 App Router (installed 15.5.x), React 19, TypeScript | `tsconfig`: `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals/Parameters`. Path alias `@/*` → repo root |
| UI | Tailwind 3, shadcn/ui-style Radix components in `components/ui/`, lucide-react | Toasts via `hooks/use-toast.ts` |
| Auth | Auth.js v5 beta (`next-auth@5.0.0-beta`), **database sessions**, Drizzle adapter | Providers: Google **and** Resend email magic link. `session.user.id` / `session.user.role` are added in `lib/auth.ts` |
| DB | Supabase Postgres + Drizzle ORM (`postgres-js` driver, `prepare: false`) | Schema: `lib/db/schema.ts`. `drizzle.config.ts` loads `.env.local` |
| Chain | Arc, selected by `ARC_NETWORK` (testnet 5042002 default, mainnet 5042), viem for reads | Network config in `lib/chain.ts`; ABIs and USDC helpers in `lib/arc.ts` |
| Wallets | Circle Developer-Controlled Wallets SDK (EOA) | All bid money moves go through `lib/bids.ts`, which uses `executeContractCallOnce` in `lib/circle.ts` |
| AI | AISA (OpenAI-compatible, `deepseek-chat`) via raw `fetch` | `lib/ai.ts`. Every scorer has a rule-based fallback |
| Jobs | Inngest | Client in `lib/inngest.ts`, functions in `inngest/functions.ts`, served at `/api/inngest` |
| Payments | x402 v2 with Circle Gateway batching (`@circle-fin/x402-batching`) | `lib/x402.ts` |
| Hosting | Vercel (auto-deploys on push to `main`) | |

## Commands

```bash
npm run dev            # next dev
npm run build          # next build (runs type-check + lint, fails on either)
npm run lint           # next lint (flat config via FlatCompat, see eslint.config.mjs)
npx tsc --noEmit       # type-check (required after every change)
npm run db:generate    # drizzle-kit generate (safe, writes ./drizzle)
npm run db:studio      # drizzle-kit studio
npm test               # playwright (no tests are checked in yet)
# ASK FIRST: db:push, db:migrate, deploy:contracts
```

`eslint.config.mjs` loads `next/core-web-vitals` and `next/typescript` through `FlatCompat`, because `eslint-config-next@15.1.0` only ships legacy eslintrc configs. By default `next lint` only covers `app/`, `components/`, `lib/`, `pages/` and `src/`. **`inngest/` and `hooks/` are not linted.**

## Folder structure

```
app/
  page.tsx, about/, creators/          public marketing & discovery pages
  register/                            sign-in (Google / email magic link)
  dashboard/                           page.tsx (server: loads wallet/profile/config/bids/logs)
                                       dashboard-client.tsx (~1100 lines: creator, bidder & activity tabs)
  c/[handle]/                          public creator profile page (UI)
  api/
    auth/[...nextauth]/                Auth.js handlers
    wallet/{provision,balance,send}    Circle wallet create / USDC balance / USDC transfer
    profile/{create,update,activate}   creator profile CRUD; activate = registerCreator() on-chain
    bidder-config/create               upsert bidder agent config
    bid/{place,accept,reject,counter}  escrow actions (manual/UI path)
    agent/run                          run the bidder agent once, on demand
    agent/score                        ad-hoc AI scoring (not used by the UI)
    agent/stream                       SSE of agent_logs (not used by the UI)
    voice/parse                        AI voice-command parser (not used by the UI)
    c/[handle]                         x402-gated creator profile JSON API
    x402/access                        stub, simulated only
    inngest/                           Inngest serve endpoint
    webhooks/circle-events             Circle contract event logs → syncs on-chain bid IDs/status (important)
    webhooks/circle, webhooks/arc      store events for idempotency; mostly no-ops beyond that
                                       all three verify the sender before acting (see Webhooks)
inngest/functions.ts                   all Inngest functions (see below)
lib/
  agent.ts      runBidderAgent() (bidder agent) + legacy autoAcceptBid() (unused)
  ai.ts         callAI, evaluateCreatorForBidder, triageBidForCreator, scoreBidForCreator, draftReply
  arc.ts        arcTestnet chain, usdcAbi/registryAbi/escrowAbi, publicClient, parseUsdc/formatUsdc
  circle.ts     getSDK (fresh client per call), provisionUserWallet, executeContractCall, transferUSDC
  circle-webhook.ts  verifyCircleSignature(): ECDSA verification of Circle notifications
  x402.ts       gate(): 402 challenge + BatchFacilitatorClient verify/settle
  auth.ts       NextAuth config + Session type augmentation
  db/           schema.ts (10 tables), client.ts (global-cached connection in dev)
  profiles.ts   getFullProfileByHandle
  inngest.ts    Inngest client (id "attnn")
components/ui/  Radix/shadcn primitives
contracts/      Foundry project: src/AttnnEscrow.sol, src/AttnnRegistry.sol, test/, script/Deploy.s.sol
```

## Data model essentials

- **USDC amounts are stored as `text` in atomic units (6 decimals)**: `"1000000"` = $1. Handle them with `BigInt`, never float math. Bid limits and helpers live in `lib/bid-rules.ts` (`ESCROW_MIN_BID` $5, `ESCROW_MAX_BID` $1,000, `validateBidAmount`, `resolveAgentBidAmount`, `formatUsd`). Arc's *native* gas balance has 18 decimals; the app only uses the 6-decimal ERC-20 view.
- Bid statuses: `placing | pending | accepted | rejected | refunded | counter_offered | failed`.
  - `placing`: recorded, not yet escrowed. `failed`: placement failed, **no USDC moved** (`failReason` says why).
  - `pending`: escrowed on-chain; `onChainBidId` + `onChainTxHash` are always set from the transaction receipt.
  - `accepted` / `rejected` / `refunded`: written **only after the settlement transaction is COMPLETE** on Arc. While one is in flight the bid stays `pending` with `settlementTxHash` (Circle id) + `settlementAction` ("confirming"). A failed settlement clears both, bumps `settlementAttempt` and sets `failReason`.
- `(escrowAddress, onChainBidId)` is a bid's on-chain identity: every escrow deployment numbers bids from 1. Unique index `bids_escrow_onchain_id_uq`. Rows from before this column have `escrowAddress = null`.
- `bidTxHash` / `settlementTxHash` hold **Circle transaction ids**; `onChainTxHash` / `settlementOnChainTxHash` hold chain hashes.
- Earnings, volume and anything shown as money moved must count only `accepted` (settled on-chain) bids; spend/budget counts everything except `failed`.
- `agent_logs.action` is a pg enum, so new actions need a schema change plus a migration (ask before pushing).
- One `profile` and one `bidder_config` per user (both are `unique` on `userId`). `profiles.minBid` is never below $5 (validated in the profile routes). `profiles.avatarUrl` is reserved for the market photo (UI in PR 3).

## How on-chain writes work (Circle)

**Circle transaction states:** `INITIATED → QUEUED → CLEARED → SENT → COMPLETE` (Arc skips `CONFIRMED`). Terminal: `COMPLETE`, `FAILED`, `CANCELLED`, `DENIED`. There is **no `SETTLED` or `REJECTED`**. Use `classifyTxState()`; never compare state strings by hand.

`executeContractCall` returns as soon as Circle accepts the request; it does **not** wait for the chain. For anything that can be retried use **`executeContractCallOnce({ …, opKey })`**: the op key (`approve:<bidId>`, `place:<bidId>`, `settle:<bidId>:<action>:<attempt>`) becomes a stable idempotency key and the transaction's `refId`, so a retried step returns the original transaction instead of sending a second one. uint256 args may be passed as `bigint` or decimal strings (bigints are stringified for the SDK). The SDK client is created fresh on every call (a module-cached client broke on warm Vercel functions). Keep it that way.

## Escrow flow

Contracts (addresses from env): **AttnnRegistry** (`registerCreator`, `getCreatorsByTag`, …) and **AttnnEscrow** (`placeBid`, `acceptBid`, `rejectBid`, `claimRefund`, `getBid`, …). All bid state changes live in `lib/bids.ts`; Inngest jobs in `inngest/bid-lifecycle.ts` orchestrate them.

1. **Creator onboarding:** `wallet/provision` creates the Circle wallet. `profile/create` writes the DB row (inactive). `profile/activate` calls `registerCreator` from the creator's wallet and sets `isActive`.
2. **Place bid** (`/api/bid/place`, bidder agent, counter handler) → `createBidIntent()`: validates amount vs floor/limits and the bidder's USDC balance, inserts a `placing` row with `escrowAddress`, sends `attnn/bid.requested`, returns **202**.
3. **`placeBid` job** (concurrency 1 per bidder, since `approve` overwrites the allowance): `approve` if the allowance is short → wait for `COMPLETE` → `placeBid` → wait → `finalizePlacement()` reads `BidPlaced` from the receipt (filtered to this escrow + bidder + creator) → `pending` with `onChainBidId`, then sends `attnn/bid.placed` for creator triage. Any Circle failure/revert → `failed`. Its `onFailure` never fails a bid whose `placeBid` was already submitted.
4. **Accept / reject / refund** → `submitSettlement()`: checks the actor, the on-chain bid (`getBid`: still Pending, inside/after the 3-day window) and the wallet, then **reserves** the bid (`settlementAction` + a `reserved:<ms>` sentinel in `settlementTxHash`) before sending, so two different settlements can't both reach Circle. It then sends the call, swaps the sentinel for the Circle id and sends `attnn/settlement.submitted`. A failed settlement re-reads the escrow (`reconcileFromEscrow`) in case another transaction already settled it; a reservation older than 5 min is resolved by `refId` lookup or released. **`confirmSettlement` job** → `finalizeSettlement()` sets the final status once `COMPLETE`.
5. **Counter** (`/api/bid/counter`, creator only, $5–$1,000 and > original) sets `counter_offered` (DB-only, USDC still escrowed) and sends `attnn/counter.received`; the bidder agent may place a **new** bid at that amount.
6. **3-day refund:** `autoRefund` (hourly at :17) calls `submitSettlement(refund)` from the bidder's wallet for `pending`/`counter_offered` bids older than 3 days + 30 min. Status becomes `refunded` only when the claim completes.
7. **Backstops:** `sweepInFlightBids` (every 10 min) finishes `placing` bids and in-flight settlements whose job ran out of time; a `placing` bid with no Circle id after 30 min is checked by `refId` before being failed. Circle webhooks (below) finish them immediately when a transaction reaches a terminal state.
8. **Repair / audit:** `node --env-file=.env.local scripts/reconcile-bids.mjs` — READ-ONLY report comparing the DB with the escrow (phantoms, unproven accepts, status mismatches).

## Agents

### Bidder agent (proactive): `runBidderAgent(userId)` in `lib/agent.ts`

Triggered by the `runActiveBidders` Inngest cron (`*/30 * * * *`, rechecks `isActive` per user) or on demand via `/api/agent/run`.

1. Loads `bidder_configs`. Stops if it's inactive.
2. Daily budget: sums today's (UTC) `bids.amount_usdc` for this bidder, **excluding `failed`**. Stops if the total is ≥ `dailyBudget`.
3. Discovery: `registry.getCreatorsByTag(tag)` for each `searchTags` entry, intersected with active DB profiles whose wallet address matches. Excludes self and any creator already bid on today (failed attempts count, so an unaffordable creator isn't retried every run).
4. Scores up to 10 creators with `evaluateCreatorForBidder`, keeps `proceed && score >= minFitScore`. The AI's `bidAmount` is only a hint: `resolveAgentBidAmount` clamps it to [creator floor, min(`maxBidPerCreator`, $1,000)] and skips creators whose floor is above the cap. Top 5 by score.
5. For each, rechecks the budget and calls `createBidIntent` (see Escrow flow). The agent never calls the chain itself and no longer sleeps between calls.

### Creator agent (reactive): `creatorAgentTriage` in `inngest/functions.ts`

Triggered by `attnn/bid.placed`, which is sent only **after** the bid is escrowed (so `onChainBidId` is always set; there is no chain-sync wait any more). Concurrency 10.

1. Loads the bid, the creator's profile and their pending bids (`queueDepth`, `highestBidAmount`).
2. `triageBidForCreator` (`lib/ai.ts`) returns a 0–10 score; thresholds are **hard-coded**: `≥ 8` accept (template or AI `draftReply`), `5–7` counter at 85% of the highest pending bid (floor $5) if a higher one exists else surface, `< 5` reject. `autoAcceptThreshold` is AI context only. Fallback when AISA fails: ≥ 2× minBid → 8, ≥ minBid → 5, else 3.
3. Records the score, then acts through `submitSettlement` (accept/reject) or sets `counter_offered`. A `BidError` (e.g. window passed) is returned in the run result, not thrown.

### Counter-offer handler: `handleCounterOffer`

Triggered by `attnn/counter.received`. If the counter fits the bidder's remaining daily budget, it calls `createBidIntent` for a **new** bid at the counter amount (placed by the `placeBid` job like any other). The original bid stays `counter_offered`, its USDC escrowed until the creator rejects it or `autoRefund` claims it.

### Other Inngest functions

`activityFeed` (`arc/bid.placed`, placeholder no-op), `bidExpiryNotification` (daily 02:00 UTC, logs bids refunding within 24h). `placeBid`, `confirmSettlement` and `sweepInFlightBids` live in `inngest/bid-lifecycle.ts`. All nine are exported in the `functions` array.

## x402 flow (`GET /api/c/[handle]`)

1. If there's a valid Auth.js session, the profile is returned free (`payer: "authenticated-user"`).
2. Otherwise `gate(req, "$0.001", endpoint)` in `lib/x402.ts` runs:
   - **No `payment-signature` header:** responds `402` with a base64 `PAYMENT-REQUIRED` header: `x402Version: 2`, `scheme: "exact"`, `network` = `arc.caip2` (`eip155:5042002` on testnet), `asset` = Arc USDC `0x3600…0000`, `amount: "1000"`, `payTo: SELLER_ADDRESS`, and `extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: arc.gatewayWallet }`.
   - **Header present, mock mode** (`X402_MOCK=1`, local dev): any header is accepted.
   - **Header present, real mode:** base64-decodes the header, then `BatchFacilitatorClient.verify` → `settle`, and returns 402 or 500 on failure.
3. It returns `{ handle, unlocked, payer, profile: { handle, bio, tags, minBid, isActive } }`. Payment settles **before** the profile lookup, so an unknown handle returns 404 after the charge. The computed `paymentResponseHeader` isn't attached to the response. There's no idempotency yet (planned).

`/api/x402/access` is a separate stub that only simulates access.

## Webhooks

All three webhook routes authenticate the caller before touching the DB, and all three read the **raw body first**, because both schemes sign the exact bytes. Never switch them back to `req.json()`.

- **Circle** (`/api/webhooks/circle`, `/api/webhooks/circle-events`): `verifyCircleSignature(rawBody, signature, keyId)` from `lib/circle-webhook.ts`. Circle v2 notifications are ECDSA_SHA_256-signed: the base64 DER signature arrives in `X-Circle-Signature` and the signing key's id in `X-Circle-Key-Id`. The helper fetches that key from `GET {CIRCLE_API_BASE_URL or https://api.circle.com}/v2/notifications/publicKey/{keyId}` with `Authorization: Bearer $CIRCLE_API_KEY`, imports the base64 DER SPKI key, and verifies with `crypto.createVerify("SHA256")`. W3S serves testnet and mainnet keys from the same host, so the `CIRCLE_API_BASE_URL` override is rarely needed. Keys are cached in a module-level `Map` by key id, since a key is static for its id. A key whose reported `algorithm` isn't `ECDSA_SHA_256` only logs a warning, because the verification step catches a genuinely wrong key by itself and a relabelled one must not stop bid syncing. The helper never throws: a missing header, a failed fetch or a bad signature logs the reason and returns `false`, and the route then returns **401** before parsing anything. There is no `CIRCLE_WEBHOOK_SECRET`; verification depends on `CIRCLE_API_KEY`.

  Both Circle routes also de-duplicate: `circle` keys `webhook_events` on the payload's `id`/`eventId`, and `circle-events` on `notificationId` with source `circle-events`, returning early when the row already exists (a verified notification is still replayable). A `circle-events` payload with no `notificationId` is processed anyway, with a warning.
- **Arc/Alchemy** (`/api/webhooks/arc`): HMAC-SHA256 hex digest of the raw body keyed by `ALCHEMY_WEBHOOK_SECRET`, taken from `x-alchemy-signature` or `x-hub-signature-256`. It **fails closed**: a missing secret returns 500 ("Webhook not configured"), and a mismatch returns 401. The comparison checks lengths before `crypto.timingSafeEqual`, which throws on unequal buffers.

Handlers are idempotent; a notification is recorded in `webhook_events` **only after it is handled**, and handler errors return **500** so Circle retries.

- `circle-events` (contract event logs): ignores other chains and **any contract that isn't the current `ATTN_ESCROW_CONTRACT`**. `BidPlaced` triggers `finalizePlacement` for that bidder's placing bids (no bidder+amount guessing). `BidAccepted/Rejected/Refunded` finish an in-flight settlement through Circle, or set the final status from the log itself.
- `circle` (wallet transaction notifications): when a transaction reaches a terminal state, finishes the bid whose `bidTxHash` or `settlementTxHash` is that Circle id.
- `arc` mostly records events for idempotency.
