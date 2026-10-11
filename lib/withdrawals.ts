/**
 * Money leaving a user's control (decision D4). Everything that can move USDC out of a
 * main wallet shares ONE allowance of DAILY_ALLOWANCE in any rolling 24 hours:
 *
 *   send        USDC sent to another address           (wallet/send)       never above it
 *   bid         a bid placed by hand from the main wallet (bid/place)      above it with an emailed code
 *   agent_fund  USDC moved from main to the agent wallet (wallet/agent)    above it with an emailed code
 *
 * Bids by the agent aren't counted again: they spend the agent wallet, which was
 * funded under the allowance. Raising the agent's daily budget or per-creator cap
 * also needs a code (bidder-config/create).
 *
 * Emailed 6-digit codes (security codes) confirm a specific action: a new send
 * address, or one over-allowance bid / top-up / limit raise. A code is bound to its
 * "subject" (the action and its exact values), lasts 10 minutes and allows 5 tries.
 *
 * Every check and reservation runs under one per-user advisory lock, so actions racing
 * each other are counted one after the other.
 *
 * This stops someone holding a stolen session from moving more than the allowance
 * without the account's email. It does not protect against a compromised Attnn
 * server (Attnn holds the wallet keys).
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "./db/client";
import { bids, users, wallets, withdrawalAddresses, withdrawalCodes, withdrawals } from "./db/schema";
import { sendUserEmail } from "./email";
import { formatUsd } from "./bid-rules";

/** $500 in any rolling 24 hours, shared by sends, hand-placed bids and agent top-ups. */
export const DAILY_ALLOWANCE = BigInt(500_000_000);
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** A new code for the same subject at most once a minute. */
const CODE_RESEND_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A problem the user can act on; `status` is the HTTP status a route should return. */
export class WithdrawalError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "WithdrawalError";
  }
}

/** The action would go past the 24-hour allowance. `remaining` is what's left (atomic). */
export class AllowanceExceeded extends WithdrawalError {
  constructor(public readonly remaining: bigint, canConfirm: boolean) {
    super(
      `For your safety, at most ${formatUsd(DAILY_ALLOWANCE)} can leave your wallet in any 24 hours (sends, bids and agent top-ups together). ` +
        `You have ${formatUsd(remaining)} left right now.` +
        (canConfirm ? " We can email you a code to approve this one." : ""),
      429,
    );
    this.name = "AllowanceExceeded";
  }
}

const lower = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ─── Subjects: what a code confirms ─────────────────────────────────────────

export const codeSubject = {
  address: (address: string) => `address:${lower(address)}`,
  bid: (creatorUserId: string, amount: bigint) => `bid:${creatorUserId}:${amount}`,
  agentFund: (amount: bigint) => `agent-fund:${amount}`,
  agentLimits: (dailyBudget: string, maxBidPerCreator: string) => `agent-limits:${dailyBudget}:${maxBidPerCreator}`,
};

// ─── Security codes ─────────────────────────────────────────────────────────

