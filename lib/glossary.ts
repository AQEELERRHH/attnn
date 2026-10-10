/**
 * Plain-English explanations of the terms people meet in Attnn., written for someone
 * who has never used crypto. Shared by the welcome guide, the field hints and the Help
 * menu so every screen says the same thing. Client-safe.
 *
 * Keep every sentence true to the code and the escrow contract (see the Spending
 * policy card in app/dashboard/agent-policy.tsx): the escrow pays the creator only
 * when they reply, refunds the bidder on a decline or after REFUND_PERIOD, and
 * nothing else.
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
    "The most your agent can bid in one day (resets at 00:00 UTC). Once it reaches this it stops until tomorrow, whatever the AI suggests.",
  maxBidPerCreator:
    "Your agent never offers one creator more than this, even if they counter. Creators whose lowest bid is higher are skipped.",
  fitScore:
    "Your agent's AI rates each creator from 0 to 10 against your goal. It only bids on creators scoring at least this. If the AI can't score a creator, it doesn't bid.",
  searchTags: "Topics to look for. Your agent only considers creators whose tags match at least one of these.",
} as const;
