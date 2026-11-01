/**
 * Plain-English explanations of the terms people meet in Attnn., written for someone
 * who has never used crypto. Shared by the welcome guide, the field hints and the Help
 * menu so every screen says the same thing. Client-safe.
 *
 * Keep every sentence true to the code and the escrow contract (see the Spending
 * policy card in app/dashboard/agent-policy.tsx): the escrow pays the creator only
 * when they reply, refunds the bidder on a decline or after REFUND_PERIOD, and
 * nothing else. The two v2 lines (escrowPrivacy, escrowPause) are shown only when the
 * deployed escrow is v2 (lib/escrow.ts escrowVersion).
 */
export const glossary = {
  usdc: "USDC is a digital dollar: 1 USDC is always worth $1. Every price, bid and payout on Attnn. is in USDC.",
  escrow:
    "When you bid, your USDC is locked in a contract on Arc, not sent to the creator. It can only go to the creator when they reply, or back to you.",
  refund: (days: number) =>
    `No reply within ${days} days? Your USDC comes back to your wallet automatically. If the creator declines, it comes back straight away.`,
  wallet:
    "Attnn. creates and runs a USDC wallet on Arc for you, so there's no seed phrase to manage. Money only leaves it when you bid, send or fund your agent, plus tiny network fees.",
  arc: "Arc is the blockchain Attnn. runs on. Network fees are tiny and paid in USDC, so you never need any other token.",
  bidFloor:
    "The lowest bid this creator accepts. You can bid more: higher bids sit higher in their inbox, so they're seen first.",
  creatorFloor:
    "The lowest bid you'll accept. Nobody can bid below it. Higher bids rank first in your inbox, so you see the most serious ones first.",
  creatorTags: "Topics you know about. Bidder agents look for creators by these words, so pick the ones people would search for.",
  replyTemplate:
    "If you let your agent accept bids for you, this is the reply it sends. It needs at least 100 characters so every paid reply says something real. Bidders see it labelled as an auto-reply.",
  availability: "Pausing your market stops new bids. Bids already waiting stay in your inbox until you reply or they refund.",
  dailyBudget:
    "The most your agent can bid in one day (resets at 00:00 UTC). Once it reaches this it stops until tomorrow.",
  maxBidPerCreator:
    "Your agent bids each creator's lowest price, and never offers one creator more than this, even if they counter. Creators whose lowest bid is higher are skipped.",
  fitScore:
    "Your agent's AI rates each creator from 0 to 10 against your goal, from their topics and bio only (never their price). It only bids on creators scoring at least this, unless the AI flags them as unsuitable (spam, impersonation or nothing to do with your goal). If the AI can't score a creator, it doesn't bid. A creator keeps the same score for up to 7 days unless your goal or their profile changes.",
  searchTags: "Topics to look for. Your agent only considers creators whose tags match at least one of these.",
  escrowPrivacy:
    "Bid messages and replies are never written on Arc as text. Only a fingerprint of each is stored, which proves a reply wasn't changed afterwards without revealing what it says. Amounts and wallet addresses are public on Arc, like any blockchain payment; your name and email never go on-chain.",
  escrowPause:
    "In an emergency, new bids can be paused. The pause can't move or freeze USDC already in the escrow: replies, declines and refunds keep working.",
  /** Shown only when paid profile reads are on (lib/gateway.ts agentReadsEnabled). */
  agentReads:
    "Reading a creator's profile costs $0.001, counted in your daily budget (once per creator a day). If it can't pay for a profile, it doesn't bid on that creator.",
  agentNeverWithReads:
    "Touch your main wallet, or send USDC anywhere except the escrow and $0.001 profile reads. Only you can move money.",
  agentApproveWithReads:
    "Approve any contract other than these two: the escrow, for exactly the bid it's placing, or Circle Gateway, for exactly the $0.10 it sets aside for profile reads.",
} as const;
