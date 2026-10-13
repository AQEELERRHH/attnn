/**
 * The "Get started" checklist. Client-safe and pure: every step is worked out from
 * data the dashboard already has (wallet, balances, profile, bids), never from a
 * "mark as done" click, so a step is ticked the moment the real thing happens and
 * stays accurate on every device.
 *
 * Only two facts are stored (users.onboarding_seen_at, users.checklist_dismissed_at,
 * migration 0007), plus the role the user picks in the welcome (users.role).
 */
export type OnboardingRole = "bidder" | "creator" | "both";

export type StepId = "wallet" | "fund" | "first-bid" | "market" | "registered" | "photo" | "first-reply";

export interface ChecklistStep {
  id: StepId;
  title: string;
  /** One plain-English line: what it is and why it matters. */
  detail: string;
  done: boolean;
  /** Something is in progress (e.g. confirming on Arc) or needs a retry. */
  state?: "waiting" | "failed";
  optional?: boolean;
  /** first-reply: bids waiting for a reply right now. */
  waiting?: number;
}

export interface ChecklistInput {
  role: string;
  hasWallet: boolean;
  /** Atomic USDC strings, null when the balance couldn't be read. */
  walletUsdc: string | null;
  agentWalletUsdc: string | null;
  /** Smallest bid the escrow accepts, atomic USDC. */
  minBid: bigint;
  /** Statuses of bids this user placed (any age the dashboard loaded). */
  placedStatuses: string[];
  /** Bids this user received. */
  received: { status: string }[];
  profile: { registration: "active" | "registering" | "failed" | "none"; avatarUrl: string | null } | null;
  /** Bidder agent strategy saved. */
  hasAgent: boolean;
  isTestnet: boolean;
  /** Formatted minimum, e.g. "$1.00". */
  minBidLabel: string;
}

export function onboardingRole(role: string | null | undefined): OnboardingRole {
  return role === "creator" || role === "both" ? role : "bidder";
}

const atLeast = (atomic: string | null, min: bigint) => {
  try {
    return atomic !== null && BigInt(atomic) >= min;
  } catch {
    return false;
  }
};

export function computeChecklist(i: ChecklistInput): { role: OnboardingRole; steps: ChecklistStep[]; done: number; total: number; complete: boolean } {
  const role = onboardingRole(i.role);
  const placedAny = i.placedStatuses.some((s) => s !== "failed");
  const repliedAny = i.received.some((b) => b.status === "accepted");
  const waiting = i.received.filter((b) => b.status === "pending" || b.status === "counter_offered").length;

  const wallet: ChecklistStep = {
    id: "wallet",
    title: "Your wallet is ready",
    detail: "Attnn. made you a USDC wallet on Arc. No seed phrase to keep safe.",
    done: i.hasWallet,
  };
  const fund: ChecklistStep = {
    id: "fund",
    title: "Add USDC",
    detail: i.isTestnet
      ? `Get free test USDC from Circle's faucet. You need at least ${i.minBidLabel} to bid.`
      : `Send USDC on Arc to your wallet address. You need at least ${i.minBidLabel} to bid.`,
    // A bid already placed proves the wallet was funded, even if it's spent now.
    done: placedAny || atLeast(i.walletUsdc, i.minBid) || atLeast(i.agentWalletUsdc, i.minBid),
  };
  const firstBid: ChecklistStep = {
    id: "first-bid",
    title: "Place your first bid",
    detail: i.hasAgent
      ? "Pick a creator and offer USDC for a reply, or resume your agent and let it bid for you."
      : "Pick a creator and offer USDC for a reply. Or set up an agent to find creators for you.",
    done: placedAny,
  };

  const reg = i.profile?.registration ?? "none";
  const market: ChecklistStep = {
    id: "market",
    title: "Open your market",
    detail: "Choose a handle, the lowest bid you'll take and a few topics you know about.",
    done: !!i.profile,
  };
  const registered: ChecklistStep = {
    id: "registered",
    title: "Go live on Arc",
    detail:
      reg === "registering"
        ? "Confirming on Arc. This usually takes under a minute."
        : reg === "failed"
          ? "Going live didn't work. Open the Creator tab to see why and try again."
          : "Registering your market on Arc lets people and agents bid on you. You pay a small network fee in USDC, so keep at least $1 in your wallet.",
    done: reg === "active",
    state: reg === "registering" ? "waiting" : reg === "failed" ? "failed" : undefined,
  };
  const photo: ChecklistStep = {
    id: "photo",
    title: "Add a photo",
    detail: "Markets with a face get noticed.",
    done: !!i.profile?.avatarUrl,
    optional: true,
  };
  const firstReply: ChecklistStep = {
    id: "first-reply",
    title: "Reply to your first bid",
    detail:
      waiting > 0
        ? `${waiting === 1 ? "A bid is" : `${waiting} bids are`} waiting. Reply within 3 days and the USDC is yours.`
        : "Share your market link. When a bid comes in, reply within 3 days to earn it.",
    done: repliedAny,
    waiting,
  };

  const steps =
    role === "creator"
      ? [wallet, market, registered, photo, firstReply]
      : role === "both"
        ? [wallet, fund, firstBid, market, registered, firstReply]
        : [wallet, fund, firstBid];

  const done = steps.filter((s) => s.done).length;
  // Optional steps don't hold the checklist open.
  const complete = steps.every((s) => s.done || s.optional);
  return { role, steps, done, total: steps.length, complete };
}
