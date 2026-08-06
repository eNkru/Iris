import { AddProductForm } from "../components/add-product-form";
import { AppNav } from "../components/app-nav";
import { AuthGate } from "../components/auth-gate";
import { ProductList } from "../components/product-list";
import { t } from "../lib/dictionary";
import { getLang } from "./lib/get-lang";

export default async function HomePage() {
  const lang = await getLang();
  return (
    <AuthGate>
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
          <section className="space-y-3">
            <h1 className="text-2xl font-semibold">{t(lang, "home.title")}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t(lang, "home.intro")}
            </p>
            <div className="max-w-xl">
              <AddProductForm />
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">{t(lang, "home.tracked")}</h2>
            <ProductList />
          </section>
        </main>
      </div>
    </AuthGate>
  );
}
