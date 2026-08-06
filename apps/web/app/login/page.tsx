"use client";

import { authClient } from "@iris/auth/client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useI18n } from "../../lib/i18n";
import { Button, ButtonSecondary, Card, ErrorBox, Input, Label } from "../../components/ui";

function LoginForm() {
  const { t } = useI18n();
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
      setError(t("login.emailEmpty"));
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: authError } = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: `${window.location.origin}${redirectTo}`,
      });

      if (authError) {
        setError(authError.message ?? t("login.sendError"));
        return;
      }

      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("login.sendError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (sent) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
          {t("login.sent", { email: email.trim() })}
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" onClick={() => setSent(false)} className="w-full">
            {t("login.resend")}
          </Button>
          <ButtonSecondary onClick={() => setSent(false)} className="w-full">
            {t("login.differentEmail")}
          </ButtonSecondary>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label htmlFor="email">{t("login.emailLabel")}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("login.emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {error ? <ErrorBox message={error} /> : null}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? t("login.sending") : t("login.sendLink")}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const { t } = useI18n();
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold">{t("login.brand")}</h1>
        <p className="mb-6 text-sm text-slate-500 dark:text-slate-400">
          {t("login.tagline")}
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </Card>
    </main>
  );
}