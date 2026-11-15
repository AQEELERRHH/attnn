import type { Config } from "tailwindcss";

/**
 * Colours are CSS variables (app/globals.css) holding space-separated RGB channels,
 * so opacity modifiers keep working: `bg-arc-gold/10`, `border-arc-coral/40`.
 *
 * The token names are kept from the original theme so every screen picks up the
 * new palette without renaming classes. Their roles (see CLAUDE.md, "Market design
 * system") are what matter, not the old names:
 *   arc-gold     → signal orange: money, open bids, the primary action
 *   green        → settled, up
 *   arc-coral    → refund countdowns, warnings, down
 *   arc-lavender → links, info notes, focus ring
 *   arc-purple   → decorative hairlines only
 */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        arc: {
          "bg-0": rgb("ink-0"),
          "bg-1": rgb("ink-1"),
          "bg-2": rgb("ink-2"),
          "bg-3": rgb("ink-3"),
          gold: rgb("signal"),
          coral: rgb("down"),
          purple: rgb("deco"),
          lavender: rgb("info"),
        },
        text: {
          primary: rgb("cream"),
          secondary: rgb("cream-2"),
          dim: rgb("cream-3"),
        },
        green: {
          DEFAULT: rgb("up"),
        },
        border: {
          DEFAULT: "rgb(var(--cream) / 0.07)",
          bright: "rgb(var(--cream) / 0.13)",
        },
      },
      fontFamily: {
        display: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        body: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        // A hairline top highlight plus a soft drop: raised surfaces on ink.
        raised: "inset 0 1px 0 0 rgb(var(--cream) / 0.04), 0 1px 2px 0 rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.6)",
        pop: "inset 0 1px 0 0 rgb(var(--cream) / 0.05), 0 16px 48px -12px rgb(0 0 0 / 0.75)",
        signal: "0 0 0 1px rgb(var(--signal) / 0.5), 0 8px 24px -10px rgb(var(--signal) / 0.45)",
      },
      animation: {
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
        ping: "ping 1.6s cubic-bezier(0, 0, 0.2, 1) infinite",
        marquee: "marquee var(--marquee-duration, 60s) linear infinite",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(6px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
