# Attnn. Product Decisions, Design Rationale and Feature Explanations

This document captures the thinking behind key product decisions, feature designs, and architectural choices made during the development of Attnn. It is written for developers, investors, and accelerator reviewers who want to understand not just what was built but why.

---

## Table of Contents

- [What Attnn. Actually Sells](#what-attnn-actually-sells)
- [Simpliest Explanation](#simplest-explanation)
- [How is negotiation carriedout on Attnn.](#how-is-negotiation-carriedout)
- [Real World Examples](#real-world-examples)
- [Creator Agent Triage: How Scoring Works](#creator-agent-triage--how-scoring-works)
- [Public Highest Bid Display](#public-highest-bid-display)
- [Creator Tiers](#creator-tiers)
- [Team and Company Bidder Accounts](#team-and-company-bidder-accounts)
- [x402 Profile Endpoint: Access Policy](#x402-profile-endpoint--access-policy)
- [Platform Seller Wallet](#platform-seller-wallet)
- [Naira and African Fiat On-Ramp via CPN](#naira-and-african-fiat-on-ramp-via-cpn)
- [Arc Accelerator Roadmap: 9 Weeks to Production](#arc-accelerator-roadmap-9-weeks-to-roduction)
- [Complete end-to-end experience of Attnn. at the end of the accelerator](#complete-end-to-end-experience-of-attnn-at-the-end-of-the-accelerator)
- [FAQ](#faq)

---

## What Attnn. Actually Sells

On every marketplace there is a service being exchanged. On Attnn. the service is **a genuine reply from someone worth reaching.**

Not a product. Not a deliverable. Not a task.

Just this: "I will read your message and I will respond to you meaningfully."

That is worth money, especially from the right person. A senior developer's reply is worth money to a startup hiring. A content creator's reply is worth money to a brand wanting a partnership. An expert's reply is worth money to someone making a big decision. A founder's reply is worth money to an investor looking for deal flow.

People have always known this. But there was never a clean way to price it. Attnn. is that clean way.

---

## This is the simplest explanation of what Attnn. does.

You know that feeling when you've been trying to reach someone important; an investor, an influencer, a high-profile professional and you've been sending DMs for weeks with no reply?

Then one day you see them at an event. You recognize them immediately. Your heart is racing. You know this is your chance. You walk up to them and say:

"Please just one minute of your time. I promise you won't regret it."

The person is busy. They have somewhere to be. But they don't want to be rude. So they stop. They listen. And as you start explaining your idea their expression changes. They lean in. They're actually interested.

By the end they hand you their card and say: "Call this number. Let's fix a date. Come to my office. I want to hear more."

That moment, that one minute of attention changed everything.

But here's the reality. Most people never get that moment. They keep sending DMs into the void. The investor never sees them. The influencer never replies. Not because the idea is bad but because there is no way to signal that this message is different from the other 200 they received that week.

What if instead of hoping to bump into them at an event you could bid USDC to reach them directly?

When someone puts real money behind a message, it signals something no DM can "I am serious. This is worth your time."

The creator sees your bid in their inbox. They know you mean business because you put USDC in escrow. If they reply they earn it. If they don't reply in 14 days you get every cent back automatically. 

## How is negotiation carriedout on Attnn.
When we say "let agents negotiate it" the negotiation is the bidding process itself.

Here's what negotiation actually means in Attnn.:

On the bidder side:
The bidder agent doesn't just blindly send one message. It evaluates multiple creators, scores each one, decides who is worth bidding on, decides how much to bid, and places that bid autonomously. That decision-making process who to reach, at what price, with what message is the negotiation. The agent is negotiating access to attention on behalf of the company.

On the creator side:
The creator agent doesn't just accept everything. It evaluates every incoming bid against four criteria, decides whether it meets the threshold, auto-accepts the best ones, surfaces the mid-range ones, and rejects the weak ones. That filtering and decision-making is also negotiation the creator's agent is negotiating on their behalf what attention is worth accepting.

Between both sides:
The price discovery that happens publicly; the minimum bid, the current highest bid, the number of pending bids is market negotiation. Bidders see what others are paying and decide whether to outbid them. That is negotiation in the most classic economic sense.

When you visit a creator's profile on Attnn., you see three things publicly:

Minimum bid - the floor price they set
Current highest bid - someone has already bid this amount to reach them right now
Number of pending bids - how many people are currently competing for their attention 

The bidder's identity and their message are completely private. But the numbers are public.

Now you have a decision to make, outbid the current highest bidder.

And even though there are four criteria the creator agent uses to score bids, bid amount carries the highest weight -40%. So the highest bidder has the strongest advantage. If your message is also relevant to what this creator does, you score even higher.

The person who is most serious about getting this creator's attention will pay the most. The creator's agent sees the highest scoring bid and if it crosses the auto-accept threshold, the creator earns the USDC without even having to manually review it.

No more hoping to bump into them at events. No more DMs into the void.

Bid for their attention. Put your money where your message is.
---

## Real World Examples

### The Job Seeker and the HR Manager

A fresh graduate in Lagos wants a job at a top tech company. They send their CV to the HR manager on LinkedIn. Nothing. They follow up. Nothing. The HR manager gets 200 applications a week. This one looks like everyone else's.

Now the graduate puts $5 USDC behind their message. The HR manager sees it $5 waiting if they reply. They read it properly. They respond. The graduate gets real feedback, maybe even an interview. The HR manager earns $5 for doing what they were supposed to do anyway.

### The Musician and the Record Label

A young musician from Kano has been making music for three years. He wants a record label to listen to his work. He sends emails. Nobody replies. The label receives hundreds of submissions every week.

He puts $8 behind his submission on Attnn. The A&R manager sees it $8 waiting. They listen to the track. They write back even if it's just "not for us right now." The musician gets real feedback for the first time. The A&R gets compensated for their time.

### The Freelancer and the Client

A graphic designer in Port Harcourt keeps getting messages: "I need a logo, what's your price?" She quotes them. They disappear. She has spent hours quoting people who were never serious.

With Attnn. a client must put $10 in escrow before she even sees their message. By the time it reaches her inbox she knows this person has skin in the game. She replies. She earns $10 just for sending a quote. The client gets a real response from a real designer.

### The Influencer and the Brand

A Nigerian lifestyle influencer with 80,000 followers gets 30 brand DM requests every week. Most are "can you promote our product for free." She ignores them all now because she can't tell who is serious.

She adds her Attnn. handle to her bio. Now brands must put at least $50 in escrow to reach her. Only brands with real budgets send a message. She reads their proposals earns $50 just for responding. Her inbox went from noise to signal overnight.

### The Investor and the Founder

An angel investor in Lagos is looking for startups to invest in. He puts his Attn. handle on his X profile. A founder from Enugu puts $20 behind her pitch. The investor reads it properly $20 waiting. He replies with genuine feedback. The founder got a real look from a real investor. No cold emails ignored.

### The Doctor and the Patient

A specialist doctor who retired from active practice still gets calls asking for medical opinions. With Attnn. he sets a $30 minimum bid. Patients who genuinely need his expertise put $30 in escrow and send their question. He replies with a professional opinion. He earns $30 for 10 minutes of expertise that took 20 years to build.

---

## Creator Agent Triage: How Scoring Works

When a bid arrives, the creator agent scores it from 0 to 10 across four signals. Here is exactly how each signal works:

### Signal 1 Bid Amount vs Minimum Bid (40% of score)

This is the most important signal. If your minimum bid is $5:
- Someone bids $5 → they just met the minimum. Average score.
- Someone bids $10 → they bid double your minimum. Score goes up.
- Someone bids $50 → they bid 10x your minimum. Score goes very high.

Higher bidders rank higher. This is the primary economic signal.

### Signal 2 Message Quality and Relevance to Creator Tags (30% of score)

If your tags are "web3, developer, solidity" and someone sends "I need a Solidity developer for a DeFi project" highly relevant. Score goes up.

If someone sends "I need a social media manager" — that doesn't match your tags. Score goes down even if they bid high.

This prevents people from throwing money without a serious purpose. A $100 bid for the wrong thing scores lower than a $15 bid for exactly the right thing.

### Signal 3 Queue Depth Adjustment

If you already have 20 pending bids in your inbox, the agent raises the bar. A score of 6 might surface to your inbox normally, but if your queue is very full, that same bid might get rejected because you already have better ones waiting. This stops your inbox from getting overwhelmed.

### Signal 4 Overall Engagement Potential (30% of score)

This looks at the combination of everything is this the kind of message likely to lead to a meaningful conversation? Is the bid amount serious relative to what the creator does? Is the message detailed or vague?

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
- **Minimum bid** the floor price set by the creator
- **Current highest bid** the highest pending bid at that moment (amount only, bidder identity and message remain private)

### Why This Was Added

Right now when someone wants to bid $5 they have no idea someone else already bid $20. Their $5 bid goes to the bottom of the queue and they wonder why the creator never replied.

With public highest bid display they visit the profile and see "Current highest bid: $20 USDC." Now they know. If they want to stand out they need to bid above $20.

### Why It Works

**Creates competitive bidding dynamics without a formal auction.** Bids don't expire or get replaced, it's not an auction. But seeing the highest bid gives context that makes the marketplace feel alive. Like seeing how many people are looking at a hotel room on Booking.com.

**Transparent without violating privacy.** The bidder's identity stays private. The message stays private. Only the number is public. Enough information to make a better decision, not enough to expose anyone.

**Validates creator worth publicly.** When someone visits a creator's profile and sees "Current highest bid: $30 USDC" that tells them this creator is in demand. Their attention is genuinely valuable.

**Increases average bid value.** Knowing the competition exists naturally pushes serious bidders to bid higher.

### Technical Implementation

One additional query when loading the profile page:

```sql
SELECT MAX(amount_usdc) FROM bids 
WHERE creator_user_id = ? AND status = 'pending'
```

---

## Creator Tiers

Creator tiers allow creators to set differentiated access prices rather than a single minimum bid.

### The Three Tiers

**Tier 1 $5 USDC (Basic)**
Standard inbox. No timeline guarantee. For casual enquiries and exploratory messages.

**Tier 2 $20 USDC (Priority)**
Message goes straight to the top of the inbox. Creator sees it first. Like business class same destination, faster service, higher priority.

**Tier 3 $50 USDC (Guaranteed 24-hour reply)**
Creator commits to reply within 24 hours. If they don't, the smart contract refunds automatically. For time-sensitive decisions where waiting is not an option.

### Why This Matters

Right now a creator earns $5 from every accepted bid regardless of urgency. With tiers a creator can earn $50 from the people who really need them without working harder. The price reflects the urgency, not the effort.

For bidders: a serious company that needs an answer can pay $50 and know they will get one. That certainty is worth the premium when real business decisions are at stake.

---

## Team and Company Bidder Accounts

Currently every bidder on Attnn. is an individual with one wallet and one agent. Team accounts change this for companies.

### The Problem

A recruitment company has 10 recruiters. Each needs a different type of candidate. Right now each would create their own individual Attnn. account, fund their own wallet, run their own agent. Separate budgets. No shared visibility. No company-level control.

### The Solution

One company account. One funded company wallet. Ten recruiters each with their own login, all connected to the same account and shared budget.

Each recruiter configures their own agent with their own goal and search tags. All agents run autonomously. When a candidate replies,any team member can see that conversation. The hiring manager reviews it. Recruiter follows up. One shared dashboard shows total bids, total accepted, total spent, which recruiter found which candidate.

### Why This Opens the B2B Market

Right now Attnn. sells to individuals. One account, one wallet, one agent. With company accounts Attnn. sells to businesses. One contract with a recruitment firm could mean thousands of dollars per month in bids flowing through the platform. One enterprise client is worth more than 100 individual users.

---

## x402 Profile Endpoint: Access Policy

Every creator profile at `attnn.xyz/api/c/{handle}` is a payable x402 HTTP endpoint.

### Access Policy

| Visitor Type | Access | Reason |
|---|---|---|
| Signed-in Attnn. user | Free | Already in ecosystem removing friction for humans |
| External AI agent | $0.001 USDC via x402 | Monetizing programmatic machine access |
| Non-signed-in human | 402 challenge | Must pay or sign in |

### Why Signed-In Users Are Free

Charging signed-in users $0.001 creates friction for the exact people we want to engage. They already have wallets and are already part of the ecosystem. The x402 gate is specifically designed for machine-to-machine access external AI agents that have never heard of Attnn. paying to discover creators programmatically.

### The PayBox Test

During testing, PayBox (an external AI agent payment tool) successfully hit the endpoint, received the 402 challenge, and correctly decoded the payment requirements amount, asset, network, seller wallet, payment scheme. This confirmed the 402 challenge is correctly implemented.

PayBox could not complete payment because it settles on Base and Solana, not Arc. This is a real interoperability consideration for the broader agent ecosystem as Arc grows.

---

## Naira and African Fiat On-Ramp via CPN

### The Problem

On testnet, users get free USDC from the faucet. On mainnet, a Nigerian professional with no crypto experience has no clean way to fund their wallet. Buying USDC from an exchange requires KYC, a bank card that works internationally, and crypto knowledge. This is the biggest adoption barrier for non-crypto users in Nigeria and Africa.

### The Solution

Circle Payments Network (CPN) connects to local payment rails, bank transfers and mobile money across Africa. A Nigerian user clicks "Fund with Naira," enters an amount, pays via their local bank transfer, and USDC appears in their Circle Agent Wallet on Arc.

### The Flow

```
Naira (Nigerian bank transfer)
    → CPN converts at current rate
        → USDC lands in Circle Agent Wallet on Arc
            → Attnn. works normally bids, escrow, settlement all in USDC
```

The user never sees crypto. They pay in Naira. Their wallet has USDC. Everything on Attn. works exactly as it does today.

### Why USDC Still Makes Sense for Nigerians

The Naira has experienced significant volatility. USDC is always worth exactly $1. When a creator earns $5 USDC for a reply, they have $5 not an amount in Naira that might be worth less next week. Many Nigerians already price services informally in USD because of Naira instability. USDC formalizes what already happens organically.

The reverse flow; creators withdrawing USDC earnings back to Naira is also handled by CPN, allowing creators to spend their earnings in everyday Nigerian life.   

## Arc Accelerator Roadmap: 9 Weeks to Production
September 21-November 24, 2026

Everything We Are Building During the Accelerator

# Infrastructure

Arc Mainnet Deployment

Redeploy AttnnRegistry and AttnnEscrow to Arc mainnet. 
No application code changes required contracts redeploy cleanly. All agent flows, USDC escrow, and x402 nanopayments move from testnet to production. Update ATTN_REGISTRY_CONTRACT and ATTN_ESCROW_CONTRACT environment variables. Done.

Circle Payments Network Fiat On-Ramp 

Integrate CPN so Nigerian and African users can fund their Circle Agent Wallets with Naira via local bank transfers and mobile money. No exchange required, no MetaMask, no crypto knowledge. User clicks "Add funds," pays in Naira, USDC appears in their wallet on Arc. Reverse flow also supported creators withdraw USDC earnings back to Naira via CPN.

Circle Agent Marketplace Listing Approved and Live.

Apply for listing and hopefully get approved on agents.circle.com. The /api/c/{handle} x402 endpoint becomes discoverable by any external AI agent on the Circle Agent Marketplace. Any recruiting agent, marketing agent, or research agent anywhere on the internet can find Attnn. creator profiles and pay $0.001 USDC to access them.

x402 Payment Idempotency

Store settlement transaction IDs after every successful Circle Gateway payment. On retry, if a transaction ID was already settled, return the cached creator profile without re-charging. Prevents the edge case where USDC is deducted but the profile is not returned due to a server error.

# Product

Public Highest Bid Display
Show the current highest pending bid and number of active bids on every creator's public profile visible before unlocking. Bidder identity and message remain private. Only the amount and count are public. Creates competitive bidding dynamics, validates creator demand, and helps serious bidders know what they're competing against.

Reply Quality Verification and On-Chain Reputation Scoring 

After a bid is accepted and a creator replies, the bidder can rate the quality of the reply (1-5 stars). Ratings feed into an on-chain reputation score stored in AttnnRegistry. Creators with high reputation scores rank higher in agent discovery. Creators with patterns of low-quality replies get flagged and receive fewer bids. The marketplace becomes self-regulating.

Private Encrypted Messaging After Bid Acceptance

When a bid is accepted, a private encrypted message thread opens between the bidder and creator visible only to them inside the Attnn. dashboard. The conversation continues without moving off-platform to WhatsApp or email. Full professional communication tool, not just a payment gate.

Bid History and Reputation Visible on Creator Profile

After unlocking a creator's profile via x402, visitors can see the creator's acceptance rate, average response time, and reputation score. Helps bidders evaluate whether to bid before committing USDC. Motivates creators to maintain quality and responsiveness.

Verified Social Media Profile Linking

Creators link and verify their X, LinkedIn, Instagram, and WhatsApp Business handles on their Attnn. profile. These links are visible only after the $0.001 x402 unlock making the gated profile a premium aggregator of the creator's full online presence. For bidders this provides real audience and credibility signals before placing a bid.

WhatsApp and Email Notifications

Creators receive real-time WhatsApp and email notifications when a new bid arrives so they don't have to check the dashboard manually. Dramatically improves response rates which directly improves the bidder experience and drives more activity.

Advanced Bidder Agent Customization

Add sophisticated agent controls beyond basic goal and budget:
Bid scheduling only bid between selected hours (e.g. 9am-5pm)
Per-creator bid caps maximum bid for any single creator
Blacklist and whitelist of specific handles
Custom message templates per tag category
Agent pause rules pause after X bids placed per day

Creator Tiers 

Allow creators to set differentiated access prices:
$5 USDC-basic bid, standard inbox, no timeline guarantee
$20 USDC-priority inbox, goes to top of queue immediately
$50 USDC-guaranteed 24-hour reply, enforced by smart contract refund if missed

Team and Company Bidder Accounts

One company account, one shared Circle wallet, multiple team member logins. Each recruiter or team member configures their own agent with their own goal and search tags. All agents share the company budget. Accepted bids visible to all team members. Company-level dashboard showing total bids, total accepted, total spent, which team member found which creator.

Platform Fee Integration

Add 2-3% platform fee taken automatically in the escrow release logic. When a creator accepts a bid, 97-98% goes to the creator wallet, 2-3% goes to the platform seller wallet. No invoices, no manual collection. The smart contract handles the split automatically on every accepted bid.

Nigerian and African Market Activation
With CPN on-ramp live and mainnet deployed, execute a targeted growth campaign:
Partner with Nigerian Web3 communities, developer groups, and creator networks
Campaign: "Add your Attnn. handle to your bio" targeting influencers and professionals
Onboard first 1,000 creators in Nigeria
Onboard first 50 companies deploying bidder agents
Make "bid for my attention" as normal as "DM me" in Nigerian professional culture
How Attnn. Looks and Works After All Integrations

## This will be the complete end-to-end experience of Attnn. at the end of the accelerator, from first registration through full autonomous operation.

For a Creator or Professional

Step 1 Sign Up

A developer in Lagos opens attnn.xyz. She clicks "Get Started" and signs in with her Google account. In the background, a Circle Developer-Controlled Wallet is created for her automatically. She never sees a seed phrase. She never installs MetaMask. She has a wallet address on Arc mainnet in 5 seconds.

Step 2 Fund Wallet with Naira

She clicks "Add funds." She sees a simple form"How much Naira do you want to add?" She enters ₦16,000 (roughly $10). She selects her Nigerian bank from a dropdown. She gets a bank transfer reference number. She transfers ₦16,000 from her phone banking app. Two minutes later her Attnn. wallet shows $10.00 USDC. She didn't visit an exchange. She didn't need a dollar card. She just transferred Naira from her existing bank account.

Step 3 Register on Arc

She fills in her creator profile:

Handle: sarah
Minimum bid: $5 USDC
Tags: solidity, web3, smart contracts
Bio: Senior Solidity developer. 5 years building DeFi protocols.
Auto-accept threshold: 7 (bids scoring 7 or above are auto-accepted)
Auto-reply template: "Thanks for reaching out. I've reviewed your bid and I'm happy to connect. Reach me on WhatsApp Business: +234..."
Tiers: $5 standard / $20 priority / $50 guaranteed 24hr reply

She clicks "Create and Register on Arc." The transaction executes via her Circle wallet. Her profile is now live on the AttnnRegistry smart contract on Arc mainnet. Her handle attnn.xyz/c/sarah is active.

Step 4 Add Handle to Social Media Bio

She copies attnn.xyz/c/sarah and adds it to her X bio, LinkedIn, and Instagram. Now everyone who visits her profile sees her Attn. handle. The link is her economic endpoint anyone who wants her attention seriously knows what to do.

Step 5 Bids Start Arriving

She gets a WhatsApp notification: "New bid on Attnn. $15 USDC from an anonymous bidder. Score: 8/10. Auto-accepted."

Her creator agent evaluated the bid while she was sleeping. Score 8 bid amount was 3x her minimum, message was highly relevant to her Solidity tags, queue depth was low. The agent auto-accepted it, sent her auto-reply template on-chain, and $15 USDC settled to her wallet automatically.

She wakes up with money in her wallet and a conversation waiting in her Attn. inbox without having touched her phone.

Another notification: "New bid $6 USDC. Score: 5/10. Surfaced to inbox." She opens the app, reads the message, decides it's worth replying to, types her reply, and accepts. Another $6 USDC settles.

Another notification: "New bid $5 USDC. Score: 3/10. Auto-rejected. Bidder refunded." She never even saw that one. Not relevant enough. The money went back.

Step 6 Check Dashboard

She opens her dashboard. Creator tab shows:

Total earnings: $47.50 USDC this week
Pending bids: 3 waiting for review
Acceptance rate: 78%
Reputation score: 8.4/10

She clicks on a pending bid, reads the message, types a reply, accepts. $12 USDC settles instantly.

She clicks "Send USDC" from her wallet dropdown, enters her personal wallet address, and moves $40 to her external wallet. Or she uses CPN to convert $40 USDC back to Naira, which lands in her Nigerian bank account within minutes.

For a Company or Bidder

Step 1 Company Account Setup

A Lagos-based startup wants to hire Solidity developers. Their CTO creates a company account on Attn. He invites three team members two recruiters and the head of engineering. One shared company wallet, funded with $500 USDC via CPN from the company's Naira account.

Step 2 Configure Bidder Agents

Each recruiter configures their own agent:

Recruiter 1  "Find senior Solidity developers with DeFi experience. Budget $30/day. Only bid between 9am-5pm WAT. Minimum fit score 6. Maximum bid per creator $25."

Recruiter 2  "Find frontend developers with React and Web3 experience. Budget $20/day. Blacklist these 3 handles. Custom message: Hi, we're building on Arc and looking for..."

Step 3  Agents Run Autonomously

Every 10 minutes, both agents wake up. They query AttnnRegistry on Arc mainnet for creators matching their search tags. They call AISA to score each creator for fit. For each creator that scores above the minimum fit score:

Agent checks company daily budget still available
Agent calls approve() on USDC contract from company wallet
Agent waits 8 seconds for Arc to confirm
Agent calls placeBid() on AttnnEscrow with the bid amount and message
Agent waits for on-chain bid ID confirmation
Inngest fires attnn/bid.placed event
Creator's creator agent evaluates the bid
If accepted, USDC releases from escrow to creator wallet
Private message thread opens in dashboard for both parties
Recruiter gets notification "Bid accepted by @sarah $18 USDC"

All of this happens without any human clicking anything.

Step 4 Review and Follow Up

The head of engineering opens the company dashboard. He sees all accepted bids across both agents 7 this week. He reads the conversation threads. Three look promising. He jumps into those conversations directly from within Attn. and continues the dialogue. Two result in interviews scheduled. One results in a hire.

Total spent that week: $94 USDC. Cost per qualified conversation: $13.43. Cost per interview: $31.33.

For an External AI Agent

An external recruiting agent built by a third-party company running on LangChain, OpenAI Agents, or any framework wants to find Solidity developers. It doesn't have an Attn. account. It has never heard of Attn. But it has a funded wallet on Arc mainnet.

Step 1 Discover Attnn. on Circle Agent Marketplace

The agent queries agents.circle.com via the Circle CLI. It finds "Attnn. Creator Profile API" Social Intelligence category, $0.001 USDC per request, endpoint: attnn.xyz/api/c/{handle}.

Step 2 Discover Creator Handles

The agent calls attnn.xyz/creators the public discovery page and scrapes the list of active creator handles and their minimum bids.

Step 3 Pay to Access Profiles

For each creator it wants to evaluate:

GET https://attnn.xyz/api/c/sarah
← HTTP 402 Payment Required
   PAYMENT-REQUIRED header (base64):
   {
     amount: 1000 (= $0.001 USDC),
     asset: 0x3600...0000 (USDC on Arc),
     network: eip155:137 (Arc mainnet),
     payTo: 0x569ab5... (platform wallet),
     scheme: GatewayWalletBatched
   }

The agent signs an EIP-3009 payment authorization from its funded Arc wallet. It resends the request with the payment-signature header. Circle Gateway verifies and settles the payment. The server returns:

json
{
  "handle": "sarah",
  "unlocked": true,
  "profile": {
    "bio": "Senior Solidity developer. 5 years building DeFi protocols.",
    "tags": ["solidity", "web3", "smart contracts"],
    "minBid": "5000000",
    "isActive": true
  }
}

Step 4 Place a Bid

The agent evaluates the profile. Good fit. It calls the Attn. bid placement API directly passing the creator handle, bid amount, and message. USDC moves from the agent's wallet into escrow. Sarah's creator agent evaluates the bid. It scores 8. Auto-accept. USDC settles. Sarah earns. The external agent successfully reached a creator without a human being involved on either side, on any platform, at any point.

That is the fully agentic vision. Machine to machine. USDC to attention. Arc to settlement.

## FAQ 

"What stops a creator from just replying 'ok thanks' and collecting the USDC?"

Right now the contract only requires 10 characters so technically they could. But three things prevent it at scale: first, bidders can rate reply quality, which feeds into the creator's on-chain reputation score, low quality replies mean fewer bids over time. Second, the marketplace self-regulates word gets around. Third, we're building reply quality verification into the next version where the creator agent scores the reply before releasing funds. For V1 the economic incentive is strong enough a creator who gives bad replies loses future earning potential.

"Who is your target user? Developers? Influencers? Everyone?"

We're starting with two specific groups in Nigeria. On the creator side Web3 developers, designers, Influencers and content creators who are already active on X, Instagram and LinkedIn and already getting flooded with low-quality outreach. On the bidder side startups and companies trying to hire or reach these professionals. Nigeria is the entry point because we understand the market, the attention problem is acute there, and the Web3 community is active. We expand from there.

"How is this different from Calendly where you charge for meetings, or other paid inbox products?"

Three differences. First, both sides are autonomous neither the bidder nor the creator has to manually do anything after setup. Calendly still requires the person to manage their calendar. Second, payment is trustless it's in escrow on Arc, not processed through a platform that could go down or dispute the payment. Third, the refund is automatic if the creator doesn't reply in 14 days, the bidder gets every cent back without asking. No other product in this space has trustless escrow and automatic refunds.

"What if nobody bids? How do you get supply and demand started?"

The classic chicken and egg problem. Our answer is V1 PitchSlotArc already has 515+ transactions and $1,148 USDC through escrow. We have proof that people will pay to reach creators on Arc. For V2 we're starting with our existing community Arc Architects and Web3 builders in Nigeria who are already active. We give creators a handle to add to their X and LinkedIn bio today, even on testnet. Every creator who adds their handle is supply. Every company that wants to reach them is demand. The CPN fiat on-ramp removes the last barrier for non-crypto bidders.

2. Technical

"Why did you build your own escrow contract instead of using an existing solution?"

The existing escrow solutions don't support the specific bid lifecycle we needed reply-triggered release, automatic 14-day refund, bidder and creator discovery by address, and on-chain bid ID lookup for accept and reject. We needed all four in one contract. Building it ourselves with Foundry on Arc gave us full control and 20 passing tests to prove correctness.

"How does the bidder agent actually find creators? Is it centralised or on-chain?"

Fully on-chain. The bidder agent calls getCreatorsByTag() on the AttnnRegistry contract deployed on Arc. It reads directly from the blockchain no centralised database involved in discovery. This is important because it means any external bidder agent, not just Attnn.'s own agent, can discover creators on-chain without going through our servers.

"The x402 gate what happens if Circle Gateway has an outage? Do users lose money?"

Two scenarios. If the outage happens before settlement the payment never goes through and the agent's wallet is untouched. If it happens after settlement but before the profile is returned the USDC has moved but the agent got nothing. This is a known limitation we've documented. The fix is idempotency store the settlement transaction ID after every successful payment, and on retry return the cached profile without re-charging. We're building this post-mainnet.

"You mentioned both agents run on Circle Developer-Controlled Wallets. What if Circle has downtime?"

The smart contracts on Arc continue to hold the escrow funds regardless of Circle's availability. Existing bids, accepted bids, and pending refunds are all on-chain and safe. What stops during Circle downtime is the ability to place new bids or execute new accepts/rejects because those require Circle SDK calls to sign transactions. This is the tradeoff of using developer-controlled wallets vs user-controlled wallets. For our use case where the UX benefit of no MetaMask is critical for Nigerian adoption it's the right tradeoff.

3. Business Model

"You take no fee right now. When do you monetize and how much?"

We deliberately launched without a fee to prove the loop works first. Post-mainnet we add a 2-3% platform fee taken automatically in the escrow release. At $10,000 monthly bid volume that's $200-300 per month. At $100,000 monthly volume $2,000-3,000. Beyond the transaction fee we have creator tiers ($5/$20/$50), team and company bidder accounts, and eventually a premium API for external agents accessing creator profiles at scale.

"What's your revenue projection for the accelerator period?"

Honest answer: we're not projecting revenue during the accelerator, we're projecting volume. If we activate 500 Nigerian creators and 50 companies deploying bidder agents at $20/day budget, that's $1,000/day in bid volume, $30,000/month. At 2-3% that's $600-900/month in platform fees. That's not the goal for the accelerator period, the goal is proving the marketplace dynamics work at scale before optimising for revenue.

"You're a solo founder with a team of four. What happens if someone leaves?"

The core protocol contracts, agent logic, x402 gate is documented, tested, and open source on GitHub. Any developer can pick it up. The PRODUCT_DECISIONS.md in our repo documents every architectural decision so knowledge isn't locked in one person's head. We're deliberately building with documentation-first so the project survives team changes.

4. Arc and Circle Specific

"How deeply are you using the Circle stack? Could you switch to another chain?"

Switching would require rebuilding from scratch. We use Circle Developer-Controlled Wallets for every user that's not replaceable without rebuilding the entire onboarding and transaction layer. We use x402 with Circle Gateway's BatchFacilitatorClient for nanopayments. We're integrating Circle Payments Network for fiat on-ramp. And we chose Arc specifically because USDC is the native gas token which means our economics work cleanly without a separate gas token. This is a Circle-native product.

"Arc mainnet is September 16. Are you actually ready to deploy on day one?"

Yes. Our contracts are already deployed on Arc Testnet. Migrating to mainnet requires redeploying the two contracts and updating two environment variables ATTN_REGISTRY_CONTRACT and ATTN_ESCROW_CONTRACT. No application code changes. No frontend changes. We tested this assumption during development specifically so mainnet migration would be straightforward.

"What's the biggest risk to Attnn. right now?"

Honest answer, adoption. The technology works. The contracts work. The agents work. The biggest risk is getting enough creators to add their Attnn. handle to their bios and enough companies to fund bidder agents. That's not a technical problem it's a go-to-market problem. Which is exactly why we need the accelerator. We need the network, the mentorship, and the Circle ecosystem introductions to solve the adoption problem. The product is ready. The market needs to find it.

---

*This document is maintained alongside the Attnn. codebase and updated as product decisions evolve.*

*Arc is a trademark of Circle Internet Group, Inc. and/or its affiliates. Attn. is built on Arc Network and is not affiliated with or endorsed by Circle.*
