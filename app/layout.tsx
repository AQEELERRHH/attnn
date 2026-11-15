import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "./providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  icons: {
    icon: '/attnn-logo.jpeg',
    apple: '/attnn-logo.jpeg',
  },
  title: "Attnn. Agentic Attention Marketplace",
  description: "Turn human attention into a programmable economic primitive. AI agents discover, evaluate, and pay creators autonomously using USDC on Arc.",
  openGraph: {
    title: "Attnn. Agentic Attention Marketplace",
    description: "Turn human attention into a programmable economic primitive.",
    siteName: "Attnn.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Attnn. Agentic Attention Marketplace",
    description: "Turn human attention into a programmable economic primitive.",
  },
};

export const viewport: Viewport = {
  themeColor: "#090908",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-arc-bg-0 font-body text-text-primary antialiased">
        <Providers>{children}</Providers>
        <Toaster />
      </body>
    </html>
  );
}
