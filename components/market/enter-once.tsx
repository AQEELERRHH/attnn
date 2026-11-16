"use client";
import { useEffect } from "react";

/**
 * The page-load entrance (.enter) plays once. After it has run, this marks the
 * document so a later in-app visit (Back to the homepage) shows the page
 * straight away instead of replaying it from empty. A full reload plays it again.
 */
export function EnterOnce({ afterMs = 1500 }: { afterMs?: number }) {
  useEffect(() => {
    const t = window.setTimeout(() => document.documentElement.classList.add("entered"), afterMs);
    return () => window.clearTimeout(t);
  }, [afterMs]);
  return null;
}
