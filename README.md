# Attnn – Agentic Attention Marketplace

**Attnn** is a two-sided marketplace where human attention becomes a programmable economic primitive. Creators register as x402‑compatible HTTP endpoints; autonomous AI agents discover, evaluate, and pay for attention using USDC on Arc Testnet.

> **Status**: Phase 1‑2 complete – frontend, API, database, and smart‑contract interfaces built. Pending: dependency installation, contract deployment, x402 integration, testing, and production deployment.

## 🎯 Vision

Turn attention into a liquid, tradeable asset:
- **Creators** become discoverable endpoints with programmable pricing
- **Bidders** are autonomous agents with USDC budgets that algorithmically bid for attention
- **Payments** flow via two tiers: $0.001 nanopayments (Circle Gateway) and $5–50 on‑chain escrow bids
- **Everything** runs on **Arc Testnet** (chain‑ID `5042002`) with Circle Developer‑Controlled Wallets

## 🏗 Architecture

### Tech Stack
- **Frontend**: Next.js 15 (App Router), TypeScript strict, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Auth.js (NextAuth v5), Drizzle ORM, Inngest (background jobs)
- **Blockchain**: Arc Testnet, Circle Developer‑Controlled Wallets, viem, Foundry (contracts)
- **AI**: aisa.one (OpenAI‑compatible) for bid scoring, creator evaluation, reply drafting
- **Database**: Supabase PostgreSQL
- **Infra**: Vercel (frontend), Supabase (DB), Inngest (jobs), Circle (wallets), Alchemy (webhooks)

### Core Contracts (`/contracts/`)
- `AttnnRegistry.sol` – Creator registry with handles, tags, min‑bid pricing
- `AttnnEscrow.sol` – Bid escrow with 14‑day auto‑refund
- **Interfaces**: `IAttnnRegistry.sol`, `IAttnnEscrow.sol`
- **Tests**: Full Foundry test suite (`AttnnRegistry.t.sol`, `AttnnEscrow.t.sol`)

### Database Schema (`/lib/db/schema.ts`)
- `users` – Auth.js identities, roles (`creator`|`bidder`|`both`)
- `wallets` – Circle wallet mappings (one‑to‑one with users)
- `profiles` – Creator‑specific data (handle, min‑bid, tags, bio)
- `bidder_configs` – Agent configuration (budget, strategy, tags)
- `bids` – On‑chain bid mirror (status: pending/accepted/rejected/refunded)
- `agent_logs` – Activity feed for dashboard SSE
- `webhook_events` – Incoming Circle/Arc webhooks

### Key Directories
- `/app` – Next.js pages & API routes
- `/lib` – Core utilities (auth, circle SDK, arc client, AI wrapper, DB client)
- `/components/ui` – shadcn/ui components
- `/inngest` – Background jobs (auto‑refund, notifications)
- `/contracts` – Foundry project with interfaces, implementations, tests, deploy script

## 🚀 Getting Started

### 1. Clone & Setup
```bash
git clone <repo-url>
cd attnn
cp .env.example .env.local
```

### 2. Environment Variables
Fill `.env.local` with:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | Supabase PostgreSQL URL | `postgresql://...` |
| `NEXTAUTH_SECRET` | NextAuth secret | `openssl rand -base64 32` |
| `CIRCLE_API_KEY` | Circle API key | `...` |
| `CIRCLE_ENTITY_SECRET` | Circle entity secret | `...` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | `...` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | `...` |
| `AISA_API_KEY` | aisa.one API key | `...` |
| `DEPLOYER_PRIVATE_KEY` | Arc deployer private key | `0x...` |

See `.env.example` for full list.

### 3. Install Dependencies
```bash
npm install --legacy-peer-deps
# Note: `--legacy-peer-deps` required due to viem/x402 version mismatch
```

### 4. Database Setup
```bash
# Generate & run migrations
npm run db:generate
npm run db:push

# Or use Drizzle Studio
npm run db:studio
```

### 5. Deploy Contracts (Arc Testnet)
```bash
# Build contracts
cd contracts
forge build

# Test contracts
forge test -vvv

# Deploy (requires DEPLOYER_PRIVATE_KEY in env)
npm run deploy:contracts
```

After deployment, set `NEXT_PUBLIC_REGISTRY_ADDRESS` and `NEXT_PUBLIC_ESCROW_ADDRESS` in `.env.local`.

### 6. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

## 📋 Features Status

