"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useCheckNow, useProduct } from "../../../hooks/use-products";
import { AppNav } from "../../../components/app-nav";
import { AuthGate } from "../../../components/auth-gate";
import { PriceChart } from "../../../components/price-chart";
import { ProductEditForm } from "../../../components/product-edit-form";
import { useI18n } from "../../../lib/i18n";
import {
  ButtonSecondary,
  Card,
  ErrorBox,
  Spinner,
  formatDateTime,
  formatPrice,
  formatRelativeTime,
} from "../../../components/ui";

export default function ProductDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, isLoading, isError, error } = useProduct(id);
  const checkNow = useCheckNow();
  const [checkError, setCheckError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <AppNav />
        <main className="mx-auto max-w-5xl px-6 py-8">
          <Spinner label={t("detail.loading")} />
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
            message={error instanceof Error ? error.message : t("detail.loadError")}
          />
          <div className="mt-4">
            <Link
              href="/"
              className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
            >
              {t("detail.back")}
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
          <Link
            href="/"
            className="text-sm text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            {t("detail.back")}
          </Link>
          <h1 className="mt-2 truncate text-2xl font-semibold dark:text-slate-100" title={product.url}>
            {product.name ?? product.url}
          </h1>
          <p className="truncate text-sm text-slate-400 dark:text-slate-500">{product.url}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            {product.currentPrice != null ? (
              <span>
                {t("detail.currentPrice", {
                  price: formatPrice(product.currentPrice, product.currency),
                })}
              </span>
            ) : (
              <span>{t("detail.noPrice")}</span>
            )}
            <span title={formatDateTime(product.lastCheckedAt)}>
              {t("detail.lastChecked", {
                time: formatRelativeTime(product.lastCheckedAt),
              })}
            </span>
            <span
              className={
                product.active
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-400 dark:text-slate-500"
              }
            >
              {product.active ? t("detail.active") : t("detail.paused")}
            </span>
          </div>
          <div className="mt-3">
            <ButtonSecondary
              onClick={() => {
                setCheckError(null);
                checkNow.reset();
                checkNow.mutate({ id: product.id }, {
                  onError: (err) => setCheckError(err.message),
                });
              }}
              disabled={checkNow.isPending}
            >
              {checkNow.isPending ? <Spinner label={t("detail.checking")} /> : t("detail.checkNow")}
            </ButtonSecondary>
            {checkError ? (
              <div className="mt-2">
                <ErrorBox message={checkError} />
              </div>
            ) : null}
            {checkNow.data?.check.status === "changed" ? (
              <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-400">
                {t("detail.priceChanged", {
                  prices: `${
                    checkNow.data.check.oldPrice != null
                      ? `${formatPrice(checkNow.data.check.oldPrice, checkNow.data.check.currency)} → `
                      : ""
                  }${formatPrice(checkNow.data.check.newPrice, checkNow.data.check.currency)}`,
                  alert: checkNow.data.check.alertDispatched ? t("detail.alertSent") : "",
                })}
              </p>
            ) : null}
            {checkNow.data?.check.status === "unchanged" ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t("detail.priceUnchanged", {
                  price: formatPrice(checkNow.data.check.price, product.currency),
                })}
              </p>
            ) : null}
            {checkNow.data?.check.status === "unavailable" ? (
              <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">
                {t("detail.unavailable")}
              </p>
            ) : null}
            {checkNow.data?.check.status === "failed" ? (
              <p className="mt-2 text-sm text-red-700 dark:text-red-300">
                {t("detail.checkFailed", { reason: checkNow.data.check.reason })}
              </p>
            ) : null}
          </div>
        </div>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("detail.priceHistory")}</h2>
          <PriceChart history={history} currency={product.currency} />
        </Card>

        <Card>
          <h2 className="mb-3 text-lg font-semibold">{t("detail.settings")}</h2>
          <ProductEditForm product={product} />
        </Card>
      </main>
      </div>
    </AuthGate>
  );
}