function codeHash(userId: string, subject: string, code: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${userId}:${subject}:${code}`).digest("hex");
}

/** Subjects can be long (addresses, ids); the table stores a fixed-size digest of them. */
const subjectKey = (subject: string) => createHash("sha256").update(subject).digest("hex");

/**
 * Emails a code confirming `what` (plain English, e.g. "send USDC to 0x…"). Replaces
 * any earlier code for the same subject; refuses a second one within a minute.
 * Returns the address it went to, masked.
 */
export async function requestSecurityCode(userId: string, subject: string, what: string, now = Date.now()): Promise<{ sentTo: string }> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
  if (!user?.email) throw new WithdrawalError("Your account has no email address, so this can't be confirmed.", 409);

  const key = subjectKey(subject);
  const existing = await db.query.withdrawalCodes.findFirst({
    where: and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.subject, key)),
  });
  if (existing && now - existing.createdAt.getTime() < CODE_RESEND_MS) {
    throw new WithdrawalError("A code was just sent. Check your email, or wait a minute to get a new one.", 429);
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    userId,
    subject: key,
    codeHash: codeHash(userId, subject, code),
    expiresAt: new Date(now + CODE_TTL_MS),
    attempts: 0,
    createdAt: new Date(now),
  };
  await db
    .insert(withdrawalCodes)
    .values(values)
    .onConflictDoUpdate({ target: [withdrawalCodes.userId, withdrawalCodes.subject], set: values });

  const sent = await sendUserEmail(
    user.email,
    `Your Attnn. code: ${code}`,
    [
      `Your code to ${what} is:`,
      "",
      `    ${code}`,
      "",
      "It expires in 10 minutes.",
      "",
      "If this wasn't you, don't share this code with anyone. Someone may be signed in to your account: sign out of Attnn. on every device and contact us.",
    ].join("\n"),
  );
  if (!sent) {
    await db.delete(withdrawalCodes).where(and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.subject, key)));
    throw new WithdrawalError("We couldn't email your code right now. Please try again shortly.", 503);
  }
  const [name, domain] = user.email.split("@");
  return { sentTo: `${(name ?? "").slice(0, 2)}…@${domain ?? ""}` };
}

/**
 * Checks and uses up a code for `subject`. Wrong codes count (atomically, so parallel
 * guesses can't skip the limit); after CODE_MAX_ATTEMPTS the code is dead.
 */
export async function consumeSecurityCode(userId: string, subject: string, code: string, now = Date.now()): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new WithdrawalError("Enter the 6-digit code from your email.");
  const key = subjectKey(subject);
  const row = await db.query.withdrawalCodes.findFirst({
    where: and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.subject, key)),
  });
  if (!row || row.expiresAt.getTime() <= now || row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new WithdrawalError("This code has expired or doesn't match what you're doing. Ask for a new one.", 410);
  }
  const [counted] = await db
    .update(withdrawalCodes)
    .set({ attempts: sql`${withdrawalCodes.attempts} + 1` })
    .where(and(eq(withdrawalCodes.id, row.id), sql`${withdrawalCodes.attempts} < ${CODE_MAX_ATTEMPTS}`))
    .returning({ attempts: withdrawalCodes.attempts });
  if (!counted) throw new WithdrawalError("This code has expired. Ask for a new one.", 410);

  const expected = Buffer.from(row.codeHash, "hex");
  const given = Buffer.from(codeHash(userId, subject, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const left = CODE_MAX_ATTEMPTS - counted.attempts;
    throw new WithdrawalError(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Ask for a new one.");
  }
  // Single use: only the caller whose delete removed it may go on.
  const used = await db.delete(withdrawalCodes).where(eq(withdrawalCodes.id, row.id)).returning({ id: withdrawalCodes.id });
  if (!used.length) throw new WithdrawalError("This code was already used. Ask for a new one.", 410);
}

// ─── Send addresses ─────────────────────────────────────────────────────────

export async function isConfirmedAddress(userId: string, address: string): Promise<boolean> {
  const row = await db.query.withdrawalAddresses.findFirst({
    where: and(eq(withdrawalAddresses.userId, userId), eq(withdrawalAddresses.address, lower(address))),
    columns: { id: true },
  });
  return !!row;
}

/** Confirms a new send address with its code; it's remembered for good. */
export async function confirmWithdrawalAddress(userId: string, address: string, code: string): Promise<void> {
  await consumeSecurityCode(userId, codeSubject.address(address), code);
  await db.insert(withdrawalAddresses).values({ userId, address: lower(address) }).onConflictDoNothing();
}

// ─── The shared allowance ───────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Serialises every allowance check-and-reserve of one user. Call inside a transaction. */
export async function lockAllowance(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`allowance:${userId}`}))`);
}

/**
 * USDC that left (or is leaving) the main wallet in the last 24 hours: sends and agent
 * top-ups that weren't refused, plus bids placed by hand from the main wallet that
 * didn't fail.
 */
