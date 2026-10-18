"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CreditCard, ExternalLink } from "lucide-react";
import { createOnrampKit, parseOnrampSession, type OnrampWidget } from "@circle-fin/onramp-kit";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";

type OnrampSession = ReturnType<typeof parseOnrampSession>;

/** Why a deposit didn't complete → what the user should read (codes from the kit's ONRAMP_EVENT_CODES). */
const NOT_COMPLETED: Record<string, { title: string; description: string } | null> = {
  CANCELED_BY_CUSTOMER: null, // they closed it on purpose: nothing to say
  SESSION_TIMEOUT: { title: "Checkout timed out", description: "Nothing was charged. Start again when you're ready." },
  NO_PAYMENT_OPTIONS: {
    title: "Card purchase isn't available for you yet",
    description: "There's no payment option for your country or card right now. You can still send USDC on Arc to your wallet address.",
  },
  CUSTOMER_PENDING_REVIEW: { title: "Your identity check is under review", description: "Try again once it's approved." },
  CUSTOMER_REJECTED: { title: "The payment provider couldn't verify you", description: "Nothing was charged. You can still send USDC on Arc to your wallet address." },
  PAYMENT_PROVIDER_ERROR: { title: "The payment didn't go through", description: "Nothing was charged. Please try again later." },
};

/**
 * "Buy USDC with card": opens Circle's hosted Onramp checkout (card, Apple Pay, Google Pay).
 * USDC is delivered on Arc straight to this user's own wallet; our server sets the destination.
 *
 * Two clicks on purpose: browsers only allow a popup straight from a click, so the first
 * click prepares a checkout session and the second opens it. The production widget only runs
 * as a popup (embedding needs a domain registered with Circle).
 */
export function BuyUsdcButton({ widgetBaseUrl, className }: { widgetBaseUrl: string; className?: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<"idle" | "preparing" | "ready" | "open">("idle");
  const [session, setSession] = React.useState<OnrampSession | null>(null);
  const widgetRef = React.useRef<OnrampWidget | null>(null);
  const kitRef = React.useRef<ReturnType<typeof createOnrampKit> | null>(null);

  React.useEffect(() => () => widgetRef.current?.close(), []);

  const reset = () => {
    widgetRef.current?.close();
    widgetRef.current = null;
    setSession(null);
    setState("idle");
  };

  const prepare = async () => {
    setState("preparing");
    try {
      const res = await fetch("/api/onramp/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = (data as { error?: string } | null)?.error ?? "Couldn't start the card checkout. Please try again.";
        toast({ title: "Couldn't start checkout", description: message, variant: "destructive" });
        setState("idle");
        return;
      }
      setSession(parseOnrampSession(data));
      setState("ready");
    } catch {
      toast({ title: "Couldn't start checkout", description: "Check your connection and try again.", variant: "destructive" });
      setState("idle");
    }
  };

  // Must run synchronously inside the click, or the browser blocks the popup.
  const open = () => {
    if (!session) return;
    kitRef.current ??= createOnrampKit({ widgetBaseUrl });
    const result = kitRef.current.openWindow({
      session,
      onDepositSubmitted: () =>
        toast({ title: "Payment submitted", description: "Your USDC is on its way to your wallet on Arc. It can take a few minutes." }),
      onDepositSettled: () => {
        toast({ title: "USDC received", description: "Your wallet balance has been updated." });
        router.refresh();
      },
      onDepositNotCompleted: ({ code }) => {
        const msg = NOT_COMPLETED[code];
        if (msg) toast({ ...msg, variant: "destructive" });
      },
      onSessionExpired: reset,
    });
    if (result.status === "blocked") {
      toast({
        title: result.reason === "in_app_browser" ? "Open attnn.xyz in your browser" : "Allow pop-ups to continue",
        description:
          result.reason === "in_app_browser"
            ? "Card checkout can't open inside this app. Open attnn.xyz in Chrome or Safari and try again."
            : "Your browser blocked the checkout window. Allow pop-ups for attnn.xyz, then press the button again.",
        variant: "destructive",
      });
      return; // the session is still unused: they can press again
    }
    widgetRef.current = result.widget;
    // A session is single-use: the next purchase mints a fresh one.
    setSession(null);
    setState("open");
  };

  return (
    <div className={className}>
      {state === "ready" ? (
        <Button size="sm" onClick={open}>
          <ExternalLink aria-hidden className="mr-1.5 h-3 w-3" /> Open secure checkout
        </Button>
      ) : (
        <Button size="sm" variant={state === "open" ? "outline" : "default"} onClick={state === "open" ? reset : prepare} disabled={state === "preparing"}>
          <CreditCard aria-hidden className="mr-1.5 h-3 w-3" />
          {state === "preparing" ? "Preparing checkout…" : state === "open" ? "Buy more USDC" : "Buy USDC with card"}
        </Button>
      )}
      <p className="mt-1.5 text-xs text-text-secondary">
        Card, Apple Pay or Google Pay, through Circle&apos;s secure checkout. USDC goes straight to your wallet on Arc. Availability depends
        on your country.
      </p>
    </div>
  );
}
