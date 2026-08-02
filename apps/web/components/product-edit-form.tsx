"use client";

import { useState, type FormEvent } from "react";
import type { ProductOutput } from "../hooks/use-products";
import { useUpdateProduct } from "../hooks/use-products";
import { Button, ButtonSecondary, ErrorBox, Input, Label, Spinner } from "./ui";

/**
 * Product detail edit form: poll interval override (R7), alert rules (R10),
 * and the active/paused toggle. Saves via `products.update`.
 */
export function ProductEditForm({ product }: { product: ProductOutput }) {
  const updateProduct = useUpdateProduct();

  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(
    product.pollIntervalMinutes?.toString() ?? "",
  );
  const [anyChange, setAnyChange] = useState(product.alertRules?.anyChange ?? true);
  const [risePct, setRisePct] = useState(product.alertRules?.risePct?.toString() ?? "");
  const [fallPct, setFallPct] = useState(product.alertRules?.fallPct?.toString() ?? "");
  const [riseAbs, setRiseAbs] = useState(product.alertRules?.riseAbs?.toString() ?? "");
  const [fallAbs, setFallAbs] = useState(product.alertRules?.fallAbs?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    const parsedInterval = pollIntervalMinutes === "" ? null : Number(pollIntervalMinutes);
    if (parsedInterval !== null && (!Number.isInteger(parsedInterval) || parsedInterval < 1)) {
      setError("Poll interval must be a whole number of minutes (or empty for the default).");
      return;
    }

    const alertRules = {
      anyChange,
      risePct: risePct === "" ? undefined : Number(risePct),
      fallPct: fallPct === "" ? undefined : Number(fallPct),
      riseAbs: riseAbs === "" ? undefined : Number(riseAbs),
      fallAbs: fallAbs === "" ? undefined : Number(fallAbs),
    };

    try {
      await updateProduct.mutateAsync({
        id: product.id,
        pollIntervalMinutes: parsedInterval,
        alertRules,
        active: product.active,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save product settings.");
    }
  };

  const numberField = (
    label: string,
    value: string,
    setValue: (v: string) => void,
  ) => (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        min="0"
        step="any"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <Label>Poll interval (minutes)</Label>
        <Input
          type="number"
          min="1"
          step="1"
          placeholder="Empty = use default"
          value={pollIntervalMinutes}
          onChange={(e) => setPollIntervalMinutes(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-400">
          How often the background scheduler checks this product.
        </p>
      </div>

      <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center gap-2">
          <input
            id="any-change"
            type="checkbox"
            checked={anyChange}
            onChange={(e) => setAnyChange(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          <Label htmlFor="any-change" className="mb-0">
            Alert on any price change
          </Label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {numberField("Rise threshold (%)", risePct, setRisePct)}
          {numberField("Fall threshold (%)", fallPct, setFallPct)}
          {numberField("Rise threshold (abs)", riseAbs, setRiseAbs)}
          {numberField("Fall threshold (abs)", fallAbs, setFallAbs)}
        </div>
        <p className="text-xs text-slate-400">
          Optional. Leave blank to only alert on any change.
        </p>
      </div>

      {error ? <ErrorBox message={error} /> : null}
      {updateProduct.isSuccess ? (
        <p className="text-sm text-emerald-700">Saved.</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={updateProduct.isPending}>
          {updateProduct.isPending ? <Spinner label="Saving…" /> : "Save changes"}
        </Button>
        <ButtonSecondary
          type="button"
          onClick={() => {
            setError(null);
            updateProduct.mutate({ id: product.id, active: !product.active }, {
              onError: (err) => setError(err.message),
            });
          }}
          disabled={updateProduct.isPending}
        >
          {product.active ? "Pause tracking" : "Resume tracking"}
        </ButtonSecondary>
      </div>
    </form>
  );
}
