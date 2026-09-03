# Attn. — Product Decisions, Design Rationale and Feature Explanations

This document captures the thinking behind key product decisions, feature designs, and architectural choices made during the development of Attn. It is written for developers, investors, and accelerator reviewers who want to understand not just what was built but why.

---

## Table of Contents

- [What Attn. Actually Sells](#what-attn-actually-sells)
- [The Coffee Meeting Analogy](#the-coffee-meeting-analogy)
- [Real World Examples](#real-world-examples)
- [Creator Agent Triage — How Scoring Works](#creator-agent-triage--how-scoring-works)
- [Public Highest Bid Display](#public-highest-bid-display)
- [Creator Tiers](#creator-tiers)
- [Team and Company Bidder Accounts](#team-and-company-bidder-accounts)
- [x402 Profile Endpoint — Access Policy](#x402-profile-endpoint--access-policy)
- [x402 Payment Failures](#x402-payment-failures)
- [Platform Seller Wallet](#platform-seller-wallet)
- [Why Paymaster Is Not Needed](#why-paymaster-is-not-needed)
- [Why Circle CLI Was Not Used Directly](#why-circle-cli-was-not-used-directly)
- [Naira and African Fiat On-Ramp via CPN](#naira-and-african-fiat-on-ramp-via-cpn)

---

## What Attn. Actually Sells

On every marketplace there is a service being exchanged. On Attn. the service is **a genuine reply from someone worth reaching.**

Not a product. Not a deliverable. Not a task.

Just this: "I will read your message and I will respond to you meaningfully."

That is worth money — especially from the right person. A senior developer's reply is worth money to a startup hiring. A content creator's reply is worth money to a brand wanting a partnership. An expert's reply is worth money to someone making a big decision. A founder's reply is worth money to an investor looking for deal flow.

People have always known this. But there was never a clean way to price it. Attn. is that clean way.

---

## The Coffee Meeting Analogy

This is the simplest explanation of what Attn. does.

Someone wants to meet you for coffee. They send you a message: "Hey, can we grab coffee?" You don't know this person well. You're busy. But out of courtesy — because you don't want to seem rude — you say yes. You sacrifice two hours of your time. You sit through a meeting that wasn't worth it for you. You leave with nothing.

That's how attention works today. It's free to ask. So everyone asks. And because it costs nothing to ask, the person being asked has no way to tell who is serious and who is just testing their luck.

Now imagine this.

Before that person can even send you the coffee message — they have to put $10 in an envelope and hand it to a neutral third party. That third party holds the money. The message arrives in your inbox. You read it. If you reply — the $10 is yours. If you ignore it — the $10 goes back to the sender automatically after 14 days.

Suddenly everything changes.

The person sending the message is serious — because they put real money behind it. You as the recipient are motivated to actually read it — because there is money waiting for you. And if it's not worth your time — you simply don't reply and nobody loses anything.

That is Attn.

---

## Real World Examples

### The Job Seeker and the HR Manager

A fresh graduate in Lagos wants a job at a top tech company. They send their CV to the HR manager on LinkedIn. Nothing. They follow up. Nothing. The HR manager gets 200 applications a week. This one looks like everyone else's.

Now the graduate puts $5 USDC behind their message. The HR manager sees it — $5 waiting if they reply. They read it properly. They respond. The graduate gets real feedback — maybe even an interview. The HR manager earns $5 for doing what they were supposed to do anyway.

### The Musician and the Record Label

A young musician from Kano has been making music for three years. He wants a record label to listen to his work. He sends emails. Nobody replies. The label receives hundreds of submissions every week.

He puts $8 behind his submission on Attn. The A&R manager sees it — $8 waiting. They listen to the track. They write back — even if it's just "not for us right now." The musician gets real feedback for the first time. The A&R gets compensated for their time.

### The Freelancer and the Client

A graphic designer in Port Harcourt keeps getting messages: "I need a logo, what's your price?" She quotes them. They disappear. She has spent hours quoting people who were never serious.

With Attn. a client must put $10 in escrow before she even sees their message. By the time it reaches her inbox she knows this person has skin in the game. She replies. She earns $10 just for sending a quote. The client gets a real response from a real designer.

### The Influencer and the Brand

A Nigerian lifestyle influencer with 80,000 followers gets 30 brand DM requests every week. Most are "can you promote our product for free." She ignores them all now because she can't tell who is serious.

She adds her Attn. handle to her bio. Now brands must put at least $50 in escrow to reach her. Only brands with real budgets send a message. She reads their proposals — earns $50 just for responding. Her inbox went from noise to signal overnight.

### The Investor and the Founder

An angel investor in Lagos is looking for startups to invest in. He puts his Attn. handle on his X profile. A founder from Enugu puts $20 behind her pitch. The investor reads it properly — $20 waiting. He replies with genuine feedback. The founder got a real look from a real investor. No cold emails ignored.

### The Doctor and the Patient

A specialist doctor who retired from active practice still gets calls asking for medical opinions. With Attn. he sets a $30 minimum bid. Patients who genuinely need his expertise put $30 in escrow and send their question. He replies with a professional opinion. He earns $30 for 10 minutes of expertise that took 20 years to build.

---

## Creator Agent Triage — How Scoring Works

When a bid arrives, the creator agent scores it from 0 to 10 across four signals. Here is exactly how each signal works:

### Signal 1 — Bid Amount vs Minimum Bid (40% of score)

This is the most important signal. If your minimum bid is $5:
- Someone bids $5 → they just met the minimum. Average score.
- Someone bids $10 → they bid double your minimum. Score goes up.
- Someone bids $50 → they bid 10x your minimum. Score goes very high.

Higher bidders rank higher. This is the primary economic signal.

### Signal 2 — Message Quality and Relevance to Creator Tags (30% of score)

If your tags are "web3, developer, solidity" and someone sends "I need a Solidity developer for a DeFi project" — highly relevant. Score goes up.

If someone sends "I need a social media manager" — that doesn't match your tags. Score goes down even if they bid high.

This prevents people from throwing money without a serious purpose. A $100 bid for the wrong thing scores lower than a $15 bid for exactly the right thing.

### Signal 3 — Queue Depth Adjustment

If you already have 20 pending bids in your inbox, the agent raises the bar. A score of 6 might surface to your inbox normally, but if your queue is very full, that same bid might get rejected — because you already have better ones waiting. This stops your inbox from getting overwhelmed.

### Signal 4 — Overall Engagement Potential (30% of score)

This looks at the combination of everything — is this the kind of message likely to lead to a meaningful conversation? Is the bid amount serious relative to what the creator does? Is the message detailed or vague?

### Decision Thresholds

Once AISA scores the bid from 0 to 10:

| Score | Decision | Action |
|---|---|---|
| 8, 9, or 10 | Auto-accept | Saved auto-reply sent on-chain. USDC settles instantly. Creator earns without touching their phone. |
| 5, 6, or 7 | Surface | Appears in creator inbox for manual review. Creator decides. |
| 0 to 4 | Auto-reject | USDC goes back to sender immediately. They can retry with better message or higher bid. |

### Why Not Sort Only by Highest Bid?

A $100 bid for the wrong service is worth less to the creator than an $8 bid for exactly the right service. The scoring combines amount AND relevance. The highest relevant bid always wins. But a high bid for an irrelevant purpose doesn't dominate just because of the amount.

---

## Public Highest Bid Display

### The Feature

On every creator's public profile page, visitors can see:
- **Minimum bid** — the floor price set by the creator
- **Current highest bid** — the highest pending bid at that moment (amount only, bidder identity and message remain private)

### Why This Was Added

Right now when someone wants to bid $5 they have no idea someone else already bid $20. Their $5 bid goes to the bottom of the queue and they wonder why the creator never replied.

With public highest bid display they visit the profile and see "Current highest bid: $20 USDC." Now they know. If they want to stand out they need to bid above $20.

### Why It Works

**Creates competitive bidding dynamics without a formal auction.** Bids don't expire or get replaced — it's not an auction. But seeing the highest bid gives context that makes the marketplace feel alive. Like seeing how many people are looking at a hotel room on Booking.com.

**Transparent without violating privacy.** The bidder's identity stays private. The message stays private. Only the number is public. Enough information to make a better decision, not enough to expose anyone.

**Validates creator worth publicly.** When someone visits a creator's profile and sees "Current highest bid: $30 USDC" — that tells them this creator is in demand. Their attention is genuinely valuable.

**Increases average bid value.** Knowing the competition exists naturally pushes serious bidders to bid higher.

### Technical Implementation

One additional query when loading the profile page:

```sql
SELECT MAX(amount_usdc) FROM bids 
WHERE creator_user_id = ? AND status = 'pending'
```

No contract changes needed. One database query, one line of UI.

---

## Creator Tiers

Creator tiers allow creators to set differentiated access prices rather than a single minimum bid.

### The Three Tiers

**Tier 1 — $5 USDC (Basic)**
Standard inbox. No timeline guarantee. For casual enquiries and exploratory messages.

**Tier 2 — $20 USDC (Priority)**
Message goes straight to the top of the inbox. Creator sees it first. Like business class — same destination, faster service, higher priority.

**Tier 3 — $50 USDC (Guaranteed 24-hour reply)**
Creator commits to reply within 24 hours. If they don't — the smart contract refunds automatically. For time-sensitive decisions where waiting is not an option.

### Why This Matters

Right now a creator earns $5 from every accepted bid regardless of urgency. With tiers a creator can earn $50 from the people who really need them — without working harder. The price reflects the urgency, not the effort.

For bidders: a serious company that needs an answer can pay $50 and know they will get one. That certainty is worth the premium when real business decisions are at stake.

---

## Team and Company Bidder Accounts

Currently every bidder on Attn. is an individual with one wallet and one agent. Team accounts change this for companies.

### The Problem

A recruitment company has 10 recruiters. Each needs a different type of candidate. Right now each would create their own individual Attn. account, fund their own wallet, run their own agent. Separate budgets. No shared visibility. No company-level control.

### The Solution

One company account. One funded company wallet. Ten recruiters each with their own login, all connected to the same account and shared budget.

Each recruiter configures their own agent with their own goal and search tags. All agents run autonomously. When a candidate replies — any team member can see that conversation. The hiring manager reviews it. Recruiter follows up. One shared dashboard shows total bids, total accepted, total spent, which recruiter found which candidate.

### Why This Opens the B2B Market

Right now Attn. sells to individuals. One account, one wallet, one agent. With company accounts Attn. sells to businesses. One contract with a recruitment firm could mean thousands of dollars per month in bids flowing through the platform. One enterprise client is worth more than 100 individual users.

---

## x402 Profile Endpoint — Access Policy

Every creator profile at `attnn.xyz/api/c/{handle}` is a payable x402 HTTP endpoint.

### Access Policy

| Visitor Type | Access | Reason |
|---|---|---|
| Signed-in Attn. user | Free | Already in ecosystem — removing friction for humans |
| External AI agent | $0.001 USDC via x402 | Monetizing programmatic machine access |
| Non-signed-in human | 402 challenge | Must pay or sign in |

### Why Signed-In Users Are Free

Charging signed-in users $0.001 creates friction for the exact people we want to engage. They already have wallets and are already part of the ecosystem. The x402 gate is specifically designed for machine-to-machine access — external AI agents that have never heard of Attn. paying to discover creators programmatically.

### The PayBox Test

During testing, PayBox (an external AI agent payment tool) successfully hit the endpoint, received the 402 challenge, and correctly decoded the payment requirements — amount, asset, network, seller wallet, payment scheme. This confirmed the 402 challenge is correctly implemented.

PayBox could not complete payment because it settles on Base and Solana, not Arc. This is a real interoperability consideration for the broader agent ecosystem as Arc grows.

---

## x402 Payment Failures

x402 payments can fail at different stages with different consequences.

### Before Settlement (No Money Moves)

If payment fails at the verify step — wrong network, expired signature, invalid authorization — Circle Gateway rejects it before any USDC moves. The agent's wallet is untouched. This is the most common failure case.

### After Settlement (Money Moves, Service Fails)

If `verify()` succeeds and `settle()` succeeds but the server crashes after settlement — the USDC has left the agent's wallet but no profile was returned. This is a known limitation.

**Post-mainnet fix:** Store settlement transaction IDs in the database. On retry, if a transaction ID was already settled, return the cached profile without re-charging. Standard idempotency pattern used by Stripe and other payment APIs.

---

## Platform Seller Wallet

The platform seller wallet is a Circle Developer-Controlled Wallet that belongs to Attn. the platform — not any individual user. It receives the $0.001 USDC payment every time an external AI agent accesses a creator profile via x402.

**Address:** `0x569ab5cafeba4d38d2b95cd509ed97779e5ff9bf`
**Circle Wallet ID:** `219b0f9f-4564-5eac-8062-fdfe3a6b2e66`

It was created programmatically using the Circle SDK and lives in the same wallet set as all user wallets. It is controlled exclusively by the Attn. platform owner via the Circle API key and entity secret.

Post-mainnet, earnings from this wallet can be distributed to team members or reinvested in operations using the `transferUSDC` function in `lib/circle.ts`.

---

## Why Paymaster Is Not Needed

Paymaster solves the gas token mismatch problem — needing ETH for gas on Ethereum. On Arc, USDC IS the native gas token. There is no separate gas token problem to solve. Every transaction on Attn. — bids, acceptances, rejections, refunds — is already denominated and settled in USDC.

Integrating Paymaster on Attn. would solve a problem that doesn't exist. This is one of the core reasons Arc was chosen as the settlement layer: the economic model is clean, predictable, and entirely dollar-denominated.

---

## Why Circle CLI Was Not Used Directly

The Circle CLI (`@circle-fin/cli`) is a terminal tool designed for agents consuming services — humans and AI agents interacting via a shell environment.

Attn. is a Next.js web application running on Vercel serverless functions. Serverless functions are stateless — they spin up and down per request with no persistent shell. The CLI assumes a running process with state, which is incompatible with this architecture.

We use the underlying npm packages directly:
- `@circle-fin/developer-controlled-wallets` — for wallet provisioning and contract calls
- `@circle-fin/x402-batching` — for x402 verification and settlement

External agents use the Circle CLI to pay to access Attn.'s x402 endpoint. Attn. itself builds the endpoint using the SDK. These are two different roles.

---

## Naira and African Fiat On-Ramp via CPN

### The Problem

On testnet, users get free USDC from the faucet. On mainnet, a Nigerian professional with no crypto experience has no clean way to fund their wallet. Buying USDC from an exchange requires KYC, a bank card that works internationally, and crypto knowledge. This is the biggest adoption barrier for non-crypto users in Nigeria and Africa.

### The Solution

Circle Payments Network (CPN) connects to local payment rails — bank transfers and mobile money — across Africa. A Nigerian user clicks "Fund with Naira," enters an amount, pays via their local bank transfer, and USDC appears in their Circle Agent Wallet on Arc.

### The Flow

```
Naira (Nigerian bank transfer)
    → CPN converts at current rate
        → USDC lands in Circle Agent Wallet on Arc
            → Attn. works normally — bids, escrow, settlement all in USDC
```

The user never sees crypto. They pay in Naira. Their wallet has USDC. Everything on Attn. works exactly as it does today.

### Why USDC Still Makes Sense for Nigerians

The Naira has experienced significant volatility. USDC is always worth exactly $1. When a creator earns $5 USDC for a reply, they have $5 — not an amount in Naira that might be worth less next week. Many Nigerians already price services informally in USD because of Naira instability. USDC formalizes what already happens organically.

The reverse flow — creators withdrawing USDC earnings back to Naira — is also handled by CPN, allowing creators to spend their earnings in everyday Nigerian life.

---

*This document is maintained alongside the Attn. codebase and updated as product decisions evolve.*

*Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. Attn. is built on Arc Network and is not affiliated with or endorsed by Circle.*
