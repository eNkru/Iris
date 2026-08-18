"use client";

import { useQueryState } from "nuqs";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type DailyPoint = { checkedAt: Date; price: number };

/**
 * Expand the compact change-point series into a continuous daily series.
 * The DB only stores a reading when the price changes (R9), so days with no
 * change are missing. This helper fills those gaps by carrying forward the
 * last known price, giving the chart a continuous daily X-axis.
 *
 * The range start is the earliest reading within the selected window (or the
 * cutoff date for 7d/30d). The end is today. If the first reading is after the
 * cutoff, the series starts from that reading's date (no synthetic prices
 * before the first known reading).
 */
function fillDailyGaps(
  readings: ProductHistory,
  cutoff: number | null,
): DailyPoint[] {
  if (readings.length === 0) return [];

  const today = startOfDay(new Date()).getTime();
  const firstReading = readings[0];
  if (!firstReading) return [];

  const firstTs = firstReading.checkedAt.getTime();
  const startTs =
    cutoff != null
      ? Math.max(startOfDay(new Date(firstTs)).getTime(), cutoff)
      : startOfDay(new Date(firstTs)).getTime();

  const result: DailyPoint[] = [];

  // Walk day-by-day from start to today (inclusive). For each day, find the
  // most recent reading on or before that day (forward-fill).
  let readingIdx = 0;
  let currentPrice = firstReading.price;

  for (let day = startTs; day <= today; day += MS_PER_DAY) {
    // Advance through all readings that fall on or before this day
    while (readingIdx < readings.length) {
      const reading = readings[readingIdx];
      if (!reading || reading.checkedAt.getTime() > endOfDay(new Date(day)).getTime()) {
        break;
      }
      currentPrice = reading.price;
      readingIdx++;
    }

    result.push({ checkedAt: new Date(day), price: currentPrice });
  }

  return result;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Daily price trend chart (R13) with a nuqs-backed time-range selector
 * (design.md: 7d/30d/all). Readings are the compact change-point series; the
 * chart fills daily gaps (carrying forward the last known price) and renders a
 * stepped area chart so flat periods and change points are visually clear.
 * `currency` (when known) is shown in the tooltip series label and Y-axis
 * ticks (R11/R9).
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
      return fillDailyGaps(history, null);
    }
    const cutoff = Date.now() - (range === "7d" ? 7 : 30) * MS_PER_DAY;
    const filtered = history.filter(
      (reading) => reading.checkedAt.getTime() >= cutoff,
    );
    return fillDailyGaps(filtered, cutoff);
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
          <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <defs>
              <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-area)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--chart-area)" stopOpacity={0.05} />
              </linearGradient>
            </defs>
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
            <Area
              type="stepAfter"
              dataKey="price"
              stroke="var(--chart-line)"
              strokeWidth={2}
              fill="url(#priceGradient)"
              dot={false}
              activeDot={{ r: 5, fill: "var(--chart-dot)" }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
