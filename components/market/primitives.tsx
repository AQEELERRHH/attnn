import * as React from "react";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import type { StatusTone } from "@/lib/bid-display";

/* ─── Numbers ──────────────────────────────────────────────────────────────── */

/** Any number on a market screen: monospaced, tabular digits. */
export function Num({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("num", className)} {...props} />;
}

/** Atomic USDC rendered as "$35.00" ("—" when null). */
export function Money({
  atomic,
  tone = "default",
  className,
}: {
  atomic: string | bigint | null | undefined;
  tone?: "default" | "gold" | "success" | "muted";
  className?: string;
}) {
  const toneClass = {
    default: "text-text-primary",
    gold: "text-arc-gold",
    success: "text-green",
    muted: "text-text-secondary",
  }[tone];
  const text = formatMoney(atomic);
  // An empty value ("—") is never coloured like money.
  return <Num className={cn(text === "—" ? "text-text-secondary" : toneClass, className)}>{text}</Num>;
}

/** "+16.7%" coloured by direction; neutral for "—" or 0. */
export function Change({ value, className }: { value: string; className?: string }) {
  const up = value.startsWith("+");
  const down = value.startsWith("-");
  const tone = up ? "text-green" : down ? "text-arc-coral" : "text-text-secondary";
  return (
    <Num className={cn("inline-flex items-center gap-0.5 text-xs", tone, className)}>
      {(up || down) && (
        <svg aria-hidden viewBox="0 0 8 8" className={cn("h-2 w-2", down && "rotate-180")}>
          <path d="M4 1 7 6H1z" fill="currentColor" />
        </svg>
      )}
      {up || down ? value.slice(1) : value}
      <span className="sr-only">{up ? " up" : down ? " down" : ""}</span>
    </Num>
  );
}

/* ─── Panels ───────────────────────────────────────────────────────────────── */

export function Panel({
  title,
  description,
  actions,
  raised,
  padded = true,
  className,
  children,
  ...props
}: Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  raised?: boolean;
  padded?: boolean;
}) {
  return (
    <section className={cn(raised ? "panel-raised" : "panel", "overflow-hidden", className)} {...props}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-text-primary">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] leading-snug text-text-secondary">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={cn(padded && "px-5 pb-5", !title && !actions && padded && "pt-5")}>{children}</div>
    </section>
  );
}

/* ─── Stat strip ───────────────────────────────────────────────────────────── */

export interface StatItem {
  label: string;
  value: React.ReactNode;
  /** Small line under the value (context, change, source). */
  sub?: React.ReactNode;
  tone?: "default" | "gold" | "success" | "danger";
}

const STAT_TONE = { default: "text-text-primary", gold: "text-arc-gold", success: "text-green", danger: "text-arc-coral" };

/** A row of key numbers separated by hairlines (market totals, portfolio totals). */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
        "grid-cols-[repeat(auto-fit,minmax(170px,1fr))]",
        // Phones show two columns; let an odd last item span the row instead of leaving a gap.
        "max-sm:[&>*:last-child:nth-child(odd)]:col-span-full",
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className="relative bg-arc-bg-1 px-5 py-4">
          {it.tone === "gold" && <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-arc-gold/70 via-arc-gold/20 to-transparent" />}
          <dt className="eyebrow">{it.label}</dt>
          <dd className={cn("num mt-1.5 text-2xl font-medium leading-none tracking-[-0.02em]", STAT_TONE[it.tone ?? "default"])}>{it.value}</dd>
          {it.sub && <dd className="mt-1.5 text-xs text-text-secondary">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Inline label/value pairs for a market header ("Floor $20.00 · Top bid $35.00 …"). */
export function StatInline({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-x-6 gap-y-4", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="eyebrow truncate">{it.label}</dt>
          <dd className={cn("num mt-1 flex flex-wrap items-baseline gap-x-1.5 text-lg font-medium leading-tight tracking-[-0.02em]", STAT_TONE[it.tone ?? "default"])}>
            {it.value} {it.sub}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── Status chip ──────────────────────────────────────────────────────────── */

const CHIP_TONE: Record<StatusTone, string> = {
  neutral: "text-arc-lavender bg-arc-lavender/[0.07] border-arc-lavender/25",
  pending: "text-arc-gold bg-arc-gold/[0.08] border-arc-gold/30",
  success: "text-green bg-green/[0.08] border-green/30",
  danger: "text-arc-coral bg-arc-coral/[0.08] border-arc-coral/35",
  muted: "text-text-secondary bg-arc-bg-2 border-border-bright",
};

export function StatusChip({
  tone,
  children,
  dot,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-xs font-medium leading-none",
        CHIP_TONE[tone],
        className,
      )}
    >
      {/* Pending and live states breathe; settled ones sit still. */}
      {dot && <span aria-hidden className={tone === "pending" || tone === "success" ? "live-dot" : "h-1.5 w-1.5 rounded-full bg-current"} />}
      {children}
    </span>
  );
}

/** Small topic tag ("web3", "ai"). */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded-md border border-border bg-arc-bg-2 px-2 text-xs leading-none text-text-secondary",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ─── Creator avatar ───────────────────────────────────────────────────────── */

/** A stable hue per handle, so initials avatars are told apart at a glance. */
function handleHue(handle: string): number {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Market photo, or the handle's initial when there isn't one. */
export function CreatorAvatar({
  handle,
  src,
  size = 34,
  className,
}: {
  handle: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  const radius = size >= 48 ? "rounded-xl" : "rounded-lg";
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded, arbitrary host
      <img src={src} alt="" style={style} className={cn(radius, "flex-none bg-arc-bg-3 object-cover ring-1 ring-inset ring-border-bright", className)} />
    );
  }
  const clean = handle.replace(/^@/, "");
  const hue = handleHue(clean);
  return (
    <span
      aria-hidden
      style={{
        ...style,
        fontSize: Math.round(size * 0.42),
        background: `linear-gradient(140deg, hsl(${hue} 38% 22%), hsl(${(hue + 40) % 360} 30% 13%))`,
        color: `hsl(${hue} 85% 80%)`,
      }}
      className={cn(radius, "flex flex-none items-center justify-center font-semibold ring-1 ring-inset ring-white/10", className)}
    >
      {clean.charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/* ─── Sparkline ────────────────────────────────────────────────────────────── */

/** Tiny trend line; orange if up, coral if down, grey if flat. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  /** Accessible description, e.g. "7 day cleared price from $20 to $35". */
  label: string;
}) {
  if (values.length === 0) return <span className="text-xs text-text-dim">No fills yet</span>;
  if (values.length === 1) return <span className="text-xs text-text-secondary">1 fill</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((v, i) => [(i / (values.length - 1)) * 100, 25 - ((v - min) / span) * 22] as const);
  const pts = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const color = last > first ? "var(--c-signal)" : last < first ? "var(--c-down)" : "var(--c-cream-2)";
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label} style={{ width, height }} className="block overflow-visible">
      <polygon points={`0,28 ${pts} 100,28`} fill={color} fillOpacity={0.09} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
