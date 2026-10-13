"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The 6-digit code we email to approve a money action (a new send address, or going
 * over the 24-hour allowance). Digits only; the browser can fill it from the email.
 */
export function SecurityCodeField({
  id,
  sentTo,
  value,
  onChange,
  reason,
  className,
}: {
  id: string;
  /** Masked email the code went to, e.g. "as…@gmail.com". */
  sentTo: string;
  value: string;
  onChange: (code: string) => void;
  /** One plain sentence on why a code is needed. */
  reason: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-xs text-arc-lavender">
        Code from your email
      </label>
      <input
        id={id}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        placeholder="123456"
        className={cn(
          "focus-ring num w-full rounded-lg border border-border-bright bg-arc-bg-0 px-3 py-2.5 text-sm tracking-widest text-text-primary placeholder:text-text-dim",
        )}
      />
      <p className="mt-1 text-xs text-text-secondary">
        {reason} We sent a 6-digit code to {sentTo}. It lasts 10 minutes.
      </p>
    </div>
  );
}

export const isSecurityCode = (code: string) => /^\d{6}$/.test(code.trim());
