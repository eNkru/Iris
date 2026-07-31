"use client";

import Link from "next/link";
import { useState } from "react";
import { useCheckNow, useDeleteProduct, useProducts, useUpdateProduct } from "../hooks/use-products";
import {
  ButtonDanger,
  ButtonSecondary,
  Card,
  ErrorBox,
  Spinner,
  formatDateTime,
  formatPrice,
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const products = data?.products ?? [];

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this product and its price history?")) {
      return;
    }
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

  if (isLoading) {
    return <Spinner label="Loading products…" />;
  }

  if (isError) {
    return <ErrorBox message={error instanceof Error ? error.message : "Failed to load products."} />;
  }

  if (products.length === 0) {
    return (
      <Card className="text-center text-slate-500">
        No products yet — add your first product URL above.
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {actionError ? <ErrorBox message={actionError} /> : null}
      {products.map((product) => (
        <Card key={product.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <Link
              href={`/products/${product.id}`}
              className="block truncate font-medium text-slate-900 hover:text-slate-600"
            >
              {product.name ?? product.url}
            </Link>
            <p className="truncate text-xs text-slate-400">{product.url}</p>
            <p className="mt-1 text-sm text-slate-500">
              {product.currentPrice != null ? (
                <>
                  <span className="font-semibold text-slate-900">
                    {formatPrice(product.currentPrice, product.currency)}
                  </span>
                  {" · last checked "}
                  {formatDateTime(product.lastCheckedAt)}
                </>
              ) : (
                "No price recorded yet"
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ButtonSecondary
              onClick={() => {
                setActionError(null);
                checkNow.mutate({ id: product.id }, {
                  onError: (err) => setActionError(err.message),
                });
              }}
              disabled={checkNow.isPending}
            >
              {checkNow.isPending ? <Spinner label="Checking…" /> : "Check now"}
            </ButtonSecondary>
            <ButtonSecondary
              onClick={() => {
                setActionError(null);
                updateProduct.mutate({ id: product.id, active: !product.active }, {
                  onError: (err) => setActionError(err.message),
                });
              }}
              disabled={updateProduct.isPending}
            >
              {product.active ? "Pause" : "Resume"}
            </ButtonSecondary>
            <ButtonDanger
              onClick={() => handleDelete(product.id)}
              disabled={deletingId === product.id || deleteProduct.isPending}
            >
              {deletingId === product.id ? "Deleting…" : "Delete"}
            </ButtonDanger>
          </div>
        </Card>
      ))}
      <div className="flex justify-end">
        <ButtonSecondary onClick={() => refetch()}>Refresh</ButtonSecondary>
      </div>
    </div>
  );
}
