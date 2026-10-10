# Arc mainnet checklist

Everything agreed for the switch from Arc Testnet to Arc mainnet, in order. Nothing
here runs automatically; contract deploys and database changes need the owner's go-ahead.

## 1. Contracts (deploy needs approval)
- [ ] Merge `feat/min-bid-1`: `AttnnEscrow.MIN_BID` and the registry floor become $1.
- [ ] Add `updateTags(string[])` (and floor/URI updates) to `AttnnRegistry`, so on-chain tags
      stay current for outside agents. Today tags can't change after registration, which is
      why our own agent discovers by DB tags (see CLAUDE.md, Agents).
- [ ] Run the Foundry tests (`forge test`), then deploy both contracts to Arc mainnet.
- [ ] Verify the bytecode on the explorer; record the addresses in README and Vercel.

## 2. Dependencies
- [ ] `@circle-fin/developer-controlled-wallets` 10.3.0 → 10.8.1 (its `Blockchain` type has `ARC`;
      drop the cast in `lib/circle.ts`).
- [ ] `@circle-fin/x402-batching` 3.0.4 → 3.5.0. 3.5.0 adds Arc mainnet (`chain: "arc"`, Gateway
      wallet `0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE`, matching `lib/chain.ts`). Circle's
      Gateway docs list Arc mainnet, nanopayments included.
- [ ] Regenerate the lockfile; `npm run build`.

## 3. Environment (Vercel, Production)
- [ ] `ARC_NETWORK=mainnet`
- [ ] `ATTN_ESCROW_CONTRACT`, `ATTN_REGISTRY_CONTRACT` = the mainnet addresses
- [ ] `ATTN_LEGACY_ESCROW_CONTRACTS=none` (testnet escrows don't exist on mainnet)
- [ ] `NEXT_PUBLIC_ESCROW_MIN_BID_USDC=1000000` (the $1 minimum)
- [ ] `SELLER_ADDRESS` = a mainnet wallet we control
- [ ] Circle API key / entity secret for mainnet; new wallet set
- [ ] Circle webhooks pointed at the production URL for mainnet events

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
