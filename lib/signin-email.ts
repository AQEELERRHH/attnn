/**
 * Sends the email sign-in link through Resend, and fails when Resend doesn't accept it.
 *
 * Resend's SDK reports most failures (bad key, unverified domain, quota, bad address)
 * by returning `{ error }` instead of throwing. Auth.js only knows a send failed if
 * this throws, so a returned error must become a thrown one; otherwise the site tells
 * the person to check an inbox that will never get the link.
 *
 * The link is a one-time key to the account: it never goes into an error message or a
 * log line. Neither does the address.
 */

/** The one Resend call this needs, so tests can pass a fake client. */
export interface SignInMailer {
  emails: {
    send(message: { from: string; to: string; subject: string; html: string; text: string }): Promise<{
      data?: unknown;
      error?: { name?: string; message?: string } | null;
    }>;
  };
}

/** Thrown when the link wasn't sent. The message is safe to log: no link, no address. */
export class SignInEmailError extends Error {
  constructor(reason: string) {
    super(`Couldn't send the sign-in email: ${reason}`);
    this.name = "SignInEmailError";
  }
}

export const SIGN_IN_FROM = "Attnn. <hello@attnn.xyz>";

/** Resend's own reason, with anything that looks like a URL or an address removed. */
function safeReason(error: { name?: string; message?: string } | null | undefined): string {
  const raw = [error?.name, error?.message].filter(Boolean).join(": ") || "Resend refused it";
  return raw
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[address]")
    .slice(0, 200);
}

export async function sendSignInEmail(
  mailer: SignInMailer,
  { to, url, from = SIGN_IN_FROM }: { to: string; url: string; from?: string },
): Promise<void> {
  let result: Awaited<ReturnType<SignInMailer["emails"]["send"]>>;
  try {
    result = await mailer.emails.send({
      from,
      to,
      subject: "Your Attnn. sign in link",
      html: signInHtml(url),
      text: `Sign in to Attnn.\n\nOpen this link to sign in. It expires in 1 hour and can be used once:\n${url}\n\nIf you didn't request this email you can safely ignore it.`,
    });
  } catch (err) {
    // Network failure or an SDK that throws: same outcome, and the same care with the link.
    throw new SignInEmailError(safeReason(err instanceof Error ? err : { message: String(err) }));
  }
  if (result?.error) throw new SignInEmailError(safeReason(result.error));
}

function signInHtml(url: string): string {
  return `
            <div style="background:#0D0D1A;padding:40px;font-family:sans-serif;max-width:480px;margin:auto;border-radius:12px;">
              <img src="https://attnn.xyz/attnn-logo.jpeg" alt="Attnn." style="width:48px;height:48px;border-radius:8px;margin-bottom:20px;" />
              <h1 style="color:#F0EFF8;font-size:24px;margin-bottom:8px;">Sign in to Attnn.</h1>
              <p style="color:#8888AA;font-size:14px;margin-bottom:24px;">Click the button below to sign in. This link expires in 1 hour and can be used once.</p>
              <a href="${url}" style="background:#D4A837;color:#0D0D1A;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;display:inline-block;">Sign in to Attnn.</a>
              <p style="color:#555570;font-size:12px;margin-top:24px;">If you didn't request this email you can safely ignore it.</p>
              <p style="color:#555570;font-size:12px;">Built on Arc Network™</p>
            </div>
          `;
}