### ✅ Completed (Phase 1–2)
- [x] Next.js 15 project structure with TypeScript strict mode
- [x] Database schema (Drizzle ORM) with relations
- [x] Authentication (Auth.js) – email magic links + Google OAuth
- [x] Circle Developer‑Controlled Wallets SDK wrapper
- [x] Arc Testnet viem client with USDC utilities
- [x] AI scoring client (aisa.one) with three prompt templates
- [x] UI components (shadcn/ui) – buttons, cards, badges, dialogs, toasts
- [x] Landing page, registration, dashboard, public profile pages
- [x] API routes for wallet, profile, bid, agent, voice, webhooks
- [x] Smart‑contract interfaces (`IAttnnRegistry`, `IAttnnEscrow`)
- [x] Contract implementations (`AttnnRegistry.sol`, `AttnnEscrow.sol`)
- [x] Foundry test suite with MockUSDC
- [x] Deploy script (`Deploy.s.sol`)
- [x] Inngest functions (auto‑refund, activity feed, notifications)
- [x] x402 middleware skeleton (Circle Gateway nanopayments)
- [x] Environment template & documentation

### 🚧 Pending (Phase 3–10)
- [ ] Install npm dependencies (currently failing due to peer‑dep conflict)
- [ ] Install OpenZeppelin submodule in `contracts/lib/`
- [ ] Write Playwright end‑to‑end tests
- [ ] Write x402 payment flow (create/verify challenges)
- [ ] Deploy contracts to Arc Testnet
- [ ] Configure Alchemy Notify webhooks for contract events
- [ ] Set up Circle Gateway webhooks
- [ ] Configure Inngest dashboard
- [ ] Deploy to Vercel, Supabase, Inngest
- [ ] Add Sentry error tracking

## 🔄 Workflow

### Creator Registration
1. Sign up with email/Google, choose "creator" role
2. System provisions a Circle Developer‑Controlled Wallet
3. Fill profile: handle, min‑bid (5–1000 USDC), tags, bio, portfolio URI
4. Profile becomes discoverable at `/c/[handle]` with x402 gate ($0.001 to view full details)

### Bidder Agent Setup
1. Sign up, choose "bidder" role
2. Configure agent: USDC budget, target tags, bid strategy (aggressive/conservative)
3. Agent runs periodically (or via webhook), queries registry for matching creators
4. AI scores each creator, places bids via escrow contract
5. Dashboard shows live activity feed (SSE)

### Bid Lifecycle
1. **Bid placed** → USDC locked in escrow, `BidPlaced` event emitted
2. **Creator accepts/rejects** → USDC transferred/refunded, `BidAccepted`/`BidRejected` event
3. **Auto‑accept** → Creator can set threshold (e.g., accept all bids >20 USDC)
4. **14‑day refund** → Inngest cron auto‑refunds pending bids after period
5. **Activity feed** → All events logged to dashboard in real‑time

## 🧪 Testing

### Contracts
```bash
cd contracts
forge test -vvv
```

### Frontend (Playwright)
```bash
npm run test
```

### Type Checking & Lint
```bash
npm run lint
npx tsc --noEmit
```

## 🚢 Deployment

### 1. Vercel
- Connect GitHub repo
- Set all environment variables
- Deploy

### 2. Supabase
- Create new project
- Get `DATABASE_URL`
- Run migrations via Drizzle

### 3. Inngest
- Create account
- Set `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`
- Deploy functions via `npm run inngest:deploy`

### 4. Circle
- Create developer account
- Generate API key + entity secret
- Enable Developer‑Controlled Wallets

### 5. aisa.one
- Sign up for API key
- Configure model (`deepseek/deepseek-v3.2`)

## 📁 Project Structure
```
attnn/
├── app/                    # Next.js App Router
│   ├── api/               # API routes (wallet, profile, bid, agent, webhooks)
│   ├── c/[handle]/        # Public creator profiles (x402‑gated)
│   ├── dashboard/         # User dashboard with SSE activity feed
│   ├── register/          # Registration & role selection
│   └── page.tsx           # Landing page
├── components/ui/         # shadcn/ui components
├── contracts/             # Foundry project
│   ├── src/              # Solidity contracts
│   ├── test/             # Foundry tests + mocks
│   ├── script/           # Deploy script
│   └── foundry.toml      # Foundry config
├── lib/                   # Core utilities
│   ├── db/               # Drizzle schema & client
│   ├── auth.ts           # NextAuth configuration
│   ├── circle.ts         # Circle SDK wrapper
│   ├── arc.ts            # Arc Testnet viem client
│   ├── ai.ts             # aisa.one AI client
│   ├── agent.ts          # Bidder agent orchestration
│   └── x402.ts           # Circle Gateway nanopayments
├── inngest/              # Background jobs
├── drizzle/              # Drizzle migrations
└── tests/                # Playwright E2E tests
```

## 🔗 Resources

- [Arc Testnet Docs](https://docs.arc.network)
- [Circle Developer‑Controlled Wallets](https://developers.circle.com/wallets)
- [Circle x402 Batching](https://developers.circle.com/x402)
- [Next.js 15](https://nextjs.org/docs)
- [Drizzle ORM](https://orm.drizzle.team)
- [Inngest](https://www.inngest.com)
- [aisa.one](https://aisa.one)

## 📄 License

MIT