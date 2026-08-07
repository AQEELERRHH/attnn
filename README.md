# Attnn. Agentic Attention Marketplace 

<img width="1888" height="826" alt="image" src="https://github.com/user-attachments/assets/b6f17375-8ac2-4e6b-9c15-a668cee5dd92" />


**Live:** [attnn.vercel.app](https://attnn.vercel.app) · **V1 Protocol:** [pitchslotarc.vercel.app](https://pitchslotarc.vercel.app) · **Creators:** [attnn.vercel.app/creators](https://attnn.vercel.app/creators)

> Attention is scarce. Let agents negotiate it.

Attnn. is a two-sided agentic attention marketplace built entirely on the Circle and Arc Network stack. Companies deploy AI agents that autonomously bid USDC to reach creators and professionals who get paid only when they reply. No reply in 14 days? Full automatic refund, enforced by smart contract.

**V1 (PitchSlotArc):** 515+ on-chain transactions · $1,148 USDC verified on ArcScan · Live since April 2026

---

## Table of Contents

- [How It Works](#how-it-works)
- [Two-Sided Agentic Architecture](#two-sided-agentic-architecture)
- [x402 Nanopayment Gate](#x402-nanopayment-gate)
- [AISA AI Scoring](#aisa-ai-scoring)
- [Circle and Arc Stack](#circle-and-arc-stack)
- [Smart Contracts](#smart-contracts)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Design Decisions](#design-decisions)
- [Post-Hackathon Roadmap](#post-hackathon-roadmap)
- [Traction](#traction)

---

## How It Works

**For Creators and Professionals:**
1. Sign in with Google: a Circle Agent Wallet is auto-provisioned (no MetaMask, no seed phrases)
2. Fund wallet with testnet USDC from [faucet.circle.com](https://faucet.circle.com) (select Arc Testnet)
3. Register your profile on-chain: handle, minimum bid, tags, bio
4. Set an auto-accept threshold: bids scoring above it are accepted automatically
5. Save an auto-reply template: your agent replies on your behalf
6. Receive an AI-scored, ranked inbox. Accept and earn USDC instantly. Reject and the bidder is refunded.

**For Companies and Bidders:**
1. Sign in with Google: same wallet auto-provisioning
2. Configure a bidder agent: goal, daily USDC budget, search tags
3. Agent runs every 10 minutes autonomously discovers matching creators on-chain, scores each for fit, places USDC bids
4. No manual work required the agent runs 24/7

**The escrow guarantee:**
- Bid placed → USDC locked in smart contract escrow
- Creator replies → USDC released instantly to creator wallet
- No reply in 14 days → full automatic refund to bidder

---

## Two-Sided Agentic Architecture

Attnn. has genuine agents on **both sides** of the marketplace. This is the core architectural distinction.

### Bidder Agent: Proactive

The bidder agent runs on a schedule every 10 minutes via Inngest cron. It does not wait for human input.

```
Every 10 minutes:
1. Query AttnnRegistry contract for creators matching search tags
2. For each candidate, call AISA to score fit against bidder goal (0-10)
3. If score >= minFitScore and budget allows:
   a. Call approve() on USDC contract (allows escrow to spend)
   b. Wait 8s for Arc to settle
   c. Call placeBid() on AttnnEscrow contract
   d. Log bid_placed to agent_logs
4. Stop when daily budget is exhausted
```

**Key properties:**
- Discovers creators on-chain not from a database, from the Registry contract
- AI scoring uses free-text goal ("find senior Solidity developers on Arc") not keyword matching
- Executes real USDC transactions via Circle Developer-Controlled Wallets
- Self-limiting via daily budget cap
- Prevents self-bidding (skips creators whose userId matches the bidder's userId)

### Creator Agent: Reactive

The creator agent is triggered every time a bid arrives via Inngest event `attnn/bid.placed`. It triages the bid on the creator's behalf without any manual input.

```
On every new bid:
1. Fetch bid details, creator profile, current queue depth
2. Score the bid on 4 signals via AISA:
   - Bid amount vs creator minimum bid (weight: 40%)
   - Message quality and topic relevance to creator tags (weight: 30%)
   - Queue depth adjustment if many bids pending, raise the bar
   - Overall engagement potential (weight: 30%)
3. Decision:
   - Score >= 8 → auto-accept: call acceptBid() on-chain with AI-drafted reply
   - Score 5-7 → surface: leave in inbox for manual review
   - Score < 5 → auto-reject: call rejectBid() on-chain, USDC refunded
```

**Key properties:**
- Reactive (event-driven), not proactive
- Uses saved auto-reply template or AISA-drafted personalized reply
- Executes real on-chain accept/reject transactions
- Falls back to rule-based scoring if AISA is unavailable — protocol never breaks

### Why This Makes Attnn. Fully Agentic

| | Bidder Agent | Creator Agent |
|---|---|---|
| Type | Proactive (scheduled) | Reactive (event-driven) |
| Trigger | Inngest cron every 10 min | Inngest event on bid arrival |
| Decision making | AI scores creators for fit | AI triages incoming bids |
| On-chain execution | Places bids via Circle Wallets | Accepts/rejects via Circle Wallets |
| Human input required | None after setup | None after setup |
| USDC settlement | Initiates escrow | Releases or refunds escrow |

Both agents use Circle Developer-Controlled Wallets. Both settle in USDC. Both execute real on-chain transactions. The company sets strategy, the agents execute.

---

## x402 Nanopayment Gate 

<img width="1041" height="685" alt="image" src="https://github.com/user-attachments/assets/13365e62-0073-443b-b583-83619bf6d4c8" />


Every creator profile at `attnn.vercel.app/api/c/{handle}` is a payable HTTP endpoint.

### How It Works

```
External agent hits GET /api/c/xeenty (no payment header)
→ HTTP 402 Payment Required
→ PAYMENT-REQUIRED header (base64 encoded):
  {
    "x402Version": 2,
    "accepts": [{
      "scheme": "exact",
      "network": "eip155:5042002",  // Arc Testnet
      "asset": "0x3600...0000",      // USDC on Arc
      "amount": "1000",              // $0.001 USDC (6 decimals)
      "payTo": "0x569ab5...",        // Platform seller wallet
      "extra": { "name": "GatewayWalletBatched", "verifyingContract": "0x00777..." }
    }]
  }

Agent pays $0.001 USDC via EIP-3009 signed authorization
→ HTTP 200
→ Full profile JSON: handle, bio, tags, minBid, isActive
```

### Access Policy (Deliberate Design Decision)

| Visitor Type | Access | Reason |
|---|---|---|
| Signed-in Attnn. user | Free | Already part of ecosystem, reducing friction for humans |
| External AI agent | $0.001 USDC via x402 | Monetizing programmatic/machine access |
| Non-signed-in human | 402 challenge | Must pay or sign in |

This is a deliberate product decision: human users of Attnn. access creator profiles for free. External agents — recruiting bots, marketing agents, any AI from outside Attnn. pay per access. This creates a monetization layer for machine traffic without adding friction for human users.

### Implementation

Uses `@circle-fin/x402-batching` with `BatchFacilitatorClient` for EIP-3009 verification and Circle Gateway settlement. Real payment verification is live (`X402_MOCK=0`).

---

## AISA AI Scoring

All AI scoring in Attnn. uses [AISA](https://aisa.one) (OpenAI-compatible API, deepseek-v3 model).

### Three Scoring Functions

**1. `evaluateCreatorForBidder()` Bidder-side discovery scoring**
Called by the bidder agent when evaluating candidate creators. Scores how well a creator matches the bidder's free-text goal.
- Input: creator profile + bidder goal
- Output: score (0-10), bidAmount recommendation, proceed (bool)
- Used in: `lib/agent.ts`

**2. `triageBidForCreator()` Creator-side triage scoring**
Called by the creator agent when a new bid arrives. Scores the incoming bid on 4 signals.
- Input: bid details + creator profile + queue depth
- Output: decision (accept/surface/reject), score, reason, draftedReply
- Used in: `inngest/functions.ts` (creatorAgentTriage)

**3. `draftReply()` Auto-reply generation**
Called when a bid is auto-accepted. Generates a personalized reply based on the bid message and creator context.
- Input: bid message + creator handle + bio
- Output: reply string (min 10 chars, satisfies contract requirement)
- Used in: `lib/ai.ts` (called from triageBidForCreator)

### Fallback Behavior
All three functions have rule-based fallbacks that activate silently if AISA is unavailable. The protocol never breaks due to AI downtime:
- evaluateCreatorForBidder → score 5, proceed: true
- triageBidForCreator → score based on bid amount vs minimum bid ratio
- draftReply → saved auto-reply template or default message

---

## Circle and Arc Stack

### What We Use and Why

| Product | How Used | Why |
|---|---|---|
| **Arc Network** | Settlement layer for all bids, accepts, rejects, refunds | USDC as native gas no separate gas token needed |
| **Circle Developer-Controlled Wallets** | Auto-provisioned for every user on Google sign-in | Eliminates MetaMask requirement non-crypto users onboard in seconds |
| **USDC** | All bids denominated, escrowed, settled | Stable dollar value $5 bid is always $5, never changes |
| **x402 + Circle Gateway** | Nanopayment gate on creator profile API | Any AI agent can pay $0.001 to access creator data without signing up |
| **Circle Agent Marketplace** | Applied for listing of `/api/c/{handle}` endpoint | Discoverability for external AI agents |

### Why Paymaster Is Not Needed

Attnn. does not integrate Paymaster. This is intentional.

Paymaster solves the problem of users needing a separate gas token. On Ethereum, you need ETH for gas Paymaster lets you use USDC instead. On Arc, USDC IS the native gas token. There is no separate gas token problem to solve. Every transaction on Attnn. bids, acceptances, rejections, refunds is already denominated and settled in USDC. This is one of the core reasons Arc was chosen as the settlement layer: the economic model is clean, predictable, and entirely dollar-denominated.

### Wallet Architecture

All wallets are EOA (Externally Owned Account) type Developer-Controlled Wallets. A fresh Circle SDK client is instantiated per API call (not cached at module level) to avoid stale entity-secret ciphertext on warm Vercel serverless functions this was a critical bug fix that unblocked production wallet provisioning.

---

## Smart Contracts

Deployed on Arc Testnet (Chain ID: 5042002)

### AttnnRegistry `0x853C43338A3FAA52DE3AB79aEBc6AF2F51c41dA3`

Creator registration and discovery.

```solidity
function registerCreator(string handle, uint256 minBid, string[] tags, string profileURI) external
function getCreatorsByTag(string tag) external view returns (address[])
function getCreatorCount() external view returns (uint256)
function isActiveCreator(address creator) external view returns (bool)
```

Key design: tag-based discovery allows the bidder agent to query `getCreatorsByTag("web3")` and get all matching creator wallet addresses directly from the contract no database query needed for discovery.

### AttnnEscrow `0x3066138a56f75206AeDd1A6E7d11c8244E278aB3`

Bid lifecycle management with trustless escrow.

```solidity
function placeBid(address creator, uint256 amount, string message, bool isPrivate) external returns (uint256 bidId)
function acceptBid(uint256 bidId, string reply) external
function rejectBid(uint256 bidId) external
function claimRefund(uint256 bidId) external
function getBidderBids(address bidder) external view returns (uint256[])
function getCreatorBids(address creator) external view returns (uint256[])
```

Key design:
- `placeBid` requires prior `approve()` call on USDC contract, the bidder wallet must authorize the escrow to spend USDC before bidding
- `acceptBid` requires a reply string of minimum 10 characters, basic quality gate preventing empty acceptances
- `claimRefund` enforces 14-day window via `block.timestamp`
- OpenZeppelin `ReentrancyGuard` on all state-changing functions
- Built with Foundry, `via_ir = true` required in `foundry.toml`
- 20 Foundry tests passing

### V1 Protocol (PitchSlotArc)  `0x8cE043782da362f3e9caf5fd995061765a993138`
515+ transactions · $1,148 USDC · Listed on ArcLens since April 2026

---

## Tech Stack

```
Frontend:     Next.js 15 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui
Auth:         Auth.js v5, Google OAuth only, Drizzle adapter
Database:     Supabase PostgreSQL, Drizzle ORM (10 tables)
Blockchain:   Arc Testnet, Circle Developer-Controlled Wallets SDK v10.3.0, Viem, Foundry
AI:           AISA (aisa.one), deepseek-v3, OpenAI-compatible
Scheduling:   Inngest (4 functions: runActiveBidders, autoRefund, bidExpiryNotification, creatorAgentTriage)
Payments:     Circle Gateway x402 batching (@circle-fin/x402-batching v3.0.4 + @x402/evm v2.19.0)
Deployment:   Vercel (auto-deploy on push to main)
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- A Circle developer account ([developers.circle.com](https://developers.circle.com))
- A Google OAuth app
- A Supabase project

### 1. Clone and Install

```bash
git clone https://github.com/AQEELERRHH/attnn.git
cd attnn
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in:

```env
# Database
DATABASE_URL=postgresql://...

# Auth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000
AUTH_TRUST_HOST=true
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Circle
CIRCLE_API_KEY=...
CIRCLE_ENTITY_SECRET=...
CIRCLE_WALLET_SET_ID=...

# Arc Contracts
ATTN_REGISTRY_CONTRACT=0x853C43338A3FAA52DE3AB79aEBc6AF2F51c41dA3
ATTN_ESCROW_CONTRACT=0x3066138a56f75206AeDd1A6E7d11c8244E278aB3
ARC_CHAIN_ID=5042002

# AI
AISA_API_URL=https://api.aisa.one/v1
AISA_API_KEY=...
AISA_MODEL=deepseek-chat

# Inngest
INNGEST_EVENT_KEY=...
INNGEST_SIGNING_KEY=...

# x402
SELLER_ADDRESS=0x...  # Your platform wallet address
X402_MOCK=0           # Set to 1 for local dev, 0 for production

# USDC
ATTN_USDC_ADDRESS=0x3600000000000000000000000000000000000000
```

### 3. Database Setup

```bash
npm run db:push
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Sync Inngest

After deploying to Vercel, go to [app.inngest.com](https://app.inngest.com) → Apps → Sync new app → enter `https://your-domain.vercel.app/api/inngest`

### 6. Get Testnet USDC

Visit [faucet.circle.com](https://faucet.circle.com), select Arc Testnet, paste your wallet address.

---

## Project Structure

```
attnn/
├── app/
│   ├── api/
│   │   ├── agent/          # Bidder agent run endpoint
│   │   ├── bid/            # place, accept, reject routes
│   │   ├── c/[handle]/     # x402-gated creator profile API
│   │   ├── inngest/        # Inngest webhook endpoint
│   │   ├── profile/        # create, activate, update
│   │   └── wallet/         # provision, balance, send
│   ├── about/              # About page with FAQ
│   ├── c/[handle]/         # Public creator profile page
│   ├── creators/           # Creator discovery page
│   ├── dashboard/          # Main dashboard (creator/bidder/activity)
│   └── page.tsx            # Landing page
├── contracts/              # Foundry project
│   ├── src/
│   │   ├── AttnnRegistry.sol
│   │   ├── AttnnEscrow.sol
│   │   └── interfaces/
│   └── test/
├── inngest/
│   └── functions.ts        # autoRefund, runActiveBidders, creatorAgentTriage, bidExpiryNotification
├── lib/
│   ├── agent.ts            # Bidder agent orchestration
│   ├── ai.ts               # AISA scoring functions
│   ├── arc.ts              # Arc viem client + ABIs + USDC utils
│   ├── auth.ts             # Auth.js config
│   ├── circle.ts           # Circle SDK wrapper + transferUSDC
│   ├── db/                 # Drizzle schema + client
│   ├── profiles.ts         # Profile lookup helper
│   └── x402.ts             # Circle Gateway nanopayment gate
└── public/
```

---

## Design Decisions

### Why Arc?
Arc uses USDC as the native gas token. Every transaction on Attnn. bids, accepts, rejects, refunds is denominated in USDC. No separate gas token. No price volatility in fees. The economics are clean and dollar-denominated for both crypto and non-crypto users.

### Why Circle Developer-Controlled Wallets?
The single biggest barrier to crypto adoption is wallet setup. Circle DCW eliminates it entirely sign in with Google, wallet exists. No MetaMask popup, no seed phrase backup, no "approve transaction" prompts. A Nigerian recruiter with no crypto knowledge can use Attnn. in 30 seconds.

### Why Not Paymaster?
Paymaster solves the "gas token mismatch" problem (needing ETH for gas on Ethereum). On Arc, this problem doesn't exist USDC is the gas token. Integrating Paymaster would be solving a problem we don't have.

### x402 Access Policy
Signed-in Attnn. users access creator profiles for free. External AI agents pay $0.001 USDC via x402. This removes friction for human users while monetizing programmatic machine access. The distinction is made server-side by checking for a valid Auth.js session.

### USDC Approve Before PlaceBid
The escrow contract uses `transferFrom` to pull USDC from the bidder wallet. This requires a prior `approve()` call on the USDC contract. The bid placement route calls `approve()`, waits 8 seconds for Arc to settle, then calls `placeBid()`. This was a critical fix without it, every bid transaction failed with `ESTIMATION_ERROR`.

### On-Chain Bid ID Lookup
After `placeBid()` executes via Circle SDK, the route polls `getBidderBids()` on the escrow contract to retrieve the actual on-chain bid ID. This ID is required for `acceptBid()` and `rejectBid()`. The 8-second wait allows Arc to finalize the transaction before querying.

### Fresh SDK Client Per Call
The Circle SDK client is instantiated fresh on every API call not cached at module level. On warm Vercel serverless functions, a cached client reuses a stale encrypted entity-secret ciphertext, causing all contract calls to fail silently with "Invalid credentials". Fresh instantiation per call solved this.

---

## Post-Hackathon Roadmap

### x402 Payment for Signed-In Users
Currently, signed-in Attnn. users get free profile access. Post-hackathon, we plan to charge a small fee ($0.001) even for signed-in users, using a direct Circle wallet transfer. The txId from the transfer becomes the payment proof in the x402 header. This requires fetching the transfer receipt, confirming it on Arc via viem, then returning the profile.

### Full EIP-3009 External Agent Support
The x402 gate uses BatchFacilitatorClient from @circle-fin/x402-batching/server for real payment verification and Circle Gateway settlement. The server-side implementation is complete, the 402 challenge is correct, verification and settlement code is in place. Post-hackathon: end-to-end testing with a funded external agent wallet, and documentation of the EIP-3009 signing process for third-party agent developers integrating with Attnn.

### Naira and African Fiat On-Ramp
For non-crypto users in Nigeria and across Africa, the mainnet roadmap includes fiat on-ramp integration via Circle Payments Network (CPN) Circle's native payment infrastructure that connects to local bank transfers and mobile money rails across Africa. Nigerian users would fund their Circle Agent Wallet with Naira through local payment methods supported by CPN, with USDC deposited directly into their wallet. No crypto exchange required. This makes Attnn. accessible to any professional or creator regardless of crypto experience.

### Arc Mainnet Migration
Arc mainnet launches September 16, 2026. Migration requires redeploying AttnnRegistry and AttnnEscrow to mainnet and updating contract addresses in environment variables. Application code requires no changes.

### Creator Reputation Scoring On-Chain
Add a reputation score to the AttnnRegistry contract based on acceptance rate, reply quality, and bid history. This score becomes an additional signal in the creator-agent triage scoring.

### Circle Agent Marketplace
Applied for listing on [agents.circle.com](https://agents.circle.com). The `/api/c/{handle}` endpoint qualifies as a Social Intelligence service, any agent can pay $0.001 USDC to discover creator profiles.

---

## Traction

| Metric | Value |
|---|---|
| V1 on-chain transactions (PitchSlotArc) | 515+ |
| V1 USDC through escrow | $1,148 |
| V1 ArcLens listing | Since April 2026 |
| Attnn. contract deployments | 2 (Registry + Escrow) |
| Attnn. Foundry tests | 20 passing |
| End-to-end loop status | Fully functional |
| Inngest functions | 4 active |
| Creator profiles registered | Growing |

---

## Contract Addresses (Arc Testnet)

| Contract | Address |
|---|---|
| AttnnRegistry | `0x853C43338A3FAA52DE3AB79aEBc6AF2F51c41dA3` |
| AttnnEscrow | `0x3066138a56f75206AeDd1A6E7d11c8244E278aB3` |
| PitchSlotArc V1 | `0x8cE043782da362f3e9caf5fd995061765a993138` |
| USDC (Arc Testnet) | `0x3600000000000000000000000000000000000000` |
| Platform Seller Wallet | `0x569ab5cafeba4d38d2b95cd509ed97779e5ff9bf` |

---
## Agentic Economy Track Alignment

This section maps Attnn. against the Programmable Money Hackathon Agentic Economy track criteria.

### "Agents with clear decision logic tied to real signals"

**Bidder agent:**
- Queries AttnnRegistry contract on-chain for creators matching search tags real signal: on-chain data
- AISA scores each creator 0-10 against free-text goal real signal: AI semantic evaluation
- Only bids if score >= minFitScore AND daily budget allows clear deterministic gate

**Creator agent:**
- Scores incoming bid on 4 signals: bid amount vs minimum, message quality, tag relevance to creator profile, current queue depth all real signals
- Score >= 8 → auto-accept with AI-drafted reply, 5-7 → surface to inbox, < 5 → auto-reject with refund

### "Autonomous spending, payments or settlement flows using USDC"

- Bidder agent places USDC bids every 10 minutes without any human input
- Creator agent accepts/rejects bids on-chain, triggering USDC settlement or immediate refund
- 14-day auto-refund Inngest cron sweeps expired bids daily at 03:00 UTC
- All flows execute via Circle Developer-Controlled Wallets no human signing at any step

### "Use of Agent Stack to connect agents to wallets, USDC payments and onchain actions"

Attnn. uses the core Agent Stack components:

- **Circle Developer-Controlled Wallets** every agent action (bid placement, acceptance, rejection, refund) executes through wallets provisioned via the Circle SDK
- **x402 nanopayments** creator profiles are payable x402 endpoints using `@circle-fin/x402-batching` with real `BatchFacilitatorClient` verification and Circle Gateway settlement

**Why not the Circle CLI directly:** The Circle CLI is a terminal tool designed for agents consuming services. Attnn. is a web application running on Vercel serverless functions the CLI doesn't fit a stateless serverless environment. We use the underlying npm packages (`@circle-fin/x402-batching`, `@circle-fin/developer-controlled-wallets`) directly, which is the correct approach for a web application. External agents use the Circle CLI to pay to access Attnn.'s x402 endpoint. Attnn. itself builds the endpoint using the SDK.

### "Use of Nanopayments, Paymaster or App Kits where relevant"

- **Nanopayments** ✅ x402 gate on `/api/c/{handle}`. Any external AI agent pays $0.001 USDC via Circle Gateway GatewayWalletBatched. Real EIP-3009 verification in production.
- **Paymaster** — not applicable Arc uses USDC as the native gas token. No separate gas token problem exists.
- **App Kits** — not applicable Bridge Kit, Swap Kit, and Transfer Kit are for cross-chain token movement. Attnn.'s core primitive is escrow-based attention settlement on a single chain, handled by custom contracts.

### Core Products Used

| Product | Status | How |
|---|---|---|
| Arc Network | ✅ | All contracts deployed, USDC as native gas, sub-second finality |
| USDC | ✅ | All bids, settlement, refunds everything dollar-denominated |
| Circle Developer-Controlled Wallets | ✅ | Every user and agent action |
| Circle Contracts | ✅ | AttnnRegistry + AttnnEscrow on Arc Testnet |
| Nanopayments (x402) | ✅ | Creator profile API gate |
| Agent Stack (SDK components) | ✅ | Wallets + x402 batching |
| Circle Agent Marketplace | Applied | `/api/c/{handle}` submitted for listing |
| Paymaster | N/A | Not needed on Arc |
| App Kits | N/A | Not applicable to attention escrow use case |

## Resources

- [Arc Docs](https://docs.arc.network)
- [Circle Developer Platform](https://developers.circle.com)
- [Circle Agent Marketplace](https://agents.circle.com)
- [Arc App Kits](https://docs.arc.io/app-kit)
- [Circle x402 Batching](https://www.npmjs.com/package/@circle-fin/x402-batching)
- [Inngest Docs](https://www.inngest.com/docs)
- [AISA](https://aisa.one)
- [ArcScan (Testnet)](https://testnet.arcscan.app)
- [ArcLens](https://explorer.arc.network)

---

## License

MIT

---

*Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. Attnn. is built on Arc Network and is not affiliated with or endorsed by Circle.*
