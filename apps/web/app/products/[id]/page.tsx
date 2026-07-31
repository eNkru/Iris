"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCheckNow, useProduct } from "../../../hooks/use-products";
import { AppNav } from "../../../components/app-nav";
import { AuthGate } from "../../../components/auth-gate";
import { PriceChart } from "../../../components/price-chart";
import { ProductEditForm } from "../../../components/product-edit-form";
import {
  ButtonSecondary,
  Card,
  ErrorBox,
  Spinner,
  formatDateTime,
  formatPrice,
} from "../../../components/ui";

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, isLoading, isError, error } = useProduct(id);
  const checkNow = useCheckNow();

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl px-6 py-8">
          <Spinner label="Loading product…" />
        </main>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl px-6 py-8">
          <ErrorBox
            message={error instanceof Error ? error.message : "Failed to load product."}
          />
          <div className="mt-4">
            <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
              ← Back to products
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const { product, history } = data;

  return (
    <AuthGate>
      <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">
            ← Back to products
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">
            {product.name ?? "Untitled product"}
          </h1>
          <p className="truncate text-sm text-slate-400">{product.url}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
            {product.currentPrice != null ? (
              <span>
                Current price:{" "}
                <strong className="text-slate-900">
                  {formatPrice(product.currentPrice, product.currency)}
                </strong>
              </span>
            ) : (
              <span>No price recorded yet</span>
            )}
            <span>Last checked: {formatDateTime(product.lastCheckedAt)}</span>
            <span className={product.active ? "text-emerald-600" : "text-slate-400"}>
              {product.active ? "Active" : "Paused"}
            </span>
          </div>
          <div className="mt-3">
            <ButtonSecondary
              onClick={() => checkNow.mutate({ id: product.id })}
              disabled={checkNow.isPending}
            >
              {checkNow.isPending ? <Spinner label="Checking…" /> : "Check now"}
            </ButtonSecondary>
            {checkNow.data?.check.status === "changed" ? (
              <p className="mt-2 text-sm text-emerald-700">
                Price changed:{" "}
                {checkNow.data.check.oldPrice != null
                  ? `${formatPrice(checkNow.data.check.oldPrice, checkNow.data.check.currency)} → `
                  : ""}
                {formatPrice(checkNow.data.check.newPrice, checkNow.data.check.currency)}
                {checkNow.data.check.alertDispatched ? " (alert sent)" : ""}
              </p>
            ) : null}
            {checkNow.data?.check.status === "unchanged" ? (
              <p className="mt-2 text-sm text-slate-600">
                Price unchanged ({formatPrice(checkNow.data.check.price, product.currency)}).
              </p>
            ) : null}
            {checkNow.data?.check.status === "unavailable" ? (
              <p className="mt-2 text-sm text-amber-700">
                Page reached but no price could be extracted.
              </p>
            ) : null}
            {checkNow.data?.check.status === "failed" ? (
              <p className="mt-2 text-sm text-red-700">
                Check failed: {checkNow.data.check.reason}
              </p>
            ) : null}
          </div>
        </div>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Price history</h2>
          <PriceChart history={history} />
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">Settings</h2>
          <ProductEditForm product={product} />
        </Card>
      </main>
      </div>
    </AuthGate>
  );
}
