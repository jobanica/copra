"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, Field, Input, FormError } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.replace("/dashboard");
        router.refresh();
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) throw error;
        if (data.session) {
          router.replace("/dashboard");
          router.refresh();
        } else {
          setNotice("Account created. Please check your email to confirm, then sign in.");
          setMode("signin");
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <h1 className="text-3xl font-bold text-brand-700">CopraBooks</h1>
        <p className="mt-1 text-sm text-gray-500">
          Copra buying &amp; accounting
        </p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <Field label="Full name">
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          </Field>

          <FormError message={error} />
          {notice && (
            <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-700">
              {notice}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading
              ? "Please wait…"
              : mode === "signin"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === "signin" ? (
            <button
              className="font-medium text-brand-700"
              onClick={() => {
                setMode("signup");
                setError(null);
              }}
            >
              First time here? Create an account
            </button>
          ) : (
            <button
              className="font-medium text-brand-700"
              onClick={() => {
                setMode("signin");
                setError(null);
              }}
            >
              Already have an account? Sign in
            </button>
          )}
        </div>
      </Card>
      <p className="mt-6 text-center text-xs text-gray-400">
        The first account becomes the Owner. Add the cashier afterwards from
        Settings.
      </p>
    </main>
  );
}
