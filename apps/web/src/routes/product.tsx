import { useState } from "react";
import { Link, useParams } from "react-router";
import { useCheckNow, useProduct } from "../hooks/use-products";
import { AppShell } from "../components/app-shell";
import { AuthGate } from "../components/auth-gate";
import { PriceChart } from "../components/price-chart";
import { ProductEditForm } from "../components/product-edit-form";
import { useI18n } from "../lib/i18n";
import {
  Badge,
  ButtonSecondary,
  Card,
  ErrorBox,
  Spinner,
  formatDateTime,
  formatPrice,
  formatRelativeTime,
} from "../components/ui";

export function ProductDetailPage() {
  const { t } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const { data, isLoading, isError, error } = useProduct(id);
  const checkNow = useCheckNow();
  const [checkError, setCheckError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <AuthGate>
        <AppShell>
          <Spinner label={t("detail.loading")} />
        </AppShell>
      </AuthGate>
    );
  }

  if (isError || !data) {
    return (
      <AuthGate>
        <AppShell>
          <ErrorBox
            message={
              error instanceof Error ? error.message : t("detail.loadError")
            }
          />
          <div className="mt-4">
            <Link
              to="/"
              className="text-sm font-medium text-slate-500 transition-colors hover:text-[var(--accent)] dark:text-slate-400 dark:hover:text-[var(--accent)]"
            >
              {t("detail.back")}
            </Link>
          </div>
        </AppShell>
      </AuthGate>
    );
  }

  const { product, history } = data;

  return (
    <AuthGate>
      <AppShell mainClassName="space-y-6">
        <div className="space-y-3">
          <Link
            to="/"
            className="inline-flex text-sm font-medium text-slate-500 transition-colors hover:text-[var(--accent)] dark:text-slate-400 dark:hover:text-[var(--accent)]"
          >
            {t("detail.back")}
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 gap-4">
              {product.imagePath ? (
                <img
                  src={`/api/images/${product.id}`}
                  alt={product.name ?? product.url}
                  className="h-48 w-48 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                />
              ) : null}
              <div className="min-w-0 space-y-1">
                <h1
                  className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50"
                  title={product.url}
                >
                  {product.name ?? product.url}
                </h1>
                <p className="truncate text-sm text-slate-400 dark:text-slate-500">
                  {product.url}
                </p>
              </div>
            </div>
            <Badge tone={product.active ? "success" : "neutral"}>
              {product.active ? t("detail.active") : t("detail.paused")}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
            {product.currentPrice != null ? (
              <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
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
          </div>

          <div className="pt-1">
            <ButtonSecondary
              onClick={() => {
                setCheckError(null);
                checkNow.reset();
                checkNow.mutate(
                  { id: product.id },
                  {
                    onError: (err) => setCheckError(err.message),
                  },
                );
              }}
              disabled={checkNow.isPending}
            >
              {checkNow.isPending ? (
                <Spinner label={t("detail.checking")} />
              ) : (
                t("detail.checkNow")
              )}
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
                  alert: checkNow.data.check.alertDispatched
                    ? t("detail.alertSent")
                    : "",
                })}
              </p>
            ) : null}
            {checkNow.data?.check.status === "unchanged" ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                {t("detail.priceUnchanged", {
                  price: formatPrice(
                    checkNow.data.check.price,
                    product.currency,
                  ),
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
                {t("detail.checkFailed", {
                  reason: checkNow.data.check.reason,
                })}
              </p>
            ) : null}
          </div>
        </div>

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("detail.priceHistory")}
          </h2>
          <PriceChart history={history} currency={product.currency} />
        </Card>

        <Card>
          <h2 className="mb-4 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {t("detail.settings")}
          </h2>
          <ProductEditForm product={product} />
        </Card>
      </AppShell>
    </AuthGate>
  );
}
