import type { BidStatus } from "@/lib/db/schema";

/** Shapes passed from the dashboard server page to its client components (all serialisable). */

export interface WalletData {
  id: string;
  address: string;
  circleWalletId: string;
  blockchain: string;
  state: string;
}

export interface ProfileData {
  id: string;
  handle: string;
  minBid: string;
  tags: string[];
  bio: string | null;
  autoAcceptThreshold: number | null;
  autoReplyTemplate: string | null;
  isActive: boolean;
  availabilityStatus: string;
  openTo: string[];
  avatarUrl: string | null;
}

export interface BidderConfigData {
  id: string;
  goal: string | null;
  dailyBudget: string;
  maxBidPerCreator: string;
  minFitScore: number;
  searchTags: string[];
  defaultMessage: string | null;
  isActive: boolean;
  agentName: string | null;
}

export interface BidData {
  id: string;
  bidderUserId: string;
  creatorUserId: string;
  bidderAddress: string;
  creatorAddress: string;
  amountUsdc: string;
  message: string | null;
  status: BidStatus;
  /** Creator agent's triage score, 0–10. */
  score: number | null;
  reply: string | null;
  /** Circle id of an in-flight settlement (or a reservation sentinel). */
  settlementTxHash: string | null;
  settlementAction: "accept" | "reject" | "refund" | null;
  failReason: string | null;
  createdAt: string;
  settledAt: string | null;
  counterOfferAmount: string | null;
  /** For a bid placed at a creator's counter price: the countered bid it replaces. */
  replacesBidId: string | null;
  /** Explorer links for the escrow and settlement transactions, when known. */
  bidTxHref: string | null;
  settlementOnChainTxHash: string | null;
  settlementTxHref: string | null;
  /** Bidder's agent name, if they have one. */
  agentName: string | null;
  creatorHandle: string | null;
  creatorAvatarUrl: string | null;
  /** For the viewer's own open bids: position in the creator's book (1 = highest). */
  bookRank: { rank: number; of: number } | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- agent_logs.data is untyped jsonb whose shape varies by action
export type LogPayload = any;

export interface LogData {
  id: string;
  action: string;
  data: LogPayload;
  txHash: string | null;
  /** Explorer link for txHash, built on the server from the network config. */
  txHref: string | null;
  createdAt: string;
}

export interface SumCount {
  usdc: string;
  count: number;
}

export interface PortfolioSummary {
  /** Wallet USDC (atomic) read from Arc, or null if the read failed. */
  walletUsdc: string | null;
  bidder: {
    inEscrow: SumCount;
    confirming: SumCount;
    spentTodayUsdc: string;
    cleared7d: SumCount;
    returned7d: SumCount;
  };
  creator: {
    waiting: SumCount;
    earnedAllTimeUsdc: string;
    earned7d: SumCount;
    replyRate: number | null;
    medianReplyMs: number | null;
  };
}
