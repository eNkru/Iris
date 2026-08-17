"use client";

import { useQueryState } from "nuqs";
import { useMemo } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ProductHistory } from "../hooks/use-products";
import { useI18n } from "../lib/i18n";
import { formatPrice, SegmentedControl } from "./ui";

const RANGE_VALUES = ["7d", "30d", "all"] as const;
type RangeValue = (typeof RANGE_VALUES)[number];

function isRangeValue(value: string | null): value is RangeValue {
  return (RANGE_VALUES as readonly string[]).includes(value ?? "");
}

/**
 * Change-point price trend chart (R13) with a nuqs-backed time-range selector
 * (design.md: 7d/30d/all). Readings are the compact change-point series; the
 * chart draws a step after each price change. `currency` (when known) is shown
 * in the tooltip series label and Y-axis ticks (R11/R9).
 */
export function PriceChart({
  history,
  currency,
}: {
  history: ProductHistory;
  currency: string | null;
}) {
  const { t } = useI18n();
  const [range, setRange] = useQueryState<RangeValue>("range", {
    defaultValue: "30d",
    parse: (value) => (isRangeValue(value) ? value : "30d"),
    serialize: (value) => value,
  });

  const rangeOptions = [
    { value: "7d", label: t("chart.7d") },
    { value: "30d", label: t("chart.30d") },
    { value: "all", label: t("chart.all") },
  ] as const;

  const data = useMemo(() => {
    if (range === "all") {
      return history;
    }
    const cutoff = Date.now() - (range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
    return history.filter((reading) => reading.checkedAt.getTime() >= cutoff);
  }, [history, range]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-stone-500 dark:text-stone-400">
        <span>{t("chart.empty")}</span>
        <span className="text-xs">{t("chart.emptyHint")}</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
          {t("chart.range")}
        </span>
        <SegmentedControl
          options={rangeOptions}
          value={range}
          onChange={setRange}
          label={t("chart.rangeAria")}
        />
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
            <XAxis
              dataKey="checkedAt"
              tickFormatter={(value: Date) =>
                new Date(value).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              }
              stroke="var(--chart-axis)"
              fontSize={12}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => formatPrice(value, currency)}
              stroke="var(--chart-axis)"
              fontSize={12}
              width={70}
            />
            <Tooltip
              labelFormatter={(value) =>
                new Date(String(value)).toLocaleString()
              }
              formatter={(value) => [
                formatPrice(Number(value), currency),
                currency ? t("chart.priceWithCurrency", { currency }) : t("chart.price"),
              ]}
            />
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="var(--chart-line)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-dot)" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}