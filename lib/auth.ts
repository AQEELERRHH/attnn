import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "./db/client";
import { accounts, sessions, users, verificationTokens } from "./db/schema";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
  usersTable: users as any,
    accountsTable: accounts as any,
    sessionsTable: sessions as any,
    verificationTokensTable: verificationTokens as any,
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
      sendVerificationRequest: async ({ identifier: email, url, provider }) => {
        const { Resend: ResendClient } = await import("resend");
        const resend = new ResendClient(provider.apiKey);
        await resend.emails.send({
          from: provider.from,
          to: email,
          subject: "Your Attnn. sign in link",
          html: `
            <div style="background:#0D0D1A;padding:40px;font-family:sans-serif;max-width:480px;margin:auto;border-radius:12px;">
              <img src="https://attnn.xyz/attnn-logo.jpeg" alt="Attnn." style="width:48px;height:48px;border-radius:8px;margin-bottom:20px;" />
              <h1 style="color:#F0EFF8;font-size:24px;margin-bottom:8px;">Sign in to Attnn.</h1>
              <p style="color:#8888AA;font-size:14px;margin-bottom:24px;">Click the button below to sign in. This link expires in 24 hours.</p>
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
        session.user.role = (user as any).role ?? "bidder";
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
