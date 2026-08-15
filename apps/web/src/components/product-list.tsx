"use client";

import { Link } from "react-router";
import { useState } from "react";
import {
  useCheckNow,
  useDeleteProduct,
  useProducts,
  useUpdateProduct,
} from "../hooks/use-products";
import { useSendSummary } from "../hooks/use-channels";
import { useI18n } from "../lib/i18n";
import { TelegramHelpTooltip } from "./telegram-help-tooltip";
import {
  Badge,
  ButtonDanger,
  ButtonSecondary,
  Card,
  ErrorBox,
  Spinner,
  SuccessBox,
  formatDateTime,
  formatPrice,
  formatRelativeTime,
} from "./ui";

/**
 * Product list for the home page: current price, last-checked time, and row
 * actions (view, check now, pause/resume, delete).
 */
export function ProductList() {
  const { t } = useI18n();
  const { data, isLoading, isError, error, refetch } = useProducts();
  const checkNow = useCheckNow();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();
  const sendSummary = useSendSummary();
  const [pendingAction, setPendingAction] = useState<{
    id: string;
    kind: "check" | "toggle";
  } | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [summaryCount, setSummaryCount] = useState<number | null>(null);

  const products = data?.products ?? [];

  const handleCheckNow = (id: string) => {
    setPendingAction({ id, kind: "check" });
    setActionError(null);
    checkNow.mutate(
      { id },
      {
        onError: (err) => setActionError(err.message),
        onSettled: () => setPendingAction(null),
      },
    );
  };

  const handleToggleActive = (id: string) => {
    const product = products.find((p) => p.id === id);
    if (!product) {
      return;
    }
    setPendingAction({ id, kind: "toggle" });
    setActionError(null);
    updateProduct.mutate(
      { id, active: !product.active },
      {
        onError: (err) => setActionError(err.message),
        onSettled: () => setPendingAction(null),
      },
    );
  };

  const handleDelete = async (id: string) => {
    setConfirmingDeleteId(null);
    setDeletingId(id);
    setActionError(null);
    try {
      await deleteProduct.mutateAsync(id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t("productList.deleteError"),
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendSummary = () => {
    setActionError(null);
    setSummaryCount(null);
    sendSummary.mutate(undefined, {
      onSuccess: (data) => {
        setSummaryCount(data.productsCount);
      },
      onError: (err) => setActionError(err.message),
    });
  };

  if (isLoading) {
    return <Spinner label={t("productList.loading")} />;
  }

  if (isError) {
    return (
      <ErrorBox
        message={
          error instanceof Error ? error.message : t("productList.loadError")
        }
      />
    );
  }

  const summaryBox =
    summaryCount !== null ? (
      <SuccessBox
        message={t("productList.summarySent", {
          n: summaryCount,
          items: t(
            summaryCount === 1
              ? "productList.summarySent.one"
              : "productList.summarySent.other",
          ),
        })}
      />
    ) : null;

  const listToolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {summaryBox}
      <div className="flex items-center gap-2">
        <TelegramHelpTooltip />
        <ButtonSecondary
          onClick={handleSendSummary}
          disabled={sendSummary.isPending}
        >
          {sendSummary.isPending ? (
            <Spinner label={t("productList.sending")} />
          ) : (
            t("productList.sendSummary")
          )}
        </ButtonSecondary>
      </div>
      {products.length > 0 ? (
        <ButtonSecondary onClick={() => refetch()}>
          {t("productList.refresh")}
        </ButtonSecondary>
      ) : null}
    </div>
  );

  if (products.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-base font-medium text-slate-800 dark:text-slate-200">
            {t("productList.emptyTitle")}
          </p>
          <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
            {t("productList.empty")}
          </p>
        </Card>
        {actionError ? <ErrorBox message={actionError} /> : null}
        {listToolbar}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {actionError ? <ErrorBox message={actionError} /> : null}
      {products.map((product) => {
        const checkPending =
          pendingAction?.id === product.id && pendingAction.kind === "check";
        const togglePending =
          pendingAction?.id === product.id && pendingAction.kind === "toggle";
        const isConfirming = confirmingDeleteId === product.id;
        return (
          <Card
            key={product.id}
            className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"
          >
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
              <div className="group relative">
                {product.imagePath ? (
                  <>
                    <img
                      src={`/api/images/${product.id}`}
                      alt={product.name ?? product.url}
                      className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                      loading="lazy"
                    />
                    <img
                      src={`/api/images/${product.id}`}
                      alt={product.name ?? product.url}
                      className="pointer-events-none absolute left-1/2 top-full z-50 hidden w-[640px] -translate-x-1/2 translate-y-2 rounded-xl border border-slate-200 bg-white p-2 opacity-0 shadow-2xl transition-opacity duration-150 group-hover:block group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </>
                ) : null}
              </div>
                <Link
                  to={`/products/${product.id}`}
                  className={`block truncate text-base font-semibold tracking-tight transition-colors hover:text-[var(--accent)] ${
                    product.active
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {product.name ?? product.url}
                </Link>
                <Badge tone={product.active ? "success" : "neutral"}>
                  {product.active
                    ? t("productList.active")
                    : t("productList.paused")}
                </Badge>
              </div>
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                {product.url}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {product.currentPrice != null ? (
                  <>
                    <span
                      className={`text-base font-semibold tabular-nums ${
                        product.active
                          ? "text-slate-900 dark:text-slate-100"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {formatPrice(product.currentPrice, product.currency)}
                    </span>
                    {t("productList.checked")}
                    <span title={formatDateTime(product.lastCheckedAt)}>
                      {formatRelativeTime(product.lastCheckedAt)}
                    </span>
                  </>
                ) : (
                  t("productList.noPrice")
                )}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <ButtonSecondary
                onClick={() => handleCheckNow(product.id)}
                disabled={checkPending || togglePending}
              >
                {checkPending ? (
                  <Spinner label={t("detail.checking")} />
                ) : (
                  t("productList.checkNow")
                )}
              </ButtonSecondary>
              <ButtonSecondary
                onClick={() => handleToggleActive(product.id)}
                disabled={checkPending || togglePending}
              >
                {togglePending ? (
                  <Spinner label="…" />
                ) : product.active ? (
                  t("productList.pause")
                ) : (
                  t("productList.resume")
                )}
              </ButtonSecondary>
              {isConfirming ? (
                <>
                  <ButtonDanger
                    onClick={() => handleDelete(product.id)}
                    disabled={deletingId !== null}
                  >
                    {deletingId === product.id
                      ? t("productList.deleting")
                      : t("productList.confirmDelete")}
                  </ButtonDanger>
                  <ButtonSecondary
                    onClick={() => setConfirmingDeleteId(null)}
                    disabled={deletingId !== null}
                  >
                    {t("productList.cancel")}
                  </ButtonSecondary>
                </>
              ) : (
                <ButtonDanger
                  onClick={() => {
                    setActionError(null);
                    setConfirmingDeleteId(product.id);
                  }}
                  disabled={confirmingDeleteId !== null && !isConfirming}
                >
                  {t("productList.delete")}
                </ButtonDanger>
              )}
            </div>
          </Card>
        );
      })}
      {listToolbar}
    </div>
  );
}
