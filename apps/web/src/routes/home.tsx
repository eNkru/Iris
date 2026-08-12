import { AddProductForm } from "../components/add-product-form";
import { AppShell } from "../components/app-shell";
import { AuthGate } from "../components/auth-gate";
import { ProductList } from "../components/product-list";
import { Card, PageHeader } from "../components/ui";
import { useI18n } from "../lib/i18n";

/**
 * Home page: add-a-product form + tracked products list.
 *
 * Former `app/page.tsx` (server component) read the lang cookie via `getLang()`
 * and called `t(lang, …)`. The client `LanguageProvider` already syncs lang
 * from localStorage + cookie, so the client `useI18n()` hook replaces it.
 */
export function HomePage() {
  const { t } = useI18n();
  return (
    <AuthGate>
      <AppShell mainClassName="space-y-8">
        <PageHeader
          title={t("home.title")}
          description={t("home.intro")}
        />

        <Card className="max-w-xl space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t("home.addSection")}
          </h2>
          <AddProductForm />
        </Card>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("home.tracked")}
          </h2>
          <ProductList />
        </section>
      </AppShell>
    </AuthGate>
  );
}
