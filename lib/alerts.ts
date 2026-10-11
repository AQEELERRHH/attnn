/**
 * Operator alerts. Emails ALERT_EMAIL (comma-separated) through Resend, which the
 * app already uses for sign-in links. Without ALERT_EMAIL or RESEND_API_KEY the alert
 * is only written to the server log, loudly, so it still shows up in Vercel's logs.
 *
 * Never put secrets or users' private data in an alert: ids, amounts and counts only.
 */
export async function sendAlert(subject: string, lines: string[]): Promise<"emailed" | "logged"> {
  const text = lines.join("\n");
  console.error(`[ALERT] ${subject}\n${text}`);
  const to = (process.env.ALERT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const key = process.env.RESEND_API_KEY;
  if (!to.length || !key) return "logged";
  try {
    const { Resend } = await import("resend");
    const res = await new Resend(key).emails.send({
      from: "Attnn. alerts <alerts@attnn.xyz>",
      to,
      subject: `[Attnn ${process.env.ARC_NETWORK === "mainnet" ? "MAINNET" : "testnet"}] ${subject}`,
      text,
    });
    if (res.error) throw new Error(res.error.message);
    return "emailed";
  } catch (err) {
    console.error("[ALERT] could not email the alert", err);
    return "logged";
  }
}
