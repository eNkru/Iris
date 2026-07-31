import { AddProductForm } from "../components/add-product-form";
import { AppNav } from "../components/app-nav";
import { AuthGate } from "../components/auth-gate";
import { ProductList } from "../components/product-list";

export default function HomePage() {
  return (
    <AuthGate>
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl space-y-8 px-6 py-8">
          <section className="space-y-3">
            <h1 className="text-2xl font-semibold">Products</h1>
            <p className="text-sm text-slate-500">
              Add a product URL to start tracking its price. The first check runs
              immediately.
            </p>
            <div className="max-w-xl">
              <AddProductForm />
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Tracked products</h2>
            <ProductList />
          </section>
        </main>
      </div>
    </AuthGate>
  );
}
