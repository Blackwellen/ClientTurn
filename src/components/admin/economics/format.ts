/**
 * Money and margin formatting for Admin → Economics. Per-lead and per-unit
 * costs are pennies, so precision follows the size of the number rather than
 * rounding 9p to "£0".
 */

export function gbp(value: number | null, digits?: number): string {
  if (value === null) return "—";
  const dp = digits ?? (Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 1 ? 2 : Math.abs(value) === 0 ? 2 : 3);
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(value);
}

export function percent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}

export function count(value: number): string {
  return new Intl.NumberFormat("en-GB").format(value);
}
