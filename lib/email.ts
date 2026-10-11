/**
 * Emails to users (security codes, notices) through Resend, the same service as the
 * sign-in links. Returns false when email isn't configured or Resend refuses, so
 * callers can fail closed (e.g. no code sent → no withdrawal to a new address).
 *
 * Never log the email body: it can contain a one-time code.
 */
export async function sendUserEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("sendUserEmail: RESEND_API_KEY is not set, so no email was sent");
    return false;
  }
  try {
    const { Resend } = await import("resend");
    const res = await new Resend(key).emails.send({ from: "Attnn. <hello@attnn.xyz>", to, subject, text });
    if (res.error) throw new Error(res.error.message);
    return true;
  } catch (err) {
    console.error("sendUserEmail: Resend refused the email", err instanceof Error ? err.message : err);
    return false;
  }
}
