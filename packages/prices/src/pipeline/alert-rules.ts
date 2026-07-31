import type { AlertRules } from "@iris/utils";

export type PriceDirection = "rise" | "fall";

/**
 * Discriminated union (shared/typescript.md) so callers can read `direction`
 * once `shouldAlert` is known to be true.
 */
export type AlertRuleEvaluation =
  | { shouldAlert: true; direction: PriceDirection }
  | { shouldAlert: false; direction: null };

/**
 * Round a price to cents — prices are stored as `numeric(14, 2)`, so two
 * prices that differ by less than half a cent are treated as equal.
 */
export function roundToCent(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * R10 — decide whether a price change should trigger an alert.
 *
 * Semantics:
 * - `rules` null/empty → default: alert on any change.
 * - Thresholds (`risePct`/`fallPct`/`riseAbs`/`fallAbs`) are direction-specific;
 *   a change in one direction only consults that direction's thresholds.
 * - `anyChange: true` additionally alerts on any change for directions that
 *   have no threshold configured.
 * - `anyChange: false` (or unset while thresholds exist) means thresholds gate
 *   alerts; changes that meet no threshold stay silent.
 */
export function shouldAlert(
  oldPrice: number,
  newPrice: number,
  rules: AlertRules | null,
): AlertRuleEvaluation {
  if (roundToCent(oldPrice) === roundToCent(newPrice)) {
    return { shouldAlert: false, direction: null };
  }

  const direction: PriceDirection = newPrice > oldPrice ? "rise" : "fall";
  const diffAbs = Math.abs(newPrice - oldPrice);
  const diffPct = oldPrice > 0 ? (diffAbs / oldPrice) * 100 : Number.POSITIVE_INFINITY;

  if (!rules) {
    return { shouldAlert: true, direction };
  }

  const { anyChange, risePct, fallPct, riseAbs, fallAbs } = rules;
  const hasAnyThreshold =
    risePct !== undefined ||
    fallPct !== undefined ||
    riseAbs !== undefined ||
    fallAbs !== undefined;

  if (!hasAnyThreshold) {
    // No thresholds configured — fall back to the default "alert on any change".
    const alertOnAnyChange = anyChange === true || anyChange === undefined;
    return alertOnAnyChange
      ? { shouldAlert: true, direction }
      : { shouldAlert: false, direction: null };
  }

  if (direction === "rise") {
    const meetsThreshold =
      (risePct !== undefined && diffPct >= risePct) ||
      (riseAbs !== undefined && diffAbs >= riseAbs);
    const noRiseThreshold = risePct === undefined && riseAbs === undefined;

    if (meetsThreshold || (anyChange === true && noRiseThreshold)) {
      return { shouldAlert: true, direction };
    }
    return { shouldAlert: false, direction: null };
  }

  const meetsThreshold =
    (fallPct !== undefined && diffPct >= fallPct) ||
    (fallAbs !== undefined && diffAbs >= fallAbs);
  const noFallThreshold = fallPct === undefined && fallAbs === undefined;

  if (meetsThreshold || (anyChange === true && noFallThreshold)) {
    return { shouldAlert: true, direction };
  }
  return { shouldAlert: false, direction: null };
}
