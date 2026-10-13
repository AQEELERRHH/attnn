"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Helper text under a form field, with an optional "ⓘ" that opens a longer
 * plain-English explanation in place. Always visible (people forget between
 * visits) and tap-to-open rather than hover, so it works on phones and with a
 * keyboard. Pass `id` and point the field's aria-describedby at it.
 */
export function FieldHint({
  id,
  children,
  more,
  className,
}: {
  id?: string;
  /** The short line, always shown. */
  children: React.ReactNode;
  /** The longer explanation, shown when the ⓘ is pressed. */
  more?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const moreId = React.useId();
  return (
    <div className={cn("mt-1", className)}>
      <p id={id} className="text-xs text-text-secondary">
        {children}
        {more && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={moreId}
            className="focus-ring ml-1 inline-flex translate-y-[2px] items-center rounded text-arc-lavender hover:text-text-primary"
          >
            <Info aria-hidden className="h-3.5 w-3.5" />
            <span className="sr-only">{open ? "Hide explanation" : "What does this mean?"}</span>
          </button>
        )}
      </p>
      {more && open && (
        <p id={moreId} className="mt-1.5 rounded-lg border border-border bg-arc-bg-1 px-3 py-2 text-xs leading-relaxed text-text-primary">
          {more}
        </p>
      )}
    </div>
  );
}
