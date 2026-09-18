"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Mail } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function RegisterForm() {
  const [isLoading, setIsLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setEmailLoading(true);
    try {
      const res = await signIn("resend", { email, redirect: false, callbackUrl: "/dashboard" });
      if (res?.ok) {
        setEmailSent(true);
        toast({ title: "Magic link sent!", description: "Check your email for the sign in link.", variant: "success" });
      } else {
        toast({ title: "Failed to send magic link", variant: "destructive" });
      }
    } catch {
      toast({ title: "Something went wrong", variant: "destructive" });
    }
    setEmailLoading(false);
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch {
      toast({ title: "Error", description: "Google sign in failed", variant: "destructive" });
    }
    setIsLoading(false);
  };

  return (
    <Card className="p-8 space-y-4">
      {/* Google Sign In */}
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        {!isLoading && (
          <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        {isLoading ? "Signing in..." : "Continue with Google"}
      </Button>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-text-dim">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* Email Magic Link */}
      {emailSent ? (
        <div className="text-center py-4">
          <Mail className="w-8 h-8 text-arc-gold mx-auto mb-2" />
          <p className="text-sm font-medium">Check your email</p>
          <p className="text-xs text-text-secondary mt-1">We sent a magic link to <strong>{email}</strong></p>
        </div>
      ) : (
        <form onSubmit={handleEmailSignIn} className="space-y-3">
          <div className="relative">
            <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-dim" />
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="pl-9"
              required
            />
          </div>
          <Button type="submit" variant="outline" className="w-full" disabled={emailLoading}>
            {emailLoading ? "Sending..." : "Continue with Email"}
          </Button>
        </form>
      )}
    </Card>
  );
}
