import type { Config } from "tailwindcss";

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
          "bg-0": "#0F0D1A",
          "bg-1": "#16132A",
          "bg-2": "#1E1A35",
          "bg-3": "#251F40",
          gold: "#F5A623",
          coral: "#E8635A",
          purple: "#8B5FBF",
          lavender: "#C8B8E8",
        },
        text: {
          primary: "#EDE8F8",
          secondary: "#8A7FAA",
          dim: "#3A3460",
        },
        green: {
          DEFAULT: "#2ECC71",
        },
        border: {
          DEFAULT: "rgba(200,184,232,0.08)",
          bright: "rgba(200,184,232,0.15)",
        },
      },
      fontFamily: {
        display: ["Syne", "sans-serif"],
        body: ["Inter", "sans-serif"],
        mono: ["DM Mono", "monospace"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      animation: {
        "orbit-slow": "orbit 8s linear infinite",
        "orbit-medium": "orbit 6s linear infinite",
        "orbit-fast": "orbit 4s linear infinite",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "slide-up": "slide-up 0.3s ease-out",
        "fade-in": "fade-in 0.5s ease-out",
      },
      keyframes: {
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(120px) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(120px) rotate(-360deg)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
