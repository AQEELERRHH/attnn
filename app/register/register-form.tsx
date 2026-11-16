"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { emailSignInOutcome } from "@/lib/signin-result";
import { AttentionMascot, MascotBubble, type GazePoint, type MascotMood } from "@/components/market/attention-mascot";

/** Where to land after sign-in: a same-site path from ?callbackUrl=, else the dashboard. */
function safeCallbackUrl(): string {
  if (typeof window === "undefined") return "/dashboard";
  const cb = new URLSearchParams(window.location.search).get("callbackUrl");
  // Only same-site paths ("/c/alice"), never "//evil.com" or "https://…".
  return cb && cb.startsWith("/") && !cb.startsWith("//") && !cb.startsWith("/\\") ? cb : "/dashboard";
}

/** "@alice" when the visitor came here from a creator's market page, else null. */
function creatorFromCallback(): string | null {
  const m = /^\/c\/([A-Za-z0-9_.-]{1,32})\/?$/.exec(safeCallbackUrl());
  return m ? `@${m[1]}` : null;
}

/** Loose check for the mascot's "that looks right": the server still decides. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Phase = "idle" | "google" | "sending" | "sent" | "error";

const center = (el: Element | null): GazePoint => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

export default function RegisterForm() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [email, setEmail] = useState("");
  const [emailFocused, setEmailFocused] = useState(false);
  const [googleHover, setGoogleHover] = useState(false);
  const [creator, setCreator] = useState<string | null>(null);

  const googleRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const sentRef = useRef<HTMLDivElement>(null);
  const measure = useRef<CanvasRenderingContext2D | null>(null);

  // Read ?callbackUrl= after mount (the server can't see it), to greet by creator.
  useEffect(() => setCreator(creatorFromCallback()), []);

  const emailValid = LOOKS_LIKE_EMAIL.test(email.trim());

  /** The point just after the last typed character, so the eye follows the typing. */
  const caretPoint = useCallback((): GazePoint => {
    const input = emailRef.current;
    if (!input) return null;
    const r = input.getBoundingClientRect();
    const cs = getComputedStyle(input);
    measure.current ??= document.createElement("canvas").getContext("2d");
    const ctx = measure.current;
    let width = 0;
    if (ctx) {
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      width = ctx.measureText(input.value).width;
    }
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    return { x: r.left + padLeft + Math.min(width, r.width - padLeft - 12), y: r.top + r.height / 2 };
  }, []);

  const gaze = useCallback((): GazePoint => {
    if (phase === "sent") return center(sentRef.current);
    if (phase === "sending") return center(submitRef.current);
    if (phase === "google" || (googleHover && phase !== "error")) return center(googleRef.current);
    if (emailFocused) return caretPoint();
    return null;
  }, [phase, googleHover, emailFocused, caretPoint]);

  const mood: MascotMood =
    phase === "sending" || phase === "google" ? "busy" : phase === "sent" ? "done" : phase === "error" ? "error" : emailValid ? "happy" : "idle";

  const intro = creator ? `Sign in to bid on ${creator}.` : "Hi! What's your email?";
  const message =
    phase === "google"
      ? "Off to Google…"
      : phase === "sending"
        ? "Sending your sign-in link…"
        : phase === "sent"
          ? "Check your inbox."
          : phase === "error"
            ? "That didn't go through. Try again?"
            : googleHover && !email
              ? "Google works too."
              : emailValid
                ? "That looks right."
                : email && !emailFocused
                  ? "That doesn't look like an email yet."
                  : intro;

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setPhase("sending");
    try {
      const res = await signIn("resend", { email, redirect: false, callbackUrl: safeCallbackUrl() });
      const outcome = emailSignInOutcome(res);
      if (outcome.sent) {
        setPhase("sent");
      } else {
        setPhase("error");
        toast({ title: outcome.title, description: outcome.description, variant: "destructive" });
      }
    } catch {
      setPhase("error");
      toast({ title: "Something went wrong", variant: "destructive" });
    }
  };

  const handleGoogleSignIn = async () => {
    setPhase("google");
    try {
      await signIn("google", { callbackUrl: safeCallbackUrl() });
    } catch {
      setPhase("error");
      toast({ title: "Error", description: "Google sign in failed", variant: "destructive" });
    }
  };

  const busy = phase === "google" || phase === "sending";

  return (
    <Card className="space-y-4 p-5 shadow-raised sm:p-6">
      {/* Google Sign In */}
      <Button
        ref={googleRef}
        type="button"
        variant="outline"
        className="h-11 w-full bg-text-primary text-arc-bg-0 hover:bg-text-primary/90 hover:text-arc-bg-0"
        onClick={handleGoogleSignIn}
        onPointerEnter={() => setGoogleHover(true)}
        onPointerLeave={() => setGoogleHover(false)}
        onFocus={() => setGoogleHover(true)}
        onBlur={() => setGoogleHover(false)}
        disabled={busy}
      >
        {phase !== "google" && (
          <svg className="w-4 h-4" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        {phase === "google" ? "Signing in..." : "Continue with Google"}
      </Button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="eyebrow">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* The mark, watching and talking */}
      <div className="flex items-center gap-3.5 pt-1">
        <AttentionMascot
          size={44}
          mood={mood}
          gaze={gaze}
          aimKey={`${phase}|${emailFocused}|${googleHover}|${email}`}
        />
        <MascotBubble>{message}</MascotBubble>
      </div>

      {/* Email Magic Link */}
      {phase === "sent" ? (
        <div ref={sentRef} className="rounded-lg border border-green/30 bg-green/[0.06] py-5 text-center">
          <Mail aria-hidden className="mx-auto mb-2 h-7 w-7 text-green" />
          <p className="text-sm font-medium">We sent a sign-in link</p>
          <p className="mt-1 text-xs text-text-secondary">
            to <strong className="text-text-primary">{email}</strong>. It works for an hour.
          </p>
          <button
            type="button"
            onClick={() => setPhase("idle")}
            className="mt-3 text-xs text-arc-lavender underline-offset-4 hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : (
        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <div className="relative">
            <label htmlFor="signin-email" className="sr-only">Email address</label>
            <Mail aria-hidden className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" />
            <Input
              ref={emailRef}
              id="signin-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (phase === "error") setPhase("idle");
              }}
              onFocus={() => setEmailFocused(true)}
              onBlur={() => setEmailFocused(false)}
              className="h-11 pl-9"
              required
            />
          </div>
          <Button ref={submitRef} type="submit" variant="outline" className="h-11 w-full" disabled={busy}>
            {phase === "sending" ? "Sending..." : "Continue with Email"}
          </Button>
        </form>
      )}
    </Card>
  );
}
