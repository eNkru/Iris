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
import { ButtonSecondary } from "./ui";

const RANGE_OPTIONS = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All" },
] as const;

type RangeValue = (typeof RANGE_OPTIONS)[number]["value"];

function isRangeValue(value: string | null): value is RangeValue {
  return RANGE_OPTIONS.some((option) => option.value === value);
}

/**
 * Change-point price trend chart (R13) with a nuqs-backed time-range selector
 * (design.md: 7d/30d/all). Readings are the compact change-point series; the
 * chart draws a step after each price change.
 */
export function PriceChart({ history }: { history: ProductHistory }) {
  const [range, setRange] = useQueryState<RangeValue>("range", {
    defaultValue: "30d",
    parse: (value) => (isRangeValue(value) ? value : "30d"),
    serialize: (value) => value,
  });

  const data = useMemo(() => {
    if (range === "all") {
      return history;
    }
    const cutoff = Date.now() - (range === "7d" ? 7 : 30) * 24 * 60 * 60 * 1000;
    return history.filter((reading) => reading.checkedAt.getTime() >= cutoff);
  }, [history, range]);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-sm text-slate-500">
        <span>No price changes in the selected period.</span>
        <span className="text-xs">Readings are only recorded when the price changes.</span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">Range</span>
        {RANGE_OPTIONS.map((option) => (
          <ButtonSecondary
            key={option.value}
            onClick={() => setRange(option.value)}
            className={
              range === option.value
                ? "border-slate-900 bg-slate-900 text-white hover:bg-slate-800"
                : ""
            }
          >
            {option.label}
          </ButtonSecondary>
        ))}
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="checkedAt"
              tickFormatter={(value: Date) =>
                new Date(value).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              }
              stroke="#94a3b8"
              fontSize={12}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={(value: number) => value.toFixed(2)}
              stroke="#94a3b8"
              fontSize={12}
              width={70}
            />
            <Tooltip
              labelFormatter={(value) =>
                new Date(String(value)).toLocaleString()
              }
              formatter={(value) => [Number(value).toFixed(2), "Price"]}
            />
            <Line
              type="stepAfter"
              dataKey="price"
              stroke="#0f172a"
              strokeWidth={2}
              dot={{ r: 3, fill: "#0f172a" }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
