"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";

export interface MarketColumn<Row> {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Return a number to make the column sortable. null/undefined always sorts last. */
  sortValue?: (row: Row) => number | null | undefined;
  render: (row: Row, index: number) => React.ReactNode;
  className?: string;
  /** Visually hidden header (e.g. the action column). */
  hiddenLabel?: boolean;
}

/**
 * Sortable data table for markets, order books and positions. Sorting is client
 * side; pass already-filtered rows. Wide tables scroll inside their own box on
 * small screens instead of the page scrolling sideways.
 */
export function MarketTable<Row>({
  columns,
  rows,
  rowKey,
  defaultSort,
  empty,
  minWidth = 760,
  className,
  caption,
}: {
  columns: MarketColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  empty?: React.ReactNode;
  minWidth?: number;
  className?: string;
  /** Screen-reader caption. */
  caption?: string;
}) {
  const [sort, setSort] = React.useState(defaultSort ?? null);

  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" }));

  return (
    <div className={cn("relative overflow-x-auto", className)}>
      <table className="w-full border-collapse" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === "desc" ? "descending" : "ascending") : c.sortValue ? "none" : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    "eyebrow h-10 whitespace-nowrap border-b border-border px-3.5 first:pl-5 last:pr-5",
                    c.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {c.hiddenLabel ? (
                    <span className="sr-only">{c.label}</span>
                  ) : c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn(
                        "focus-ring inline-flex items-center gap-1 rounded uppercase tracking-[0.08em]",
                        active ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
                      )}
                    >
                      {c.label}
                      {active && (sort!.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={rowKey(row)} className="group">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap border-b border-border px-3.5 py-3 align-middle text-sm group-last:border-b-0 group-hover:bg-arc-bg-2 first:pl-5 last:pr-5",
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                >
                  {c.render(row, i)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 && <div className="px-5 py-10 text-center text-sm text-text-secondary">{empty ?? "Nothing here yet."}</div>}
    </div>
  );
}
