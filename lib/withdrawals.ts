/**
 * Withdrawal protection (decision D4). A USDC send out of a user's main wallet:
 *
 *   1. To an address the user hasn't confirmed before → a 6-digit code is emailed to
 *      them; the send goes ahead only with that code (10 minutes, 5 tries). After that
 *      the address is remembered and needs no code.
 *   2. At most WITHDRAWAL_LIMIT_24H in any 24 hours. Checked and reserved under a
 *      per-user database lock, so two sends at once can't both fit under the limit.
 *   3. Idempotent: the same browser request id finds its own row and re-sends with the
 *      same Circle op key, so a retry can never pay twice.
 *
 * This stops someone holding a stolen session from emptying a wallet in one go.
 * It does not protect against a compromised Attnn server (Attnn holds the keys).
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { db } from "./db/client";
import { users, withdrawalAddresses, withdrawalCodes, withdrawals } from "./db/schema";
import { sendUserEmail } from "./email";
import { formatUsd } from "./bid-rules";

/** $500 in any rolling 24 hours (decision D4). */
export const WITHDRAWAL_LIMIT_24H = BigInt(500_000_000);
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
/** A new code for the same address at most once a minute. */
const CODE_RESEND_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A problem the user can act on; `status` is the HTTP status a route should return. */
export class WithdrawalError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "WithdrawalError";
  }
}

const lower = (a: string) => a.toLowerCase();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function codeHash(userId: string, address: string, code: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${userId}:${lower(address)}:${code}`).digest("hex");
}

export async function isConfirmedAddress(userId: string, address: string): Promise<boolean> {
  const row = await db.query.withdrawalAddresses.findFirst({
    where: and(eq(withdrawalAddresses.userId, userId), eq(withdrawalAddresses.address, lower(address))),
    columns: { id: true },
  });
  return !!row;
}

/** USDC sent or reserved in the last 24 hours (refused sends don't count). */
export async function usedLast24h(userId: string, now = Date.now()): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${withdrawals.amountUsdc}::numeric), 0)::text` })
    .from(withdrawals)
    .where(and(eq(withdrawals.userId, userId), ne(withdrawals.status, "failed"), gt(withdrawals.createdAt, new Date(now - DAY_MS))));
  return BigInt(row?.total ?? "0");
}

export async function remainingLast24h(userId: string): Promise<bigint> {
  const used = await usedLast24h(userId);
  return used >= WITHDRAWAL_LIMIT_24H ? BigInt(0) : WITHDRAWAL_LIMIT_24H - used;
}

/**
 * Emails a code for sending to `address`. Replaces any earlier code for it. Refuses
 * a second code within a minute. Returns the address the code went to, masked.
 */
export async function sendWithdrawalCode(userId: string, address: string, now = Date.now()): Promise<{ sentTo: string }> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
  if (!user?.email) throw new WithdrawalError("Your account has no email address, so new addresses can't be confirmed.", 409);

  const existing = await db.query.withdrawalCodes.findFirst({
    where: and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.address, lower(address))),
  });
  if (existing && now - existing.createdAt.getTime() < CODE_RESEND_MS) {
    throw new WithdrawalError("A code was just sent. Check your email, or wait a minute to get a new one.", 429);
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const values = {
    userId,
    address: lower(address),
    codeHash: codeHash(userId, address, code),
    expiresAt: new Date(now + CODE_TTL_MS),
    attempts: 0,
    createdAt: new Date(now),
  };
  await db
    .insert(withdrawalCodes)
    .values(values)
    .onConflictDoUpdate({ target: [withdrawalCodes.userId, withdrawalCodes.address], set: values });

  const sent = await sendUserEmail(
    user.email,
    `Your Attnn. code: ${code}`,
    [
      `Your code to confirm sending USDC to ${address} is:`,
      "",
      `    ${code}`,
      "",
      "It expires in 10 minutes. You only need it the first time you send to this address.",
      "",
      "If you didn't try to send USDC, don't share this code with anyone. Someone may be signed in to your account: sign out of Attnn. on every device and contact us.",
    ].join("\n"),
  );
  if (!sent) {
    await db.delete(withdrawalCodes).where(and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.address, lower(address))));
    throw new WithdrawalError("We couldn't email your code right now. Please try again shortly.", 503);
  }
  const [name, domain] = user.email.split("@");
  return { sentTo: `${(name ?? "").slice(0, 2)}…@${domain ?? ""}` };
}

/**
 * Checks a code; on success the address is remembered and the code is used up.
 * Wrong codes count; after CODE_MAX_ATTEMPTS the code is dead.
 */
