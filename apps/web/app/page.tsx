import { AddProductForm } from "../components/add-product-form";
import { AppShell } from "../components/app-shell";
import { AuthGate } from "../components/auth-gate";
import { ProductList } from "../components/product-list";
import { Card, PageHeader } from "../components/ui";
import { t } from "../lib/dictionary";
import { getLang } from "./lib/get-lang";

export default async function HomePage() {
  const lang = await getLang();
  return (
    <AuthGate>
      <AppShell mainClassName="space-y-8">
        <PageHeader
          title={t(lang, "home.title")}
          description={t(lang, "home.intro")}
        />

        <Card className="max-w-xl space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t(lang, "home.addSection")}
          </h2>
          <AddProductForm />
        </Card>

        <section className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t(lang, "home.tracked")}
          </h2>
          <ProductList />
        </section>
      </AppShell>
    </AuthGate>
  );
}
