"use client";

import { authClient } from "@iris/auth/client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { ProjectLinks } from "../../components/app-footer";
import { BrandMark } from "../../components/brand-mark";
import { LanguageToggle } from "../../components/language-toggle";
import { ThemeToggle } from "../../components/theme-toggle";
import {
  Button,
  ButtonSecondary,
  Card,
  ErrorBox,
  Input,
  Label,
} from "../../components/ui";
import { useI18n } from "../../lib/i18n";

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
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
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
    <main className="relative flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 dark:bg-slate-950 sm:p-8">
      <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-sm space-y-6">
        <Card className="space-y-6 p-6 sm:p-7">
          <div className="space-y-3 text-center sm:text-left">
            <div className="flex items-center justify-center gap-2.5 sm:justify-start">
              <BrandMark className="h-9 w-9" decorative />
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
                {t("login.brand")}
              </h1>
            </div>
            <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {t("login.tagline")}
            </p>
          </div>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
        </Card>

        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t("login.projectLinks")}
          </p>
          <ProjectLinks className="justify-center" />
        </div>
      </div>
    </main>
  );
}
