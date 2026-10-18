/**
 * Card / Apple Pay / Google Pay funding through Arc's Onramp Kit (@circle-fin/onramp-kit).
 *
 * The server mints a short-lived session; the browser opens Circle's hosted widget with it
 * (a popup on production; embedding needs the domain registered with Circle). The widget,
 * not Attnn., handles payment and identity checks, and sends USDC on Arc straight to the
 * wallet sealed into the session.
 *
 * Safety rules:
 *  - The destination is ALWAYS the signed-in user's own main wallet, looked up on the server.
 *    Nothing the browser sends can change it (Circle's drop-in route handler would take it
 *    from the request body, which is why we don't use it).
 *  - The environment follows ARC_NETWORK: testnet → Circle's sandbox, mainnet → production.
 *    A sandbox key can't reach production or the reverse, and the widget origin always
 *    matches the API the session was minted on.
 *  - No key (ONRAMP_API_KEY unset) → the feature is off and the button isn't shown.
 *  - Nothing here touches the database or moves money from a wallet: the deposit lands
 *    on-chain and the balance shown on the dashboard is read from Arc, as before.
 */
import { createOnrampServerKit, type OnrampSession, type OnrampSessionRequest } from "@circle-fin/onramp-kit/server";
import { arc, type ArcNetwork } from "@/lib/chain";

export interface OnrampEnvironment {
  name: "sandbox" | "production";
  apiBaseUrl: string;
  widgetBaseUrl: string;
  /** Circle's chain name for the destination wallet (wallets-api `destinationChain`). */
  destinationChain: string;
}

/** Circle's endpoints for each Arc network (from Circle's onramp-kit demo and the kit's defaults). */
export function onrampEnvironment(network: ArcNetwork = arc.network): OnrampEnvironment {
  return network === "mainnet"
    ? { name: "production", apiBaseUrl: "https://api.circle.com", widgetBaseUrl: "https://onramp.arc.io", destinationChain: "Arc" }
    : { name: "sandbox", apiBaseUrl: "https://api-test.circle.com", widgetBaseUrl: "https://onramp-sandbox.arc.io", destinationChain: "Arc_Testnet" };
}

/** True when a Kit key is configured, so the "Buy USDC" option should be offered. */
export function onrampEnabled(): boolean {
  return !!process.env.ONRAMP_API_KEY?.trim();
}

/**
 * The session request for a user's main wallet. Pure, so the "always the user's own wallet,
 * USDC on Arc only" rule is unit-tested without the network.
 */
export function onrampSessionRequest(userId: string, walletAddress: string, network: ArcNetwork = arc.network): OnrampSessionRequest {
  return {
    appUserId: userId,
    destinationAddress: walletAddress,
    destinationChain: onrampEnvironment(network).destinationChain,
    // Display scoping: only USDC on Arc is offered (the wallet lives on Arc).
    assets: { pairs: [{ token: "USDC", chain: "arc" }] },
    metadata: { app: "attnn", wallet: "main" },
  };
}

/** Mints a session that pays USDC on Arc into `walletAddress`. Throws when not configured. */
export async function createOnrampSession(userId: string, walletAddress: string): Promise<OnrampSession> {
  const apiKey = process.env.ONRAMP_API_KEY?.trim();
  if (!apiKey) throw new Error("ONRAMP_API_KEY is not set");
  const env = onrampEnvironment();
  // Created per call (like the Circle wallets SDK client in lib/circle.ts): no module state
  // to go stale on a warm serverless function.
  const kit = createOnrampServerKit({ apiKey, baseUrl: env.apiBaseUrl, widgetBaseUrl: env.widgetBaseUrl });
  return kit.createSession(onrampSessionRequest(userId, walletAddress));
}
