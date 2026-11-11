/**
 * What the sign-in form should say after `signIn("resend", { redirect: false })`.
 * Client-safe and pure.
 *
 * In next-auth v5, `ok` only means the request reached the server: a failed send still
 * comes back with `ok: true` and the reason in `error` (e.g. "Configuration"). Auth.js
 * doesn't pass on why, so the message covers the likely causes, the commonest being the
 * one-link-a-minute cooldown.
 */
export type EmailSignInOutcome =
  | { sent: true }
  | { sent: false; title: string; description: string };

export function emailSignInOutcome(res: { ok?: boolean; error?: string | null } | undefined | null): EmailSignInOutcome {
  if (res && res.ok && !res.error) return { sent: true };
  return {
    sent: false,
    title: "We couldn't send your sign-in link",
    description:
      "If you asked for one less than a minute ago, wait a minute and try again. Otherwise check the address and try again, or continue with Google.",
  };
}
