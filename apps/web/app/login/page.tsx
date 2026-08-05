"use client";

import { authClient } from "@iris/auth/client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button, ButtonSecondary, Card, ErrorBox, Input, Label } from "../../components/ui";

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: authError } = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: `${window.location.origin}${redirectTo}`,
      });

      if (authError) {
        setError(authError.message ?? "Failed to send the login link.");
        return;
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send the login link.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          We sent a login link to <span className="font-medium">{email.trim()}</span>.
          Check your inbox — if it isn&apos;t there in a minute, check your spam
          or junk folder.
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={() => setSent(false)} className="w-full">
            Resend link
          </Button>
          <ButtonSecondary onClick={() => setSent(false)} className="w-full">
            Use a different email
          </ButtonSecondary>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {error ? <ErrorBox message={error} /> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Sending…" : "Send login link"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">Iris</h1>
        <p className="mb-6 text-sm text-slate-500">
          Price tracking &amp; alerts. Enter your email and we&apos;ll send you
          a sign-in link.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}
