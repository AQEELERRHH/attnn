import type { BidStatus } from "@/lib/db/schema";
import type { PublicVerification, SocialProvider } from "@/lib/social-verify-rules";

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
  /** "registering" while registerCreator confirms on Arc; "failed" with registrationError. */
  registration: "active" | "registering" | "failed" | "none";
  registrationError: string | null;
  availabilityStatus: string;
  openTo: string[];
  avatarUrl: string | null;
  /** Social accounts this creator has verified (X, LinkedIn). */
  verifications: PublicVerification[];
  /** Providers configured on this deployment; empty = verification off. */
  verifyProviders: SocialProvider[];
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
  /** Creator's own pending bids only: their agent's AI draft awaiting approval (D2). */
  suggestedReply: string | null;
  /** Who wrote the reply (null on old rows). */
  replySource: "creator" | "template" | "ai" | null;
  /** The bidder's rating of the reply: 1 = worth it, -1 = not, null = unrated. */
  replyRating: number | null;
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

/** On-chain facts for the agent's spending-policy card (built on the server). */
export interface AgentPolicyInfo {
  escrowAddress: string | null;
  escrowHref: string | null;
  walletHref: string | null;
  /** Escrow limits in atomic USDC. */
  minBid: string;
  maxBid: string;
  refundDays: number;
  /** The escrow is v2: fingerprints instead of text, and an emergency pause for new bids. */
  escrowV2: boolean;
  /** The agent's own wallet (it bids only from this). null until created. */
  agentWallet: { address: string; href: string; usdc: string | null } | null;
  /** Main wallet balance, for "Move to agent". */
  mainWalletUsdc: string | null;
  /** What an agent pays to read a creator's profile (atomic USDC), or null when reads are free. */
  readPrice: string | null;
}
