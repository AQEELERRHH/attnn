import { NextResponse } from "next/server";
import { desc, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { x402Payments } from "@/lib/db/schema";
import { arc } from "@/lib/chain";

export const dynamic = "force-dynamic";

/**
 * Public proof of x402 activity: how many paid profile unlocks have settled
 * through Circle Gateway, and the latest receipts. No personal data: payer is
 * the paying wallet address, which is already public on-chain.
 */
export async function GET() {
  const [totals] = await db
    .select({
      count: sql<number>`count(*)::int`,
      usdc: sql<string>`COALESCE(SUM(CAST(${x402Payments.amountUsdc} AS BIGINT)), 0)::text`,
      payers: sql<number>`count(DISTINCT ${x402Payments.payer})::int`,
    })
    .from(x402Payments);
  const latest = await db
    .select({
      resource: x402Payments.resource,
      payer: x402Payments.payer,
      amountUsdc: x402Payments.amountUsdc,
      network: x402Payments.network,
      transaction: x402Payments.transaction,
      at: x402Payments.createdAt,
    })
    .from(x402Payments)
    .orderBy(desc(x402Payments.createdAt))
    .limit(20);

  return NextResponse.json(
    {
      network: arc.caip2,
      settlement: "Circle Gateway (x402 v2, GatewayWalletBatched)",
      totals: { payments: totals?.count ?? 0, amountUsdc: totals?.usdc ?? "0", uniquePayers: totals?.payers ?? 0 },
      latest,
    },
    { headers: { "Cache-Control": "public, max-age=30" } },
  );
}
