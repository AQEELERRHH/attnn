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
- [x] Foundry tests: 51 passing (`npm run test:contracts`), including fuzz tests that the
      escrow always holds exactly the open bids (also while paused), the re-entrancy test,
      the admin's limits and a fingerprint vector shared with the app's unit tests.
- [x] Deploy script refuses non-Arc chains and prints the network, `MIN_BID` and
      `REFUND_PERIOD`. Simulated against a local chain with mainnet's chain id.
- [x] **CertiK AI scan (Ultra, 14 Oct 2026)** on `contracts/src/`: no Critical, High or Medium
      findings; five Discussion/Info points, all handled:
      (1) unbounded `getCreatorsByTag` → added `getCreatorsByTagPage` + `getTagCreatorCount`
      (the app never reads the full list: discovery is from the database);
      (2) identical (bidder, creator, amount) bids → every bid now gets a unique message
      fingerprint and the app's id checks and repair tools match on it;
      (3) bidder wallets are public on-chain → copy now says amounts and wallet addresses are
      public, names and emails never;
      (4) bids below a creator's own floor could be placed directly → the escrow now enforces
      `registry.minBidOf(creator)` (raising a floor doesn't touch bids already escrowed);
      (5) append-only bid histories → added paginated getters and per-account counts; the
      daily health check still reads every bid (fine at launch volumes, see section 6).
- [x] **Escrow admin wallet**: `0xF326854e41AB46366E1b4711C2a8653ea2bfE253`, created by the
      founder separately from Attnn. and Circle; no key in `.env` or on the server. Keep a little
      USDC in it for gas. Move the role to a hardware wallet or multisig later with the two-step
      handover.
- [x] **Deployed 14 Oct 2026** (block 25927568, gas ≈ $0.05; practice run first, 51 Foundry tests
      green on the deploying machine): AttnnRegistry `0x024Bd6D6bdD990274Be4e99F919e7D71349782D8`
      (tx `0x3bb5b731…f4137aa37`), AttnnEscrow `0xFF00aA5414e205367aF5DD29927E23a1CCF3bAD8`
      (tx `0x4102d7e0…c619b8ee1aea`), owner `0xF326854e41AB46366E1b4711C2a8653ea2bfE253`,
      `MIN_BID` 1000000, `REFUND_PERIOD` 259200. The deployer key has no role afterwards.
- [x] Source verified on https://explorer.arc.io (exact match, Standard JSON input, solc 0.8.30,
      optimizer 200, via-IR, cancun, MIT) for both contracts, so "Read/Write contract" can call
      `pause()`. Addresses recorded in README; Vercel still to do (section 3).
- [x] Pause rehearsed from the admin wallet on 14 Oct 2026 via the explorer's Write contract tab:
      `pause()` (tx `0x84a7cf11…c0778cfd9`, success) then `unpause()`; `paused` = false, `owner` =
      the admin wallet, no handover open. (Refusal of a bid while paused is covered by the Foundry
      tests `test_Pause_BlocksNewBidsOnly` and the fuzz test.)
- [ ] **Audit (decision D6): open launch, audited soon after.** Mainnet opens to everyone; the
      contracts are not human-audited at launch. Before the deploy: run the CertiK AI scan on the
      final `contracts/src/` and fix what's real. Straight after: ask Circle and Encode about audit
      credits and book a human audit. The protections that limit what's at risk meanwhile: the
      escrow pause (D5), the hourly/daily money checks, the $1,000 per-bid maximum, agents bidding
      only each creator's floor (D3) and the shared $500 / 24 h allowance for money leaving a wallet (D4).

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
- [ ] `ALERT_EMAIL` = who gets the money health-check alerts
- [ ] `RESEND_API_KEY` (already set) and `AUTH_SECRET`: also required for security codes (D4).
      Without email, nothing over the daily allowance and no sends to new addresses.

## 4. Data
- [ ] Apply every migration in `drizzle/` (0000–0011) to the new database, as the same user the
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
      messageHash)`; only a fingerprint, so an outside bid has no readable message unless
      the bidder shares it with us).
- [ ] Show those bids in the creator's inbox; creator agent triages them; accept / reject /
      counter work as usual (the creator's wallet settles).
- [ ] Refunds: only the outside wallet can `claimRefund`; show "refundable by the bidder
      after 3 days" and skip them in `autoRefund`.
- [ ] Public guide page (e.g. `/agents`) with the exact Circle CLI commands:
      `circle wallet limit set` (daily cap + `contract-allowlist` = USDC + escrow),
      `circle wallet execute "approve(address,uint256)" …`,
      `circle wallet execute "placeBid(address,uint256,bytes32)" …` (amount ≥ the creator's
      `minBidOf`; the last argument is the message fingerprint, or zero for none),
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
- [ ] Switch the Circle mainnet API key from Standard to **Restricted**: Wallets = Read & Write,
      Webhooks = Read Only, everything else No Permissions (the app uses the key only for
      developer-controlled wallets and to fetch the webhook signing key). Change it on the
      same key in the console; re-test a bid and a webhook afterwards.
- [ ] Before volume grows (tens of thousands of bids): make the daily full health check and the
      repair job scan only bids that can still change (e.g. from the oldest open bid's id)
      instead of 1..getBidCount() every time (CertiK finding 5, off-chain part).
