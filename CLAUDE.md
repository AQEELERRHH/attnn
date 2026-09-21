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

- **USDC amounts are stored as `text` in atomic units (6 decimals)**: `"1000000"` = $1. Handle them with `BigInt`, never float math. Use `parseUsdc`/`formatUsdc` from `lib/arc.ts`.
- `bids` rows mirror on-chain bids. `onChainBidId` starts as `null` and is filled in later by the Circle events webhook. `bidTxHash` / `settlementTxHash` hold **Circle transaction IDs**, not chain hashes. The real hashes go in `onChainTxHash` / `settlementOnChainTxHash`.
- Bid statuses: `pending | accepted | rejected | refunded | counter_offered`.
- `agent_logs.action` is a pg enum, so new actions need a schema change plus a migration (ask before pushing).
- One `profile` and one `bidder_config` per user (both are `unique` on `userId`). One wallet per user in practice.

## How on-chain writes work (Circle)

**Pass `uint256` args as decimal strings, never `BigInt`.** The Circle SDK JSON-serialises `abiParameters`, and `JSON.stringify` throws on a `BigInt` unless something has patched `BigInt.prototype.toJSON` (the accept/reject API routes declare that patch at the top of their own files; nothing else does).

`executeContractCall({ walletId, contractAddress, abi, functionName, args })` builds the `abiFunctionSignature` from the ABI and calls `createContractExecutionTransaction`. **It returns as soon as Circle accepts the transaction (Circle tx id + initial state). It does not wait for on-chain confirmation**, so DB updates that follow a call are optimistic. The SDK client is deliberately created fresh on every call, because a module-cached client broke on warm Vercel functions with a stale entity-secret ciphertext. Keep it that way.

## Escrow flow

Contracts on Arc Testnet (addresses come from env): **AttnnRegistry** (`registerCreator`, `getCreatorsByTag`, …) and **AttnnEscrow** (`placeBid`, `acceptBid`, `rejectBid`, `claimRefund`, `getBid`, …).

