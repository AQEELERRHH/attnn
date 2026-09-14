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
          <div className="w-12 h-12 rounded-xl overflow-hidden mx-auto mb-4">
            <img src="/attnn-logo.jpeg" alt="Attnn." className="w-full h-full object-cover" />
          </div>
          <h1 className="text-3xl font-display font-bold mb-2">Welcome to Attnn.</h1>
          <p className="text-sm text-text-secondary">Sign in</p>
        </div>
        <RegisterForm />
      </div>
    </div>
  );
}