export async function confirmWithdrawalAddress(userId: string, address: string, code: string, now = Date.now()): Promise<void> {
  if (!/^\d{6}$/.test(code)) throw new WithdrawalError("Enter the 6-digit code from your email.");
  const row = await db.query.withdrawalCodes.findFirst({
    where: and(eq(withdrawalCodes.userId, userId), eq(withdrawalCodes.address, lower(address))),
  });
  if (!row || row.expiresAt.getTime() <= now || row.attempts >= CODE_MAX_ATTEMPTS) {
    throw new WithdrawalError("This code has expired. Ask for a new one.", 410);
  }
  // Count the try first, so parallel guesses can't skip the limit.
  const [counted] = await db
    .update(withdrawalCodes)
    .set({ attempts: sql`${withdrawalCodes.attempts} + 1` })
    .where(and(eq(withdrawalCodes.id, row.id), sql`${withdrawalCodes.attempts} < ${CODE_MAX_ATTEMPTS}`))
    .returning({ attempts: withdrawalCodes.attempts });
  if (!counted) throw new WithdrawalError("This code has expired. Ask for a new one.", 410);

  const expected = Buffer.from(row.codeHash, "hex");
  const given = Buffer.from(codeHash(userId, address, code), "hex");
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    const left = CODE_MAX_ATTEMPTS - counted.attempts;
    throw new WithdrawalError(left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Ask for a new one.");
  }

  await db.transaction(async (tx) => {
    await tx.delete(withdrawalCodes).where(eq(withdrawalCodes.id, row.id));
    await tx.insert(withdrawalAddresses).values({ userId, address: lower(address) }).onConflictDoNothing();
  });
}

export type WithdrawalRow = typeof withdrawals.$inferSelect;

/**
 * Reserves a send against the 24-hour limit, or returns this request's existing row
 * (a retry). Runs under a per-user advisory lock so concurrent sends are counted one
 * after the other.
 */
export async function reserveWithdrawal(params: {
  userId: string;
  requestKey: string;
  to: string;
  amount: bigint;
}): Promise<{ row: WithdrawalRow; retry: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`withdraw:${params.userId}`}))`);
    const existing = await tx.query.withdrawals.findFirst({ where: eq(withdrawals.requestKey, params.requestKey) });
    if (existing) {
      if (existing.userId !== params.userId) throw new WithdrawalError("Invalid request id. Reload the page and try again.");
      return { row: existing, retry: true };
    }
    const [used] = await tx
      .select({ total: sql<string>`coalesce(sum(${withdrawals.amountUsdc}::numeric), 0)::text` })
      .from(withdrawals)
      .where(
        and(eq(withdrawals.userId, params.userId), ne(withdrawals.status, "failed"), gt(withdrawals.createdAt, new Date(Date.now() - DAY_MS))),
      );
    const usedAmount = BigInt(used?.total ?? "0");
    if (usedAmount + params.amount > WITHDRAWAL_LIMIT_24H) {
      const left = usedAmount >= WITHDRAWAL_LIMIT_24H ? BigInt(0) : WITHDRAWAL_LIMIT_24H - usedAmount;
      throw new WithdrawalError(
        `You can send up to ${formatUsd(WITHDRAWAL_LIMIT_24H)} in any 24 hours. You have ${formatUsd(left)} left right now.`,
        429,
      );
    }
    const [row] = await tx
      .insert(withdrawals)
      .values({ userId: params.userId, requestKey: params.requestKey, toAddress: lower(params.to), amountUsdc: params.amount.toString() })
      .returning();
    return { row: row!, retry: false };
  });
}

/** Records Circle's answer for a reserved send. */
export async function markWithdrawal(id: string, outcome: { circleTxId: string } | { failed: true }): Promise<void> {
  await db
    .update(withdrawals)
    .set("failed" in outcome ? { status: "failed" } : { status: "submitted", circleTxId: outcome.circleTxId })
    .where(eq(withdrawals.id, id));
}

/** Best-effort notice to the account's email after a send (spots a stolen session fast). */
export async function notifyWithdrawal(userId: string, to: string, amount: bigint): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { email: true } });
  if (!user?.email) return;
  await sendUserEmail(
    user.email,
    `You sent ${formatUsd(amount)} USDC from Attnn.`,
    [
      `${formatUsd(amount)} USDC is on its way from your Attnn. wallet to ${short(to)} (${to}).`,
      "",
      "If this wasn't you, sign out of Attnn. on every device and contact us straight away.",
    ].join("\n"),
  ).catch(() => false);
}