1. **Creator onboarding:** `wallet/provision` creates the Circle wallet. `profile/create` writes the DB row (inactive). `profile/activate` calls `registerCreator(handle, minBid, tags, profileURI)` from the creator's wallet and sets `isActive`.
2. **Place bid** (`/api/bid/place`): USDC `approve(escrow, amount)` → sleep 8 s → `placeBid(creator, amount, message, isPrivate)` → insert a `bids` row (`pending`, `onChainBidId: null`) → send Inngest event `attnn/bid.placed`.
3. **Bid ID sync** (`/api/webhooks/circle-events`): on a `BidPlaced` log it finds the newest pending bid with the same `bidderAddress` + `amountUsdc` and a null `onChainBidId`, then sets `onChainBidId` + `onChainTxHash`. `BidAccepted` / `BidRejected` logs set status + `settlementOnChainTxHash`.
4. **Accept** (`/api/bid/accept`, reply ≥ 10 chars, enforced in the route only — the contract accepts any string) → `acceptBid(bidId, reply)` releases USDC to the creator. **Reject** (`/api/bid/reject`) → `rejectBid(bidId)` refunds the bidder. Both return 400 until `onChainBidId` has synced.
5. **Counter** (`/api/bid/counter`, creator only, amount ≥ $5 and > original) sets status `counter_offered` and sends `attnn/counter.received`.
6. **14-day refund:** the escrow's `claimRefund(bidId)` refunds the bidder, and requires `msg.sender == bid.bidder`, a still-`Pending` bid, and `createdAt + 14 days <= block.timestamp`. The `autoRefund` cron (daily 03:00 UTC, `inngest/functions.ts`) claims them:
   - It first **reconciles** earlier claims: for `pending` bids that already have a `settlementTxHash`, it asks Circle for the transaction state. `FAILED`, `DENIED` or `CANCELLED` clears `settlementTxHash` (logging Circle's `errorReason`) so the claim step retries the bid in the same run; anything else is left for the webhook.
   - It then selects `pending` bids with a non-null `onChainBidId`, a null `settlementTxHash`, and `createdAt` older than **14 days + a 2-hour margin** (the escrow's `createdAt` is set when the bid lands on Arc, so it trails the DB row).
   - Each bid gets its own `step.run`, so Inngest retries them individually. It calls `claimRefund` through `executeContractCall` using **the bidder's own active wallet** (`wallets.state = "active"`), since the contract rejects anyone else, and stores the Circle transaction id in `settlementTxHash`. Failures are logged and the run continues.
   - It **does not set `status: "refunded"`**. That happens when the `BidRefunded` log reaches `/api/webhooks/circle-events`. Don't add an optimistic status write here.
   - Expired bids whose `onChainBidId` never synced can't be claimed (the call needs that id). They're logged with id and amount and returned in the run result, and are **left `pending`**, because `bid_status` has no `failed`/`expired` member. They need manual follow-up.

## Agents

### Bidder agent (proactive): `runBidderAgent(userId)` in `lib/agent.ts`

Triggered by the `runActiveBidders` Inngest cron (`*/10 * * * *`, rechecks `isActive` per user) or on demand via `/api/agent/run`.

1. Loads `bidder_configs`. Stops if it's inactive.
2. Daily budget: sums `bids.amount_usdc` for this bidder since UTC midnight, counting **all statuses**. Stops if the total is ≥ `dailyBudget`.
3. Discovery: `registry.getCreatorsByTag(tag)` for each `searchTags` entry, intersected with active DB profiles whose wallet address matches. It excludes self and any creator already bid on today.
4. Scores up to 10 creators with `evaluateCreatorForBidder(creator, goal)`. It keeps those with `proceed && score >= minFitScore` and takes the top 5 by score.
5. For each one it rechecks the budget, then runs `approve` → sleep **4 s** → `placeBid` (message = `defaultMessage`), inserts the `bids` row and logs `bid_placed` to `agent_logs`.
   - The bid amount comes from the AI. The fallback is `1000000` ($1). `maxBidPerCreator` is **not** enforced here.
   - It captures the new row's id with `.returning({ id })` and sends `attnn/bid.placed` with `{ bidId, creatorUserId }`, the same shape `/api/bid/place` sends, so agent-placed bids get creator triage too. The send is wrapped in try/catch: the bid is already on-chain, so a failed event is logged and the run continues.

### Creator agent (reactive): `creatorAgentTriage` in `inngest/functions.ts`

Triggered by `attnn/bid.placed`, capped at `concurrency: 10` because each run can sit in the chain-sync wait for minutes.

1. Loads the bid, the creator's profile and wallet, and all of the creator's pending bids (`queueDepth`, `highestBidAmount`).
2. **Waits for chain sync.** `onChainBidId` is set by the `BidPlaced` webhook, which lands *after* this event fires, so triage polls for it: up to `CHAIN_SYNC_ATTEMPTS` (10) re-reads of the bid with a 30s `step.sleep` between them, roughly 4.5 minutes. Step ids carry the iteration number because Inngest memoises steps by id — never reuse one inside the loop. If the bid stops being `pending` during the wait (someone accepted it in the dashboard), triage returns early.
3. `triageBidForCreator` (`lib/ai.ts`): the AI returns a 0–10 score. The decision thresholds are **hard-coded**:
   - `≥ 8` → `accept`, with `autoReplyTemplate` or else an AI `draftReply`.
   - `5–7` → `counter_offer` at 85% of the highest pending bid (floor $5) if a higher pending bid exists, otherwise `surface`.
   - `< 5` → `reject`.
   - The profile's `autoAcceptThreshold` is sent to the AI as context only and doesn't gate the decision.
   - Fallback when AISA fails: ≥ 2× minBid → 8, ≥ minBid → 5, else 3.
4. Acts: `acceptBid` / `rejectBid` from the creator's wallet, or sets `counter_offered` and sends `attnn/counter.received`, or (surface) only stores the score.
   - If the wait ended with no `onChainBidId`, the AI still triages and the score is still recorded, but `accept` and `reject` are **not** attempted (they would revert). The run logs the reason and returns `skipped: true` with `skippedReason`, leaving the bid `pending` for manual review. `counter_offer` still runs, since it only touches the DB.
   - The return value always carries `chainSynced` and `onChainBidId`, which is the first thing to check in the Inngest dashboard when a bid isn't settling.

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

## Webhooks

All three webhook routes authenticate the caller before touching the DB, and all three read the **raw body first**, because both schemes sign the exact bytes. Never switch them back to `req.json()`.

- **Circle** (`/api/webhooks/circle`, `/api/webhooks/circle-events`): `verifyCircleSignature(rawBody, signature, keyId)` from `lib/circle-webhook.ts`. Circle v2 notifications are ECDSA_SHA_256-signed: the base64 DER signature arrives in `X-Circle-Signature` and the signing key's id in `X-Circle-Key-Id`. The helper fetches that key from `GET {CIRCLE_API_BASE_URL or https://api.circle.com}/v2/notifications/publicKey/{keyId}` with `Authorization: Bearer $CIRCLE_API_KEY`, imports the base64 DER SPKI key, and verifies with `crypto.createVerify("SHA256")`. W3S serves testnet and mainnet keys from the same host, so the `CIRCLE_API_BASE_URL` override is rarely needed. Keys are cached in a module-level `Map` by key id, since a key is static for its id. A key whose reported `algorithm` isn't `ECDSA_SHA_256` only logs a warning, because the verification step catches a genuinely wrong key by itself and a relabelled one must not stop bid syncing. The helper never throws: a missing header, a failed fetch or a bad signature logs the reason and returns `false`, and the route then returns **401** before parsing anything. There is no `CIRCLE_WEBHOOK_SECRET`; verification depends on `CIRCLE_API_KEY`.

  Both Circle routes also de-duplicate: `circle` keys `webhook_events` on the payload's `id`/`eventId`, and `circle-events` on `notificationId` with source `circle-events`, returning early when the row already exists (a verified notification is still replayable). A `circle-events` payload with no `notificationId` is processed anyway, with a warning.
- **Arc/Alchemy** (`/api/webhooks/arc`): HMAC-SHA256 hex digest of the raw body keyed by `ALCHEMY_WEBHOOK_SECRET`, taken from `x-alchemy-signature` or `x-hub-signature-256`. It **fails closed**: a missing secret returns 500 ("Webhook not configured"), and a mismatch returns 401. The comparison checks lengths before `crypto.timingSafeEqual`, which throws on unequal buffers.

Event handling past verification is unchanged: `circle-events` decodes escrow logs and syncs `onChainBidId` and settlement status, while `circle` and `arc` mostly record events for idempotency.
