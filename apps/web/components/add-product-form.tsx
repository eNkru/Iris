"use client";

import { useState, type FormEvent } from "react";
import { useCreateProduct } from "../hooks/use-products";
import { Button, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Add-a-product form (R4): submits a URL, runs the synchronous first check on
 * the server, and reports the resulting price (AC2).
 */
export function AddProductForm() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const createProduct = useCreateProduct();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError("Please enter a product URL.");
      return;
    }

    try {
      const result = await createProduct.mutateAsync({ url: url.trim() });

      if (result.check.status === "changed" || result.check.status === "unchanged") {
        setUrl("");
      } else if (result.check.status === "unavailable") {
        setError("The page was reached but no price could be extracted.");
      } else if (result.check.status === "failed") {
        setError(result.check.reason || "The price check failed.");
      } else if (result.check.status === "not_found") {
        setError("The page could not be fetched.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add product.");
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <Label htmlFor="product-url">Product URL</Label>
        <Input
          id="product-url"
          type="url"
          required
          placeholder="https://shop.example.com/product/123"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={createProduct.isPending}
        />
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {createProduct.data?.check.status === "changed" ? (
        <p className="text-sm text-emerald-700">
          Added — current price{" "}
          <strong>
            {createProduct.data.check.currency} {createProduct.data.check.newPrice.toFixed(2)}
          </strong>
          {" "}is now tracked.
        </p>
      ) : null}
      {createProduct.data?.check.status === "unchanged" ? (
        <p className="text-sm text-slate-600">
          Added — current price is{" "}
          <strong>{createProduct.data.check.price.toFixed(2)}</strong>.
        </p>
      ) : null}

      <Button type="submit" disabled={createProduct.isPending}>
        {createProduct.isPending ? <Spinner label="Checking…" /> : "Add product"}
      </Button>
    </form>
  );
}
