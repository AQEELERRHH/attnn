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
  const tone = value.startsWith("+") ? "text-green" : value.startsWith("-") ? "text-arc-coral" : "text-text-secondary";
  return <Num className={cn("text-xs", tone, className)}>{value}</Num>;
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
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {title && <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>}
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

/** A row of key numbers separated by hairlines (market totals, portfolio totals). */
export function StatStrip({ items, className }: { items: StatItem[]; className?: string }) {
  const tone = { default: "text-text-primary", gold: "text-arc-gold", success: "text-green", danger: "text-arc-coral" };
  return (
    <dl
      className={cn(
        "grid gap-px overflow-hidden rounded-xl border border-border bg-border",
        "grid-cols-[repeat(auto-fit,minmax(170px,1fr))]",
        className,
      )}
    >
      {items.map((it) => (
        <div key={it.label} className="bg-arc-bg-1 px-5 py-4">
          <dt className="eyebrow">{it.label}</dt>
          <dd className={cn("num mt-1 text-[22px] font-medium leading-tight", tone[it.tone ?? "default"])}>{it.value}</dd>
          {it.sub && <dd className="mt-0.5 text-xs text-text-secondary">{it.sub}</dd>}
        </div>
      ))}
    </dl>
  );
}

/** Inline label/value pairs for a market header ("Floor $20.00 · Top bid $35.00 …"). */
export function StatInline({ items, className }: { items: StatItem[]; className?: string }) {
  const tone = { default: "text-text-primary", gold: "text-arc-gold", success: "text-green", danger: "text-arc-coral" };
  return (
    <dl className={cn("grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-x-6 gap-y-4", className)}>
      {items.map((it) => (
        <div key={it.label}>
          <dt className="eyebrow">{it.label}</dt>
          <dd className={cn("num mt-0.5 text-xl font-medium", tone[it.tone ?? "default"])}>
            {it.value} {it.sub}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── Status chip ──────────────────────────────────────────────────────────── */

const CHIP_TONE: Record<StatusTone, string> = {
  neutral: "text-arc-lavender bg-arc-lavender/[0.08] border-arc-lavender/20",
  pending: "text-arc-gold bg-arc-gold/[0.08] border-arc-gold/35",
  success: "text-green bg-green/[0.08] border-green/35",
  danger: "text-arc-coral bg-arc-coral/[0.08] border-arc-coral/40",
  muted: "text-text-secondary bg-transparent border-border-bright",
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
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium",
        CHIP_TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/** Small lavender tag ("web3", "ai"). */
export function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-block rounded-md bg-arc-bg-2 px-2 py-0.5 text-xs text-arc-lavender", className)}>
      {children}
    </span>
  );
}

/* ─── Creator avatar ───────────────────────────────────────────────────────── */

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
      <img src={src} alt="" style={style} className={cn(radius, "flex-none border border-border-bright object-cover", className)} />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, fontSize: Math.round(size * 0.4) }}
      className={cn(
        radius,
        "flex flex-none items-center justify-center border border-border-bright bg-arc-bg-3 font-display font-extrabold text-arc-lavender",
        className,
      )}
    >
      {handle.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/* ─── Sparkline ────────────────────────────────────────────────────────────── */

/** Tiny trend line; gold if up, coral if down, lavender if flat. */
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
  if (values.length < 2) return <span className="text-xs text-text-secondary">No fills yet</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(26 - ((v - min) / span) * 24).toFixed(1)}`)
    .join(" ");
  const first = values[0]!;
  const last = values[values.length - 1]!;
  const color = last > first ? "#F5A623" : last < first ? "#E8635A" : "#C8B8E8";
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label={label} style={{ width, height }} className="block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
