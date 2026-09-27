/**
 * Money and percentage fields in forms: what a person types <-> integer
 * minor units / basis points. Pure and browser-safe. Prices are only ever
 * computed by calculate.ts; this only converts what was typed.
 */

/** "1,200.5" -> 120050; "" or anything malformed -> null. Two decimal places at most. */
export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[£$€,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 120050 -> "1200.50" (no separators: it goes back into an input). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const whole = Math.trunc(minor / 100);
  const fraction = String(Math.abs(minor % 100)).padStart(2, "0");
  return `${whole}.${fraction}`;
}

/** "12.5" -> 1250 bps; "" -> null. */
export function parsePercentInput(value: string): number | null {
  const cleaned = value.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bps = Math.round(Number(cleaned) * 100);
  return bps >= 0 && bps <= 10_000 ? bps : null;
}

export function bpsToInput(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "";
  return String(bps / 100);
}

/** A catalogue key from a name: "Website build" -> "website-build". */
export function keyFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "item";
}
