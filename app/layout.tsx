import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Attnn. — Agentic Attention Marketplace",
  description: "Turn human attention into a programmable economic primitive. AI agents discover, evaluate, and pay creators autonomously using USDC on Arc.",
  openGraph: {
    title: "Attnn. — Agentic Attention Marketplace",
    description: "Turn human attention into a programmable economic primitive.",
    siteName: "Attnn.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Attnn. — Agentic Attention Marketplace",
    description: "Turn human attention into a programmable economic primitive.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen bg-arc-bg-0 text-text-primary font-body antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
