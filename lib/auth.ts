import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db/client";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { LIMITS, hit } from "./rate-limit";

/** The requester's IP as Vercel reports it, or null outside a request. */
async function requestIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  } catch {
    return null;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
  usersTable: users,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom accounts schema doesn't match the adapter's table shape; fixing needs a schema change
    accountsTable: accounts as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- custom sessions schema doesn't match the adapter's table shape; fixing needs a schema change
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  pages: {
    signIn: "/register",
    error: "/register",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    Resend({
      apiKey: process.env.RESEND_API_KEY!,
      from: "Attnn. <hello@attnn.xyz>",
      // A sign-in link opens a wallet: short-lived, not the 24-hour default.
      maxAge: 60 * 60,
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        // Stops anyone using the form to flood an inbox (or our Resend quota).
        const ip = await requestIp();
        if (ip && !(await hit(LIMITS.signInIp, ip))) throw new Error("Too many sign-in requests. Try again later.");
        if (!(await hit(LIMITS.signInEmail, email.trim().toLowerCase()))) {
          throw new Error("A sign-in link was just sent to this address. Check your inbox, or try again in a minute.");
        }
        const { Resend: ResendClient } = await import("resend");
        const resend = new ResendClient(provider.apiKey);
        await resend.emails.send({
          from: provider.from ?? "Attnn. <hello@attnn.xyz>",
          to: email,
          subject: "Your Attnn. sign in link",
          html: `
            <div style="background:#0D0D1A;padding:40px;font-family:sans-serif;max-width:480px;margin:auto;border-radius:12px;">
              <img src="https://attnn.xyz/attnn-logo.jpeg" alt="Attnn." style="width:48px;height:48px;border-radius:8px;margin-bottom:20px;" />
              <h1 style="color:#F0EFF8;font-size:24px;margin-bottom:8px;">Sign in to Attnn.</h1>
              <p style="color:#8888AA;font-size:14px;margin-bottom:24px;">Click the button below to sign in. This link expires in 1 hour and can be used once.</p>
              <a href="${url}" style="background:#D4A837;color:#0D0D1A;padding:12px 28px;border-radius:6px;font-weight:700;font-size:14px;text-decoration:none;display:inline-block;">Sign in to Attnn.</a>
              <p style="color:#555570;font-size:12px;margin-top:24px;">If you didn't request this email you can safely ignore it.</p>
              <p style="color:#555570;font-size:12px;">Built on Arc Network™</p>
            </div>
          `,
        });
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      if (session.user && user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: string }).role ?? "bidder";
      }
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      email: string;
      name?: string | null;
      image?: string | null;
    };
  }
}
