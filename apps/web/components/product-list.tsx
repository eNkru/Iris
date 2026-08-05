"use client";

import Link from "next/link";
import { useState } from "react";
import { useCheckNow, useDeleteProduct, useProducts, useUpdateProduct } from "../hooks/use-products";
import { useSendSummary } from "../hooks/use-channels";
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
  const [summarySent, setSummarySent] = useState<string | null>(null);

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
      setActionError(err instanceof Error ? err.message : "Failed to delete product.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSendSummary = () => {
    setActionError(null);
    setSummarySent(null);
    sendSummary.mutate(undefined, {
      onSuccess: (data) => {
        setSummarySent(
          `Summary sent to your Telegram (${data.productsCount} ${
            data.productsCount === 1 ? "item" : "items"
          })`,
        );
      },
      onError: (err) => setActionError(err.message),
    });
  };

  if (isLoading) {
    return <Spinner label="Loading products…" />;
  }

  if (isError) {
    return <ErrorBox message={error instanceof Error ? error.message : "Failed to load products."} />;
  }

  if (products.length === 0) {
    return (
      <div className="space-y-3">
        <Card className="text-center text-slate-500">
          No products yet — add your first product URL above.
        </Card>
        {actionError ? <ErrorBox message={actionError} /> : null}
        <div className="flex items-center justify-end gap-3">
          {summarySent ? <SuccessBox message={summarySent} /> : null}
          <div className="flex items-center gap-2">
            <TelegramHelpTooltip />
            <ButtonSecondary
              onClick={handleSendSummary}
              disabled={sendSummary.isPending}
            >
              {sendSummary.isPending ? (
                <Spinner label="Sending…" />
              ) : (
                "Send summary to Telegram"
              )}
            </ButtonSecondary>
          </div>
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
                  className={`block truncate font-medium hover:text-slate-600 ${
                    product.active ? "text-slate-900" : "text-slate-400"
                  }`}
                >
                  {product.name ?? product.url}
                </Link>
                {!product.active ? (
                  <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">
                    Paused
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs text-slate-400">{product.url}</p>
              <p className="mt-1 text-sm text-slate-500">
                {product.currentPrice != null ? (
                  <>
                    <span
                      className={`font-semibold ${
                        product.active ? "text-slate-900" : "text-slate-400"
                      }`}
                    >
                      {formatPrice(product.currentPrice, product.currency)}
                    </span>
                    {" · checked "}
                    <span title={formatDateTime(product.lastCheckedAt)}>
                      {formatRelativeTime(product.lastCheckedAt)}
                    </span>
                  </>
                ) : (
                  "No price recorded yet"
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ButtonSecondary
                onClick={() => handleCheckNow(product.id)}
                disabled={checkPending || togglePending}
              >
                {checkPending ? <Spinner label="Checking…" /> : "Check now"}
              </ButtonSecondary>
              <ButtonSecondary
                onClick={() => handleToggleActive(product.id)}
                disabled={checkPending || togglePending}
              >
                {togglePending ? <Spinner label="…" /> : product.active ? "Pause" : "Resume"}
              </ButtonSecondary>
              {isConfirming ? (
                <>
                  <ButtonDanger onClick={() => handleDelete(product.id)} disabled={deletingId !== null}>
                    {deletingId === product.id ? "Deleting…" : "Confirm delete"}
                  </ButtonDanger>
                  <ButtonSecondary
                    onClick={() => setConfirmingDeleteId(null)}
                    disabled={deletingId !== null}
                  >
                    Cancel
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
                  Delete
                </ButtonDanger>
              )}
            </div>
          </Card>
        );
      })}
      <div className="flex items-center justify-end gap-3">
        {summarySent ? <SuccessBox message={summarySent} /> : null}
        <div className="flex items-center gap-2">
          <TelegramHelpTooltip />
          <ButtonSecondary
            onClick={handleSendSummary}
            disabled={sendSummary.isPending}
          >
            {sendSummary.isPending ? (
              <Spinner label="Sending…" />
            ) : (
              "Send summary to Telegram"
            )}
          </ButtonSecondary>
        </div>
        <ButtonSecondary onClick={() => refetch()}>Refresh</ButtonSecondary>
      </div>
    </div>
  );
}
