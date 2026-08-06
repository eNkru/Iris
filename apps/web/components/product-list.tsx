"use client";

import Link from "next/link";
import { useState } from "react";
import { useCheckNow, useDeleteProduct, useProducts, useUpdateProduct } from "../hooks/use-products";
import { useSendSummary } from "../hooks/use-channels";
import { useI18n } from "../lib/i18n";
import { TelegramHelpTooltip } from "./telegram-help-tooltip";
import {
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
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
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
        message={error instanceof Error ? error.message : t("productList.loadError")}
      />
    );
  }

  const summaryBox = summaryCount !== null ? (
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

  const summaryAction = (
    <div className="flex items-center gap-2">
      <TelegramHelpTooltip />
      <ButtonSecondary onClick={handleSendSummary} disabled={sendSummary.isPending}>
        {sendSummary.isPending ? (
          <Spinner label={t("productList.sending")} />
        ) : (
          t("productList.sendSummary")
        )}
      </ButtonSecondary>
    </div>
  );

  if (products.length === 0) {
    return (
      <div className="space-y-3">
        <Card className="text-center text-slate-500 dark:text-slate-400">
          {t("productList.empty")}
        </Card>
        {actionError ? <ErrorBox message={actionError} /> : null}
        <div className="flex items-center justify-end gap-3">
          {summaryBox}
          {summaryAction}
        </div>
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
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Link
                  href={`/products/${product.id}`}
                  className={`block truncate font-medium hover:text-slate-600 dark:hover:text-slate-300 ${
                    product.active
                      ? "text-slate-900 dark:text-slate-100"
                      : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {product.name ?? product.url}
                </Link>
                {!product.active ? (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {t("productList.paused")}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                {product.url}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {product.currentPrice != null ? (
                  <>
                    <span
                      className={`font-semibold ${
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
            <div className="flex shrink-0 items-center gap-2">
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
      <div className="flex items-center justify-end gap-3">
        {summaryBox}
        {summaryAction}
        <ButtonSecondary onClick={() => refetch()}>
          {t("productList.refresh")}
        </ButtonSecondary>
      </div>
    </div>
  );
}