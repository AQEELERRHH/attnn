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
  dashboard/                           Portfolio. page.tsx (server: wallet, on-chain balance, bids, totals, logs)
                                       dashboard-client.tsx (shell: header, wallet dialog, Bidding | Creator | Agent)
                                       bidder-view (positions + history), creator-view (inbox, reply composer,
                                       counter, market settings), agent-console (status, strategy, run log),
                                       creator-/bidder-setup-form, wallet-dialog, fund-wallet-card, types.ts
  c/[handle]/                          public creator profile page (UI)
  api/
    auth/[...nextauth]/                Auth.js handlers
    wallet/{provision,balance,send,agent}  Circle wallet create / USDC balance / USDC transfer / agent wallet create + move USDC main⇄agent
    profile/{create,update,activate}   creator profile CRUD; activate = registerCreator() on-chain
    bidder-config/create               upsert bidder agent config
    bid/{place,accept,reject,counter,rate}  escrow actions (manual/UI path); rate = bidder's 👍/👎 on a paid reply
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
components/market/  market design system (see below); reference page app/design/
contracts/      Foundry project: src/AttnnEscrow.sol, src/AttnnRegistry.sol, test/, script/Deploy.s.sol
```

## Market design system (`components/market/`)

Shared UI for market screens; reference page at `/design` (local + Vercel previews, 404 on production).

- **Colour roles** (palette unchanged from the original site): gold = money, open bids, primary action · green = settled / up · coral = refund countdowns, warnings, down · lavender = links, tags, focus ring · purple = decorative only (fails text contrast) · `text-dim` = placeholders/disabled only.
- **Numbers**: every number uses `.num` / `<Num>` / `<Money atomic=…>` (DM Mono, tabular digits). Format with `lib/format.ts` (`formatMoney`, `formatChange`, `formatDuration`, `timeAgo`, `refundCountdown`, `dollarsToAtomic`); never float maths on money.
- **Bid status text** comes only from `bidDisplay()` in `lib/bid-display.ts`, so every screen labels a bid the same way. Pass `settlementOnChainTxHash` when you have it: an `accepted` row without one shows "Unverified" (pre-fix data).
- **Portfolio numbers** come from `lib/portfolio.ts` (`computeBidderTotals`, `computeCreatorTotals`, `bookRanks`) plus `spentToday()` from `lib/agent.ts` (same rule the agent uses). In escrow = `pending` + `counter_offered` only; `placing` is shown as "confirming". Earnings count only cleared bids. The dashboard polls `router.refresh()` every 15 s while a bid is placing or settling or the creator's registration is confirming, for at most 10 minutes; then it shows a "Refresh" button.
- **Market numbers** come from `lib/market.ts` (`computeCreatorStats`, `computePlatformTotals`, `loadMarketBids`). "Cleared" = `accepted` **with** `settlementOnChainTxHash`; reply rate = cleared ÷ (cleared + refunded) over 30 days; top bid / open bids count only `pending` + `counter_offered`. Never show placeholder stats.
- Pages: `/` (homepage: top markets, live platform numbers, ISR 60 s) and `/creators` (markets table, ISR 60 s) both load through `app/creators/load.ts` (`loadMarkets`) and `/c/[handle]` (market page; bio/open-to free when signed in, x402 for agents). `SiteHeader` is the shared top bar. Pass the server's `now` into client components that show relative times, to avoid hydration mismatches.
- **Market photo:** `profiles.avatarUrl`. Upload via `POST /api/profile/avatar` (browser resizes to 256×256 and re-encodes, server sniffs type, ≤512 KB) to Supabase Storage bucket `avatars` (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; bucket auto-created); `DELETE` removes. Upload is the only way to set a photo (the "Use my Google photo" option was removed; photos linked earlier keep showing, which is why `next.config.ts` still allows `lh3.googleusercontent.com`).
- Bids to creators with `availabilityStatus = "not_accepting"` are refused by `createBidIntent` and skipped by the bidder agent.
- Components: `Panel`, `StatStrip`, `StatInline`, `StatusChip`, `Tag`, `CreatorAvatar`, `Sparkline`, `PlatformStats`, `LiveFills` (server-safe), and `MarketTable`, `OrderBook`, `BidTicket` (client). `MarketTable` takes render functions, so use it from client components only; pass `mobileCard` to get a stacked card list below `sm` instead of a sideways-scrolling table. Every page uses `SiteHeader` and must not scroll sideways at 320 px. Buttons: primary is solid gold with dark text.

## Data model essentials

- **USDC amounts are stored as `text` in atomic units (6 decimals)**: `"1000000"` = $1. Handle them with `BigInt`, never float math. Bid limits and helpers live in `lib/bid-rules.ts` (`ESCROW_MIN_BID` from `NEXT_PUBLIC_ESCROW_MIN_BID_USDC`, which **must equal the deployed escrow's `MIN_BID`**: unset = $5 for the current testnet contract; the contract source and mainnet deployment use **$1**, as does the registry's creator-floor check. `ESCROW_MAX_BID` $1,000, `validateBidAmount`, `resolveAgentBidAmount`, `formatUsd`). Arc's *native* gas balance has 18 decimals; the app only uses the 6-decimal ERC-20 view.
- Bid statuses: `placing | pending | accepted | rejected | refunded | counter_offered | failed`.
  - `placing`: recorded, not yet escrowed. `failed`: placement failed, **no USDC moved** (`failReason` says why).
  - `pending`: escrowed on-chain; `onChainBidId` + `onChainTxHash` are always set from the transaction receipt.
  - `accepted` / `rejected` / `refunded`: written **only after the settlement transaction is COMPLETE** on Arc. While one is in flight the bid stays `pending` with `settlementTxHash` (Circle id) + `settlementAction` ("confirming"). A failed settlement clears both, bumps `settlementAttempt` and sets `failReason`.
- **Replies** (`lib/reply-rules.ts`, client-safe): at least `REPLY_MIN_CHARS` (100) and at most 2,000 characters, checked by the composer, `/api/bid/accept`, `submitSettlement` and for reply templates (profile create/update; a template is optional but if set must pass). `bids.replySource` records who wrote it: `creator`, `template` (the saved template word for word, sent by the creator or the agent) or `ai` (creator agent's `draftReply`); null on old rows. `bids.replyRating` (1 / -1 / null) is the bidder's verdict, set via `POST /api/bid/rate` (bidder only, cleared bids only, can change or clear). `computeCreatorStats` reports `ratingsUp/Down`, `repliesKnown`, `autoReplies` (30 days); the market page shows "Rated worth it" and "Auto-replies" and tags each fill. Migration 0005.
- `replacesBidId` (nullable self-reference): set on a re-bid placed at a creator's counter price; points at the countered original. Unique where not null.
- `(escrowAddress, onChainBidId)` is a bid's on-chain identity: every escrow deployment numbers bids from 1. Unique index `bids_escrow_onchain_id_uq`. Rows from before this column have `escrowAddress = null` and on testnet live in the **original 14-day escrow** (`0x3066…8ab3`), not the current one. Never assume null = current: `resolveBidEscrow()` finds the bid among `knownEscrowAddresses()` (current + `legacyEscrowAddresses()`, from `ATTN_LEGACY_ESCROW_CONTRACTS`, testnet default the old escrow) by matching id + bidder + creator + amount on-chain, and stamps the row.
- `bidTxHash` / `settlementTxHash` hold **Circle transaction ids**; `onChainTxHash` / `settlementOnChainTxHash` hold chain hashes.
- Earnings, volume and anything shown as money moved must count only `accepted` (settled on-chain) bids; spend/budget counts everything except `failed`.
- `agent_logs.action` is a pg enum, so new actions need a schema change plus a migration (ask before pushing).
- **Wallets** (`lib/wallets.ts`): each user has a `main` wallet and, once they use the bidder agent, an `agent` wallet (`wallets.purpose`, unique per user + purpose, migration 0006; a duplicate wallet set aside by hand is `legacy` and is never picked as main or agent). **Never look a wallet up by userId alone**: user actions, creator registration/payouts and Send use `mainWallet()`; the bidder agent and counter re-bids bid with `createBidIntent({ fromAgentWallet: true })`; settling a bid uses `walletByAddress(userId, bid.bidderAddress | bid.creatorAddress)`, so an agent bid's refund goes back to the agent wallet. The agent stops ("agent_stopped") if it has no agent wallet or less than the minimum bid in it. `POST /api/wallet/agent` `{action: "create" | "fund" | "withdraw", amount}` (user session only) creates it or moves USDC main ⇄ agent, keeping $0.05 behind for the transfer's gas. `bidder-config/create` creates the agent wallet best-effort. Shown on the Agent tab (`agent-wallet-card.tsx`) and as the first Spending policy line. This caps what a buggy agent can spend; it does not protect against a compromised Attnn server (Attnn holds both keys).
- One `profile` and one `bidder_config` per user (both are `unique` on `userId`). `profiles.minBid` is never below `ESCROW_MIN_BID` (validated in the profile routes). `profiles.avatarUrl` is the market photo (see Market design system).

## How on-chain writes work (Circle)

**Circle transaction states:** `INITIATED → QUEUED → CLEARED → SENT → COMPLETE` (Arc skips `CONFIRMED`). Terminal: `COMPLETE`, `FAILED`, `CANCELLED`, `DENIED`. There is **no `SETTLED` or `REJECTED`**. Use `classifyTxState()`; never compare state strings by hand.

`executeContractCall` returns as soon as Circle accepts the request; it does **not** wait for the chain. For anything that can be retried use **`executeContractCallOnce({ …, opKey })`**: the op key (`approve:<bidId>`, `place:<bidId>`, `settle:<bidId>:<action>:<attempt>`) becomes a stable idempotency key and the transaction's `refId`, so a retried step returns the original transaction instead of sending a second one. uint256 args may be passed as `bigint` or decimal strings (bigints are stringified for the SDK). The SDK client is created fresh on every call (a module-cached client broke on warm Vercel functions). Keep it that way.

## Escrow flow

Contracts (addresses from env): **AttnnRegistry** (`registerCreator`, `getCreatorsByTag`, …) and **AttnnEscrow** (`placeBid`, `acceptBid`, `rejectBid`, `claimRefund`, `getBid`, …). All bid state changes live in `lib/bids.ts`; Inngest jobs in `inngest/bid-lifecycle.ts` orchestrate them.

1. **Creator onboarding:** `wallet/provision` creates the Circle wallet. `profile/create` writes the DB row (inactive). `profile/activate` → `submitRegistration()` (`lib/registration.ts`) sends `registerCreator` from the creator's wallet (reserving first, so a double click can't send two) and returns `status: "registering"`. `isActive` is set **only once `isActiveCreator(wallet)` is true on the registry**, by the `confirmRegistration` job (`attnn/creator.registering`) or the 10-minute sweep. A failed transaction sets `profiles.registrationError` (migration 0004) and the creator can retry. State: `registrationState()` → active / registering / failed / none.
2. **Place bid** (`/api/bid/place`, bidder agent, counter handler) → `createBidIntent()`: validates amount vs floor/limits and the bidder's USDC balance, inserts a `placing` row with `escrowAddress`, sends `attnn/bid.requested`, returns **202**.
3. **`placeBid` job** (concurrency 1 per bidder, since `approve` overwrites the allowance): `approve` if the allowance is short → wait for `COMPLETE` → `placeBid` → wait → `finalizePlacement()` reads `BidPlaced` from the receipt (filtered to this escrow + bidder + creator) → `pending` with `onChainBidId`, then sends `attnn/bid.placed` for creator triage. Any Circle failure/revert → `failed`. Its `onFailure` never fails a bid whose `placeBid` was already submitted.
4. **Accept / reject / refund** → `submitSettlement()`: checks the actor, resolves the bid's escrow (`resolveBidEscrow`, so legacy bids settle in the old contract), checks the on-chain bid (`getBid` must match bidder/creator/amount; still Pending; inside/after **that contract's** `REFUND_PERIOD`, 3 days now, 14 in the original) and the wallet, then **reserves** the bid (`settlementAction` + a `reserved:<ms>` sentinel in `settlementTxHash`) before sending, so two different settlements can't both reach Circle. It then sends the call, swaps the sentinel for the Circle id and sends `attnn/settlement.submitted`. A failed settlement re-reads the escrow (`reconcileFromEscrow`) in case another transaction already settled it; a reservation older than 5 min is resolved by `refId` lookup or released. **`confirmSettlement` job** → `finalizeSettlement()` sets the final status once `COMPLETE`.
5. **Counter** (`/api/bid/counter`, creator only, $5–$1,000 and > original) sets `counter_offered` (DB-only, USDC still escrowed) and sends `attnn/counter.received`; the bidder agent may place a **new** bid at that amount with `replacesBidId` = the original (one re-bid per original, unique index). When the re-bid is escrowed, `notifyBidEscrowed` also sends `attnn/rebid.escrowed` and `declineReplacedBid()` rejects the original from the creator's wallet, so the bidder's USDC isn't locked twice; if it can't (already settled, window passed, no gas) the original still refunds via `autoRefund`. A creator can accept a countered bid at its original price **unless** a live re-bid (placing/pending/counter_offered/accepted) stands in for it.
6. **3-day refund:** `autoRefund` (hourly at :17) calls `submitSettlement(refund)` from the bidder's wallet for `pending`/`counter_offered` bids older than 3 days + 30 min. Status becomes `refunded` only when the claim completes.
7. **Backstops:** `sweepInFlightBids` (every 10 min) finishes `placing` bids and in-flight settlements whose job ran out of time; a `placing` bid with no Circle id after 30 min is checked by `refId` before being failed. Circle webhooks (below) finish them immediately when a transaction reaches a terminal state.
8. **Repair / audit:** `node --env-file=.env.local scripts/reconcile-bids.mjs` — READ-ONLY report comparing the DB with the escrow (phantoms, unproven accepts, status mismatches).
9. **Repair open bids (manual):** send `attnn/admin.reconcile-bids` from the Inngest dashboard. `{}` = dry run (report only); `{ "apply": true }` = links NULL-escrow / wrong-id rows to their real on-chain bid and marks rows with no on-chain bid in any known escrow as `failed` ("never escrowed"). It also finds bids still **Pending on-chain** that no open row owns ("orphans", e.g. rows marked accepted before the settlement fix with no settlement tx) and reopens the matching closed row as `pending` so autoRefund / the creator can settle it; on-chain bids with no row at all are reported as `unmatchedOnChain`. Indexes every bid of every known escrow (1..`getBidCount`). Logic in `lib/reconcile.ts` (`classifyOpenRows`, `findOrphans` are pure). Skips bids with a settlement in flight. `submitSettlement` also writes the escrow's final status (`reconcileFromEscrow`) when it finds a bid already settled on-chain.

## Agents

### Bidder agent (proactive): `runBidderAgent(userId)` in `lib/agent.ts`

Triggered by the `runActiveBidders` Inngest cron (`*/30 * * * *`, rechecks `isActive` per user) or on demand via `/api/agent/run`.

1. Loads `bidder_configs`. Stops if it's inactive.
2. Daily budget: sums today's (UTC) `bids.amount_usdc` for this bidder, **excluding `failed`**. Stops if the total is ≥ `dailyBudget`.
3. Discovery: active DB profiles whose **current** tags overlap `searchTags` (case-insensitive, best overlap first; the testnet registry can't update tags, so on-chain tags go stale), excluding self, paused markets and any creator already bid on today (failed attempts count, so an unaffordable creator isn't retried every run). Each candidate must pass `registry.isActiveCreator(wallet)` on Arc (`isActiveOnRegistry` in `lib/registration.ts`); stops at 10 verified.
4. Scores them with `evaluateCreatorForBidder`, keeps `proceed && score >= minFitScore`. It returns `null` when the AI fails, and **there is no fallback**: an unscored creator is skipped, never bid on blind. If no creator could be scored the run logs `agent_stopped` ("AI unavailable") and places nothing. The AI's `bidAmount` is only a hint: `resolveAgentBidAmount` clamps it to [creator floor, min(`maxBidPerCreator`, $1,000)] and skips creators whose floor is above the cap. Top 5 by score.
5. For each, rechecks the budget and calls `createBidIntent({ …, fromAgentWallet: true })` (see Escrow flow). The agent never calls the chain itself and no longer sleeps between calls.

The **Spending policy** card (`app/dashboard/agent-policy.tsx`, Agent tab) and the About page's "How our agents are kept safe" list state these limits and the escrow's rules to users. Every line must stay true to `lib/agent.ts`, `createBidIntent`, `handleCounterOffer` and `AttnnEscrow.sol`; change them together.

### Creator agent (reactive): `creatorAgentTriage` in `inngest/functions.ts`

Triggered by `attnn/bid.placed`, which is sent only **after** the bid is escrowed (so `onChainBidId` is always set; there is no chain-sync wait any more). Concurrency 5 (the Inngest plan maximum; anything higher makes the whole app sync fail).

1. Loads the bid, the creator's profile and their pending bids (`queueDepth`, `highestBidAmount`).
2. `triageBidForCreator` (`lib/ai.ts`) returns a 0–10 score (accepts reply with the creator's template if it passes the reply rules, else an AI `draftReply`, which has **no canned fallback**: if the AI fails or writes under 100 characters the bid is surfaced for the creator instead); thresholds are **hard-coded**: `≥ 8` accept (template or AI `draftReply`), `5–7` counter via `counterAmountFor()` (85% of the highest pending bid, at least the creator's floor, only if that is more than this bid and ≤ $1,000) else surface, `< 5` reject. `autoAcceptThreshold` is AI context only. Fallback when AISA fails: ≥ 2× minBid → 8, ≥ minBid → 5, else 3.
3. Records the score, then acts through `submitSettlement` (accept/reject) or sets `counter_offered`. A re-bid (`replacesBidId` set) is never countered or rejected by the agent; those outcomes become `surface`. A `BidError` (e.g. window passed) is returned in the run result, not thrown.

### Counter-offer handler: `handleCounterOffer`

Triggered by `attnn/counter.received`. Skips if the original is no longer `counter_offered` or is settling, or if the bidder's agent is paused; declines counters above `maxBidPerCreator`. If the counter fits the bidder's remaining daily budget, it calls `createBidIntent({ …, replacesBidId })` for a **new** bid at the counter amount (placed by the `placeBid` job like any other; a retry returns the same re-bid). The original stays `counter_offered` until `declineReplacedBidJob` (`attnn/rebid.escrowed`) releases it, the creator settles it, or `autoRefund` claims it.

### Other Inngest functions

`activityFeed` (`arc/bid.placed`, placeholder no-op), `bidExpiryNotification` (daily 02:00 UTC, logs bids refunding within 24h). `placeBid`, `confirmSettlement`, `confirmRegistration` and `sweepInFlightBids` live in `inngest/bid-lifecycle.ts`. `declineReplacedBidJob` and `reconcileOpenBidsJob` live in `inngest/functions.ts`. All twelve are exported in the `functions` array.

## x402 flow (`GET /api/c/[handle]`)

1. The profile is looked up **first**; an unknown handle is a 404 and nobody is charged.
2. With a valid Auth.js session, the profile is free (`payer: "authenticated-user"`).
3. Otherwise `gate(req, { price: "$0.001", endpoint, resource: "profile:<handle>", description })` in `lib/x402.ts`:
   - **No `SELLER_ADDRESS` and no `X402_MOCK=1`:** 503 "payments not configured" (fails closed; it used to fall back to mock = free).
   - **No `Payment-Signature` header:** `402` with a base64 `PAYMENT-REQUIRED` header: `x402Version: 2`, `scheme: "exact"`, `network` = `arc.caip2`, `asset` = Arc USDC, `amount: "1000"`, `payTo: SELLER_ADDRESS`, `extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: arc.gatewayWallet }`. This is what Circle's `GatewayClient.pay()` expects.
   - Verification and settlement go to the Gateway API for the active network (`arc.gatewayApiUrl`: `gateway-api-testnet.circle.com` on testnet, `gateway-api.circle.com` on mainnet). `BatchFacilitatorClient` defaults to mainnet, so always pass the URL. `maxTimeoutSeconds` is 7 days + 100 s, matching what `GatewayClient` signs. Rejections are logged with Gateway's `invalidReason`.
   - **Header present:** sha256 of the header is the idempotency key in `x402_payments` (migration 0003). Seen before for the same resource → returns the stored receipt (`replay: true`), no second settlement; for another resource → 409. Otherwise decode (400 if malformed; 400 if `accepted.network` isn't ours) → `BatchFacilitatorClient.verify` → `settle` → insert the `x402_payments` row (resource, payer, amount, network, Gateway `transaction`).
   - `X402_MOCK=1` (local only): any header accepted, receipt `transaction: "mock"`.
4. Paid responses carry a **`PAYMENT-RESPONSE`** header (base64 `{ success, transaction, network, payer, amount }`, read by `GatewayClient.pay()`) and the same receipt as `payment` in the JSON body, plus the profile (`handle, bio, tags, openTo, availabilityStatus, minBid, isActive, market`).

`GET /api/x402/receipts` is a public proof endpoint: totals and the latest 20 Gateway receipts. `scripts/x402-demo.mjs` is the buyer-side proof: `BUYER_PRIVATE_KEY=0x… node scripts/x402-demo.mjs <handle> [--deposit 0.10] [--base URL]` uses `GatewayClient` on `arcTestnet` (testnet key only; fund it from the faucet, deposit into Gateway once). `@circle-fin/x402-batching` 3.0.4 lists **Arc Testnet but not Arc mainnet**; confirm Arc mainnet Gateway support with Circle before the mainnet switch. `/api/x402/access` is a separate stub that only simulates access.

## Webhooks

All three webhook routes authenticate the caller before touching the DB, and all three read the **raw body first**, because both schemes sign the exact bytes. Never switch them back to `req.json()`.

- **Circle** (`/api/webhooks/circle`, `/api/webhooks/circle-events`): `verifyCircleSignature(rawBody, signature, keyId)` from `lib/circle-webhook.ts`. Circle v2 notifications are ECDSA_SHA_256-signed: the base64 DER signature arrives in `X-Circle-Signature` and the signing key's id in `X-Circle-Key-Id`. The helper fetches that key from `GET {CIRCLE_API_BASE_URL or https://api.circle.com}/v2/notifications/publicKey/{keyId}` with `Authorization: Bearer $CIRCLE_API_KEY`, imports the base64 DER SPKI key, and verifies with `crypto.createVerify("SHA256")`. W3S serves testnet and mainnet keys from the same host, so the `CIRCLE_API_BASE_URL` override is rarely needed. Keys are cached in a module-level `Map` by key id, since a key is static for its id. A key whose reported `algorithm` isn't `ECDSA_SHA_256` only logs a warning, because the verification step catches a genuinely wrong key by itself and a relabelled one must not stop bid syncing. The helper never throws: a missing header, a failed fetch or a bad signature logs the reason and returns `false`, and the route then returns **401** before parsing anything. There is no `CIRCLE_WEBHOOK_SECRET`; verification depends on `CIRCLE_API_KEY`.

  Both Circle routes also de-duplicate: `circle` keys `webhook_events` on the payload's `id`/`eventId`, and `circle-events` on `notificationId` with source `circle-events`, returning early when the row already exists (a verified notification is still replayable). A `circle-events` payload with no `notificationId` is processed anyway, with a warning.
- **Arc/Alchemy** (`/api/webhooks/arc`): HMAC-SHA256 hex digest of the raw body keyed by `ALCHEMY_WEBHOOK_SECRET`, taken from `x-alchemy-signature` or `x-hub-signature-256`. It **fails closed**: a missing secret returns 500 ("Webhook not configured"), and a mismatch returns 401. The comparison checks lengths before `crypto.timingSafeEqual`, which throws on unequal buffers.

Handlers are idempotent; a notification is recorded in `webhook_events` **only after it is handled**, and handler errors return **500** so Circle retries.

- `circle-events` (contract event logs): ignores other chains and **any contract that isn't the current `ATTN_ESCROW_CONTRACT`**, and only matches rows whose `escrowAddress` is that contract (never NULL rows: same id, different bid). `BidPlaced` triggers `finalizePlacement` for that bidder's placing bids (no bidder+amount guessing). `BidAccepted/Rejected/Refunded` finish an in-flight settlement through Circle, or set the final status from the log itself.
- `circle` (wallet transaction notifications): when a transaction reaches a terminal state, finishes the bid whose `bidTxHash` or `settlementTxHash` is that Circle id.
- `arc` mostly records events for idempotency.
