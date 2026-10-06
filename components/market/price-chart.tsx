import { formatUsd } from "@/lib/bid-rules";

/**
 * Cleared bid prices over time, with the creator's floor as a dashed line.
 * Server-safe SVG; points are spaced by time, not by index.
 */
export function PriceChart({
  points,
  floorUsdc,
  days = 30,
  now = Date.now(),
  height = 200,
}: {
  /** Cleared fills: ISO time + atomic amount. */
  points: { at: string; amountUsdc: string }[];
  floorUsdc: string;
  days?: number;
  now?: number;
  height?: number;
}) {
  const start = now - days * 86_400_000;
  const series = points
    .map((p) => ({ t: new Date(p.at).getTime(), v: Number(BigInt(p.amountUsdc) / BigInt(10_000)) / 100 }))
    .filter((p) => p.t >= start)
    .sort((a, b) => a.t - b.t);
  const floor = Number(BigInt(floorUsdc) / BigInt(10_000)) / 100;

  if (series.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-border-bright text-sm text-text-secondary" style={{ height }}>
        No cleared bids yet. The first reply sets this market&apos;s price.
      </div>
    );
  }

  // Round the axis to clean steps (1, 2, 2.5, 5 × 10ⁿ) so labels read $0, $20, $40, $60.
  const raw = Math.max(floor, ...series.map((p) => p.v)) * 1.1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw / 3)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw / 3) ?? 10 * pow;
  const max = Math.ceil(raw / step) * step;
  const y = (v: number) => 4 + (1 - v / max) * (height - 8);
  const x = (t: number) => ((t - start) / (now - start)) * 600;
  const line = series.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  // Step to "now" at the last price so the line reaches the right edge.
  const last = series[series.length - 1]!;
  line.push(`600,${y(last.v).toFixed(1)}`);
  const area = `${x(series[0]!.t).toFixed(1)},${height} ${line.join(" ")} 600,${height}`;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step).map((v) => ({
    v,
    label: formatUsd(BigInt(Math.round(v * 100)) * BigInt(10_000)),
  }));
  const fmtDate = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <figure className="m-0">
      <div className="relative pl-14">
        <div aria-hidden className="num absolute left-0 top-0 w-12 text-right text-[11px] text-text-secondary" style={{ height }}>
          {ticks.map((t) => (
            <span key={t.v} className="absolute right-0 -translate-y-1/2" style={{ top: y(t.v) }}>
              {t.label.replace(/\.00$/, "")}
            </span>
          ))}
        </div>
        <svg
          viewBox={`0 0 600 ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${series.length} cleared bids in the last ${days} days, latest ${formatUsd(BigInt(Math.round(last.v * 100)) * BigInt(10_000))}`}
          className="block w-full"
          style={{ height }}
        >
          {ticks.map((t) => (
            <line key={t.v} x1="0" x2="600" y1={y(t.v)} y2={y(t.v)} stroke="rgba(200,184,232,0.08)" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2="600" y1={y(floor)} y2={y(floor)} stroke="#8A7FAA" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          <polygon points={area} fill="rgba(245,166,35,0.07)" />
          <polyline points={line.join(" ")} fill="none" stroke="#F5A623" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <div aria-hidden className="num mt-2 flex justify-between text-[11px] text-text-secondary">
          <span>{fmtDate(start)}</span>
          <span>{fmtDate(start + (now - start) / 2)}</span>
          <span>Today</span>
        </div>
      </div>
      <figcaption className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
        <span aria-hidden className="inline-block w-5 border-t border-dashed border-text-secondary" /> Floor {formatUsd(BigInt(floorUsdc))}
      </figcaption>
    </figure>
  );
}
