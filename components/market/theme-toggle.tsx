"use client";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

/** localStorage key; read before first paint by the script in app/layout.tsx. */
export const THEME_KEY = "attnn-theme";

/**
 * Light / dark switch for the whole site. The theme is `data-theme="light"` on
 * <html> (dark is the default, no attribute); every colour is a token in
 * app/globals.css, so flipping it re-themes every page. Both icons are rendered
 * and CSS shows the one for the theme you'd switch to, so the server and the
 * browser always agree on the markup.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.dataset.theme === "light" ? "dark" : "light";
    // Fade every surface to its new colour for a moment instead of flashing.
    root.classList.add("theme-switching");
    if (next === "light") root.dataset.theme = "light";
    else delete root.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode or storage blocked: the switch still applies for this visit.
    }
    window.setTimeout(() => root.classList.remove("theme-switching"), 320);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch between light and dark theme"
      title="Switch theme"
      className={cn(
        "focus-ring inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-border-bright bg-arc-bg-1 text-text-secondary hover:bg-arc-bg-2 hover:text-text-primary active:scale-[0.94] active:duration-75",
        className,
      )}
    >
      <Sun aria-hidden className="theme-when-dark h-4 w-4" />
      <Moon aria-hidden className="theme-when-light h-4 w-4" />
    </button>
  );
}
