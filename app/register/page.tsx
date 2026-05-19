import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import RegisterForm from "./register-form";

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-arc-gold to-arc-purple flex items-center justify-center mx-auto mb-4">
            <span className="font-display font-bold text-xl">A</span>
          </div>
          <h1 className="text-3xl font-display font-bold mb-2">Welcome to Attnn.</h1>
          <p className="text-sm text-text-secondary">Sign in</p>
        </div>
        <RegisterForm />
      </div>
    </div>
  );
}
