import { SiteHeader } from "@/components/market/site-header";
import { arc } from "@/lib/chain";
import { loadMarkets } from "./load";
import { MarketsView } from "./markets-view";

export const revalidate = 60;
export const metadata = {
  title: "Attention markets · Attnn.",
  description: "Every creator is a market. Bids are escrowed USDC on Arc, paid out on reply, refunded after 3 days without one.",
};

export default async function CreatorsPage() {
  const now = Date.now();
  const { rows, ticker, totals } = await loadMarkets(now);
  return (
    <div className="min-h-screen bg-arc-bg-0">
      <SiteHeader networkLabel={arc.chain.name} />
      <MarketsView rows={rows} ticker={ticker} now={now} totals={totals} />
    </div>
  );
}
