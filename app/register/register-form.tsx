"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chrome } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function RegisterForm() {
  const [isLoading, setIsLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      toast({ title: "Error", description: "Google sign in failed", variant: "destructive" });
    }
    setIsLoading(false);
  };

  return (
    <Card className="p-8">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogleSignIn}
        disabled={isLoading}
      >
        <Chrome className="w-4 h-4 mr-2" />
        {isLoading ? "Signing in..." : "Continue with Google"}
      </Button>
    </Card>
  );
}
