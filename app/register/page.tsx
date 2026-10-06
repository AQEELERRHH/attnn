import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/market/site-header";
import { arc } from "@/lib/chain";
import RegisterForm from "./register-form";

export const metadata = { title: "Sign in · Attnn." };

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-arc-bg-0">
      {/* No "Get started" button here: this is where it leads. */}
      <SiteHeader networkLabel={arc.chain.name} actions={<></>} />
      <main className="mx-auto flex max-w-md flex-col px-4 py-12 sm:py-20">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Sign in to Attnn.</h1>
        <p className="mt-2 text-sm text-text-secondary">
          New here? Signing in creates your account and a Circle wallet on {arc.chain.name}. No seed phrase, no extension.
        </p>
        <div className="mt-6">
          <RegisterForm />
        </div>
        <p className="mt-4 text-xs text-text-secondary">One account works on both sides: bid on creators and run your own market.</p>
      </main>
    </div>
  );
}
