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
- [x] Foundry tests: 31 passing (`npm run test:contracts`), including fuzz tests that the
      escrow always holds exactly the open bids, and the re-entrancy test.
- [x] Deploy script refuses non-Arc chains and prints the network, `MIN_BID` and
      `REFUND_PERIOD`. Simulated against a local chain with mainnet's chain id.
- [ ] **Deploy** (owner's go-ahead): fund a fresh deployer key with a little USDC for gas, then
      `ARC_RPC_DEPLOY=https://rpc.mainnet.arc.io npm run deploy:contracts`. Run once without
      `--broadcast` first (`forge script … --rpc-url $ARC_RPC_DEPLOY`) to see the simulation.
- [ ] Verify the bytecode on the explorer (https://explorer.arc.io); record the addresses
      in README and Vercel.
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
key is a LIVE key and that mock payments are off. It prints no secrets.
- [ ] `ARC_NETWORK=mainnet` (RPC `https://rpc.mainnet.arc.io` and explorer
      `https://explorer.arc.io` are the defaults; override with `ARC_RPC_URL` / `ARC_EXPLORER_URL`)
- [ ] `ATTN_ESCROW_CONTRACT`, `ATTN_REGISTRY_CONTRACT` = the mainnet addresses
- [ ] `ATTN_LEGACY_ESCROW_CONTRACTS=none` (testnet escrows don't exist on mainnet)
- [ ] `NEXT_PUBLIC_ESCROW_MIN_BID_USDC=1000000` (the $1 minimum; it's built into the client
      bundle, so redeploy after changing it)
- [ ] `SELLER_ADDRESS` = a mainnet wallet we control; `X402_MOCK` unset
- [ ] Circle LIVE API key + entity secret for mainnet; `CIRCLE_WALLET_SET_ID` empty or a
      mainnet wallet set
- [ ] Circle webhooks (wallet notifications + contract event monitoring for the new escrow)
      pointed at the production URL
- [ ] New `DATABASE_URL` (see Data) and fresh Inngest keys if using a separate Inngest app

## 4. Data
- [ ] Mainnet starts with a fresh database (or a clean `bids` table): testnet bids,
      wallets and x402 receipts don't carry over. Decide before switching.

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

## 6. After the switch
- [ ] Run the x402 demo (`scripts/x402-demo.mjs`) against mainnet with a small Gateway deposit.
- [ ] Place, accept, decline and refund one real bid each; check the dashboard and Arcscan.
- [ ] Update README, About page and PRODUCT_DECISIONS ("live on Arc mainnet").
