import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db/client";
import { accounts, sessions, users, verificationTokens } from "./db/schema";
import { LIMITS, hit } from "./rate-limit";
import { SIGN_IN_FROM, sendSignInEmail } from "./signin-email";

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
        // Throws when Resend refuses the email, so Auth.js reports the failure instead of
        // "check your email" (see lib/signin-email.ts).
        await sendSignInEmail(new ResendClient(provider.apiKey), { to: email, url, from: provider.from ?? SIGN_IN_FROM });
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
