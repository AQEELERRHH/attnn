# CLAUDE.md

Attnn. is an agentic attention marketplace on Arc (Circle's USDC-gas L1). Bidders put USDC into an on-chain escrow to reach creators. Creators earn it by replying, and bidders get a refund if there's no reply within 14 days. AI agents work both sides. Product rationale lives in `PRODUCT_DECISIONS.md`, and the pitch plus setup steps are in `README.md`. Where the README and the code disagree, trust the code.

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
| Chain | Arc Testnet (chain id 5042002), viem for reads | Chain def, ABIs and USDC helpers are in `lib/arc.ts` |
| Wallets | Circle Developer-Controlled Wallets SDK (EOA, `ARC-TESTNET`) | All on-chain writes go through `executeContractCall` in `lib/circle.ts` |
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
inngest/functions.ts                   all Inngest functions (see below)
lib/
  agent.ts      runBidderAgent() (bidder agent) + legacy autoAcceptBid() (unused)
  ai.ts         callAI, evaluateCreatorForBidder, triageBidForCreator, scoreBidForCreator, draftReply
  arc.ts        arcTestnet chain, usdcAbi/registryAbi/escrowAbi, publicClient, parseUsdc/formatUsdc
  circle.ts     getSDK (fresh client per call), provisionUserWallet, executeContractCall, transferUSDC
  x402.ts       gate(): 402 challenge + BatchFacilitatorClient verify/settle
  auth.ts       NextAuth config + Session type augmentation
  db/           schema.ts (10 tables), client.ts (global-cached connection in dev)
  profiles.ts   getFullProfileByHandle
  inngest.ts    Inngest client (id "attnn")
components/ui/  Radix/shadcn primitives
contracts/      git submodule link with NO .gitmodules, so the Solidity sources are not in this repo
```

## Data model essentials

- **USDC amounts are stored as `text` in atomic units (6 decimals)**: `"1000000"` = $1. Handle them with `BigInt`, never float math. Use `parseUsdc`/`formatUsdc` from `lib/arc.ts`.
- `bids` rows mirror on-chain bids. `onChainBidId` starts as `null` and is filled in later by the Circle events webhook. `bidTxHash` / `settlementTxHash` hold **Circle transaction IDs**, not chain hashes. The real hashes go in `onChainTxHash` / `settlementOnChainTxHash`.
- Bid statuses: `pending | accepted | rejected | refunded | counter_offered`.
- `agent_logs.action` is a pg enum, so new actions need a schema change plus a migration (ask before pushing).
- One `profile` and one `bidder_config` per user (both are `unique` on `userId`). One wallet per user in practice.

## How on-chain writes work (Circle)

`executeContractCall({ walletId, contractAddress, abi, functionName, args })` builds the `abiFunctionSignature` from the ABI and calls `createContractExecutionTransaction`. **It returns as soon as Circle accepts the transaction (Circle tx id + initial state). It does not wait for on-chain confirmation**, so DB updates that follow a call are optimistic. The SDK client is deliberately created fresh on every call, because a module-cached client broke on warm Vercel functions with a stale entity-secret ciphertext. Keep it that way.

## Escrow flow

Contracts on Arc Testnet (addresses come from env): **AttnnRegistry** (`registerCreator`, `getCreatorsByTag`, …) and **AttnnEscrow** (`placeBid`, `acceptBid`, `rejectBid`, `claimRefund`, `getBid`, …).

1. **Creator onboarding:** `wallet/provision` creates the Circle wallet. `profile/create` writes the DB row (inactive). `profile/activate` calls `registerCreator(handle, minBid, tags, profileURI)` from the creator's wallet and sets `isActive`.
2. **Place bid** (`/api/bid/place`): USDC `approve(escrow, amount)` → sleep 8 s → `placeBid(creator, amount, message, isPrivate)` → insert a `bids` row (`pending`, `onChainBidId: null`) → send Inngest event `attnn/bid.placed`.
3. **Bid ID sync** (`/api/webhooks/circle-events`): on a `BidPlaced` log it finds the newest pending bid with the same `bidderAddress` + `amountUsdc` and a null `onChainBidId`, then sets `onChainBidId` + `onChainTxHash`. `BidAccepted` / `BidRejected` logs set status + `settlementOnChainTxHash`.
4. **Accept** (`/api/bid/accept`, reply ≥ 10 chars, enforced on-chain too) → `acceptBid(bidId, reply)` releases USDC to the creator. **Reject** (`/api/bid/reject`) → `rejectBid(bidId)` refunds the bidder. Both return 400 until `onChainBidId` has synced.
5. **Counter** (`/api/bid/counter`, creator only, amount ≥ $5 and > original) sets status `counter_offered` and sends `attnn/counter.received`.
6. **14-day refund:** the contract's `claimRefund` enforces the window. The `autoRefund` cron (daily 03:00 UTC) currently **only marks DB rows `refunded`. It does not call `claimRefund` on-chain**.

## Agents

### Bidder agent (proactive): `runBidderAgent(userId)` in `lib/agent.ts`

Triggered by the `runActiveBidders` Inngest cron (`*/10 * * * *`, rechecks `isActive` per user) or on demand via `/api/agent/run`.

1. Loads `bidder_configs`. Stops if it's inactive.
2. Daily budget: sums `bids.amount_usdc` for this bidder since UTC midnight, counting **all statuses**. Stops if the total is ≥ `dailyBudget`.
3. Discovery: `registry.getCreatorsByTag(tag)` for each `searchTags` entry, intersected with active DB profiles whose wallet address matches. It excludes self and any creator already bid on today.
4. Scores up to 10 creators with `evaluateCreatorForBidder(creator, goal)`. It keeps those with `proceed && score >= minFitScore` and takes the top 5 by score.
5. For each one it rechecks the budget, then runs `approve` → sleep **4 s** → `placeBid` (message = `defaultMessage`), inserts the `bids` row and logs `bid_placed` to `agent_logs`.
   - The bid amount comes from the AI. The fallback is `1000000` ($1). `maxBidPerCreator` is **not** enforced here.
   - This path does **not** send `attnn/bid.placed`, so agent-placed bids don't get creator triage.

### Creator agent (reactive): `creatorAgentTriage` in `inngest/functions.ts`

Triggered by `attnn/bid.placed`.

1. Loads the bid, the creator's profile and wallet, and all of the creator's pending bids (`queueDepth`, `highestBidAmount`).
2. `triageBidForCreator` (`lib/ai.ts`): the AI returns a 0–10 score. The decision thresholds are **hard-coded**:
   - `≥ 8` → `accept`, with `autoReplyTemplate` or else an AI `draftReply`.
   - `5–7` → `counter_offer` at 85% of the highest pending bid (floor $5) if a higher pending bid exists, otherwise `surface`.
   - `< 5` → `reject`.
   - The profile's `autoAcceptThreshold` is sent to the AI as context only and doesn't gate the decision.
   - Fallback when AISA fails: ≥ 2× minBid → 8, ≥ minBid → 5, else 3.
3. Acts: `acceptBid` / `rejectBid` from the creator's wallet, or sets `counter_offered` and sends `attnn/counter.received`, or (surface) only stores the score. Accept and reject are **skipped silently if `onChainBidId` is still null**, which is likely right after placement because the ID arrives asynchronously via webhook.

### Counter-offer handler: `handleCounterOffer`

Triggered by `attnn/counter.received`. If the counter amount fits the bidder's remaining daily budget, it runs `approve` then `placeBid` for a **new** bid at the counter amount (no delay between the two) and inserts a new `bids` row. The original bid stays `counter_offered`, and its escrowed USDC remains locked until it's rejected or refunded.

### Other Inngest functions

`activityFeed` (`arc/bid.placed`, placeholder no-op), `bidExpiryNotification` (daily 02:00 UTC, only logs). All six are exported in the `functions` array.

## x402 flow (`GET /api/c/[handle]`)

1. If there's a valid Auth.js session, the profile is returned free (`payer: "authenticated-user"`).
2. Otherwise `gate(req, "$0.001", endpoint)` in `lib/x402.ts` runs:
   - **No `payment-signature` header:** responds `402` with a base64 `PAYMENT-REQUIRED` header: `x402Version: 2`, `scheme: "exact"`, `network: "eip155:5042002"`, `asset` = Arc USDC `0x3600…0000`, `amount: "1000"`, `payTo: SELLER_ADDRESS`, and `extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: 0x0077777d… }` (Gateway wallet).
   - **Header present, mock mode** (`X402_MOCK=1`, local dev): any header is accepted.
   - **Header present, real mode:** base64-decodes the header, then `BatchFacilitatorClient.verify` → `settle`, and returns 402 or 500 on failure.
3. It returns `{ handle, unlocked, payer, profile: { handle, bio, tags, minBid, isActive } }`. Payment settles **before** the profile lookup, so an unknown handle returns 404 after the charge. The computed `paymentResponseHeader` isn't attached to the response. There's no idempotency yet (planned).

`/api/x402/access` is a separate stub that only simulates access.
