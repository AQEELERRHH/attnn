# Arc mainnet checklist

Everything agreed for the switch from Arc Testnet to Arc mainnet, in order. Nothing
here runs automatically; contract deploys and database changes need the owner's go-ahead.

## 1. Contracts (deploy needs approval)
- [x] `feat/min-bid-1` merged: `AttnnEscrow.MIN_BID` and the registry floor are $1.
- [x] `AttnnRegistry.updateProfile(minBid, tags, profileURI)`: a registered creator can change
      their floor, tags and profile URI (not the handle). Tags are de-duplicated and the tag
      index (`getCreatorsByTag`) is kept exact. The app calls it whenever a registered creator
      edits those fields (`syncRegistryProfile` in `lib/registration.ts`, best-effort), and only
      when the deployed registry has the function (detected from its bytecode), so the old
      testnet registry keeps working unchanged.
- [x] Escrow hardening: `acceptBid`, `rejectBid` and `claimRefund` now mark the bid settled
      **before** sending USDC (checks-effects-interactions). Arc's USDC has no transfer
      callbacks, so this wasn't exploitable, but a test shows the old order would pay a
      re-entering creator twice on a token that did.
- [x] **D1, private messages and replies (escrow v2):** the escrow stores only fingerprints,
      `keccak256(salt ‖ text)` (`placeBid(creator, amount, messageHash)`,
      `acceptBid(bidId, replyHash)`). Text and a random salt per message/reply stay in the
      database (migration 0010). Anyone given both can check them against the chain with the
      contract's `fingerprint(salt, text)` view. The 100-character reply minimum stays an app
      rule (the contract can't see the text).
- [x] **D5, emergency pause (escrow v2):** an `owner` (the escrow admin) can `pause()` new bids
      and hand the role over in two steps. It can't touch escrowed USDC; settlements never
      pause. See the RUNBOOK's "contract pause".
- [x] The app supports both escrow generations (read from the bytecode, `lib/escrow.ts`), so
      testnet's legacy escrows keep settling.
- [x] Foundry tests: 44 passing (`npm run test:contracts`), including fuzz tests that the
      escrow always holds exactly the open bids (also while paused), the re-entrancy test,
      the admin's limits and a fingerprint vector shared with the app's unit tests.
- [x] Deploy script refuses non-Arc chains and prints the network, `MIN_BID` and
      `REFUND_PERIOD`. Simulated against a local chain with mainnet's chain id.
- [ ] **Escrow admin wallet**: create it yourself, separate from Attnn. and Circle: a hardware
      wallet, or better a multisig if one is available on Arc. Never a key in `.env` or on the
      server. Put a little USDC in it for gas. Send only its public address.
- [ ] **Deploy** (owner's go-ahead): fund a fresh deployer key with a little USDC for gas, then
      `ESCROW_ADMIN_ADDRESS=<admin address> ARC_RPC_DEPLOY=https://rpc.mainnet.arc.io npm run deploy:contracts`.
      The script refuses a zero admin or the deployer's own address. Run once without
      `--broadcast` first (`forge script … --rpc-url $ARC_RPC_DEPLOY`) to see the simulation.
- [ ] Verify the source on the explorer (https://explorer.arc.io), so its "Write contract" tab can
      call `pause()`; record the addresses in README and Vercel.
- [ ] From the admin wallet, rehearse once: `scripts/escrow-admin.mjs pause`, check a bid is
      refused, then `unpause`.
- [ ] The contracts are not audited. Until they are, consider a soft cap in the app (e.g. a lower
      `ESCROW_MAX_BID` for launch) so no single bid risks much real money.

## 2. Dependencies
- [x] `@circle-fin/developer-controlled-wallets` 10.3.0 → 10.8.1 (its `Blockchain` type has `ARC`;
      the cast in `lib/circle.ts` is gone).
- [x] `@circle-fin/x402-batching` 3.0.4 → 3.5.0 (adds Arc mainnet: `chain: "arc"`, Gateway
      wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, matching `lib/chain.ts`).
- [x] `scripts/x402-demo.mjs --mainnet` pays on Arc mainnet.

## 3. Environment (Vercel, Production)
Put the mainnet values in a local file (e.g. `.env.mainnet`, gitignored) and run the
read-only preflight before touching Vercel:
`node --env-file=.env.mainnet scripts/check-network-config.mjs`. It checks the RPC's chain
id, that the escrow uses Arc USDC and points at the registry, that `MIN_BID` / `MAX_BID` /
`REFUND_PERIOD` match the app, that the registry supports `updateProfile`, that the Circle
key is a LIVE key and that mock payments are off. On mainnet it also requires a v2 escrow
whose owner equals `ATTN_ESCROW_ADMIN` with no handover open, and that the admin isn't one of
Attnn.'s own Circle wallets. With `DATABASE_URL` set it also reads the
database: no wallets or bids from another network, the app's user owns every table, and Row
Level Security is on everywhere. It prints no secrets and changes nothing.
- [ ] `ARC_NETWORK=mainnet` (RPC `https://rpc.mainnet.arc.io` and explorer
      `https://explorer.arc.io` are the defaults; override with `ARC_RPC_URL` / `ARC_EXPLORER_URL`)
- [ ] `ATTN_ESCROW_CONTRACT`, `ATTN_REGISTRY_CONTRACT` = the mainnet addresses
- [ ] `ATTN_ESCROW_ADMIN` = the escrow admin's address (the health check alerts if the
      escrow's owner ever differs, or a handover is opened)
- [ ] `ATTN_LEGACY_ESCROW_CONTRACTS=none` (testnet escrows don't exist on mainnet)
- [ ] `NEXT_PUBLIC_ESCROW_MIN_BID_USDC=1000000` (the $1 minimum; it's built into the client
      bundle, so redeploy after changing it)
- [ ] `SELLER_ADDRESS` = a mainnet wallet we control; `X402_MOCK` unset
- [ ] Circle LIVE API key + entity secret for mainnet; `CIRCLE_WALLET_SET_ID` empty or a
      mainnet wallet set
- [ ] Circle webhooks (wallet notifications + contract event monitoring for the new escrow)
      pointed at the production URL. Monitor these v2 event signatures on the new escrow
      (`BidAccepted` changed, so testnet monitor settings won't match):
      `BidPlaced(uint256,address,address,uint256)`, `BidAccepted(uint256,address,bytes32)`,
      `BidRejected(uint256,address)`, `BidRefunded(uint256,address)`. Optional:
      `Paused(address)`, `Unpaused(address)` (ignored by the app; the health check reports them).
- [ ] New `DATABASE_URL` (see Data) and fresh Inngest keys if using a separate Inngest app
- [ ] `ALERT_EMAIL` = who gets the money health-check alerts (and `RESEND_API_KEY`, already set)

## 4. Data
- [ ] Apply every migration in `drizzle/` (0000–0009) to the new database, as the same user the
      app connects with (so it owns every table; RLS in 0009 depends on that).
- [ ] Mainnet starts with a **fresh database** (a new Supabase project). Not just a clean `bids`
      table: testnet wallets in it would be shown to users, and real USDC sent to them is stuck.
      The preflight check fails if any wallet or bid belongs to another network. Testnet bids,
      wallets and x402 receipts don't carry over.

## 5. Outside agents with Circle Agent Wallets (build during the switch)
Circle Agent Wallets are user-controlled and run from Circle CLI with email OTP, so they
can't replace the wallets our server-side agents use. They can bid on Attnn directly,
because the escrow is permissionless, under limits **Circle** enforces. Spending policies
only work on mainnet.
- [ ] **Index direct bids.** Record any `BidPlaced` in our escrow whose bidder isn't an Attnn
      wallet as a bid from an "External agent" (needs `bids.bidderUserId` nullable or an
      external-bidder table: migration). The message is on-chain (`placeBid(creator, amount,
      message, isPrivate)`).
- [ ] Show those bids in the creator's inbox; creator agent triages them; accept / reject /
      counter work as usual (the creator's wallet settles).
- [ ] Refunds: only the outside wallet can `claimRefund`; show "refundable by the bidder
      after 3 days" and skip them in `autoRefund`.
- [ ] Public guide page (e.g. `/agents`) with the exact Circle CLI commands:
      `circle wallet limit set` (daily cap + `contract-allowlist` = USDC + escrow),
      `circle wallet execute "approve(address,uint256)" …`,
      `circle wallet execute "placeBid(address,uint256,string,bool)" …`,
      `circle wallet execute "claimRefund(uint256)" …`, and paying for `/api/c/<handle>` over x402.
- [ ] Test end to end on mainnet with a few dollars.
- [ ] Open questions for Circle: do transfer caps count USDC pulled by a contract after
      `approve`? Policies on testnet? A server API for agent wallets or for spending policies
      on developer-controlled wallets?

## 5b. Safety nets (before the first real bid)
- [ ] GitHub → Settings → Branches → rule for `main`: require the three CI checks to pass.
- [ ] Two-step login on Vercel, GitHub, Circle, Supabase and Inngest; fewest people with access.
- [ ] Send `attnn/admin.health-check` `{ "full": true }` from Inngest and confirm the "Health check
      passed" email arrives.
- [ ] Read `docs/RUNBOOK.md`; fill in its contacts; practise pausing and resuming bids once.

## 6. After the switch
- [ ] Run the x402 demo (`scripts/x402-demo.mjs`) against mainnet with a small Gateway deposit.
- [ ] Place, accept, decline and refund one real bid each; check the dashboard and Arcscan.
- [ ] Update README, About page and PRODUCT_DECISIONS ("live on Arc mainnet").