export async function allowanceUsed(userId: string, conn: Tx | typeof db = db, now = Date.now()): Promise<bigint> {
  const since = new Date(now - DAY_MS);
  const [moves] = await conn
    .select({ total: sql<string>`coalesce(sum(${withdrawals.amountUsdc}::numeric), 0)::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), ne(withdrawals.status, "failed"), gt(withdrawals.createdAt, since)));
  const [manualBids] = await conn
    .select({ total: sql<string>`coalesce(sum(${bids.amountUsdc}::numeric), 0)::text` })
    .from(bids)
    .where(
      and(
        eq(bids.bidderUserId, userId),
        ne(bids.status, "failed"),
        gt(bids.createdAt, since),
        sql`lower(${bids.bidderAddress}) in (select lower(${wallets.address}) from ${wallets} where ${wallets.userId} = ${userId} and ${wallets.purpose} = 'main')`,
      ),
    );
  return BigInt(moves?.total ?? "0") + BigInt(manualBids?.total ?? "0");
}

export async function allowanceRemaining(userId: string): Promise<bigint> {
  const used = await allowanceUsed(userId);
  return used >= DAILY_ALLOWANCE ? BigInt(0) : DAILY_ALLOWANCE - used;
}

/**
 * Inside a transaction holding lockAllowance: throws AllowanceExceeded unless `amount`
 * fits what's left, or the user approved going over with a code (`approved`).
 */
export async function assertWithinAllowance(
  tx: Tx,
  userId: string,
  amount: bigint,
  opts: { approved?: boolean; canConfirm: boolean },
): Promise<void> {
  if (opts.approved) return;
  const used = await allowanceUsed(userId, tx);
  if (used + amount > DAILY_ALLOWANCE) {
    throw new AllowanceExceeded(used >= DAILY_ALLOWANCE ? BigInt(0) : DAILY_ALLOWANCE - used, opts.canConfirm);
  }
}

export type WithdrawalRow = typeof withdrawals.$inferSelect;

/**
 * Reserves a send or agent top-up against the allowance, or returns this request's
 * existing row (a retry). Sends can never go over; a top-up can with `approved`.
 */
export async function reserveWithdrawal(params: {
  userId: string;
  kind: "send" | "agent_fund";
  requestKey: string;
  to: string;
  amount: bigint;
  approved?: boolean;
}): Promise<{ row: WithdrawalRow; retry: boolean }> {
  return db.transaction(async (tx) => {
    await lockAllowance(tx, params.userId);
    const existing = await tx.query.withdrawals.findFirst({ where: eq(withdrawals.requestKey, params.requestKey) });
    if (existing) {
      if (existing.userId !== params.userId) throw new WithdrawalError("Invalid request id. Reload the page and try again.");
      return { row: existing, retry: true };
    }
    await assertWithinAllowance(tx, params.userId, params.amount, {
      approved: params.kind === "agent_fund" && params.approved,
      canConfirm: params.kind === "agent_fund",
    });
    const [row] = await tx
      .insert(withdrawals)
      .values({ userId: params.userId, kind: params.kind, requestKey: params.requestKey, toAddress: lower(params.to), amountUsdc: params.amount.toString() })
      .returning();
    return { row: row!, retry: false };
  });
}

/**
 * Records Circle's answer for a reserved row. Returns true only for the call that
 * first moved it to "submitted" (so the notice email goes out exactly once).
 */
export async function markWithdrawal(id: string, outcome: { circleTxId: string } | { failed: true }): Promise<boolean> {
  if ("failed" in outcome) {
    await db.update(withdrawals).set({ status: "failed" }).where(and(eq(withdrawals.id, id), ne(withdrawals.status, "submitted")));
    return false;
  }
  const changed = await db
    .update(withdrawals)
    .set({ status: "submitted", circleTxId: outcome.circleTxId })
    .where(and(eq(withdrawals.id, id), ne(withdrawals.status, "submitted")))
    .returning({ id: withdrawals.id });
  return changed.length > 0;
}

/** Best-effort notice to the account's email (spots a stolen session fast). */
export async function notifyAccount(userId: string, subject: string, lines: string[]): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
  if (!user?.email) return;
  await sendUserEmail(user.email, subject, [...lines, "", "If this wasn't you, sign out of Attnn. on every device and contact us straight away."].join("\n")).catch(
    () => false,
  );
}

export async function notifyWithdrawal(userId: string, to: string, amount: bigint): Promise<void> {
  await notifyAccount(userId, `You sent ${formatUsd(amount)} USDC from Attnn.`, [
    `${formatUsd(amount)} USDC is on its way from your Attnn. wallet to ${short(to)} (${to}).`,
  ]);
}
