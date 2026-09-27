/**
 * Integer money arithmetic for quotes and invoices.
 *
 * Every amount is an integer number of MINOR units (pence for GBP). No float
 * ever holds money: products and quotients go through BigInt, and every
 * division states its rounding rule. Percentages are integer BASIS POINTS
 * (1% = 100 bps, 100% = 10 000 bps). Quantities may be fractional (7.5
 * hours) and are carried as integer thousandths ("milli-units").
 *
 * Pure: no I/O, no `server-only`. Shared by catalogue, quotes and invoicing.
 */

/** 10 billion in major units. Far above any quote; well inside 2^53. */
export const MAX_MINOR = 1_000_000_000_000;
export const BPS_DENOMINATOR = 10_000;
export const MILLI = 1_000;
/** The largest quantity a line may carry (in whole units). */
export const MAX_QUANTITY = 1_000_000;

// BigInt constants without literal syntax: the repo tsconfig targets ES2017,
// where `0n` literals do not compile. Intermediate products (amount x bps)
// can pass 2^53, so they go through BigInt; results come back as safe numbers.
const B0 = BigInt(0);
const B1 = BigInt(1);
const B2 = BigInt(2);

export class MoneyError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MoneyError";
  }
}

export function assertMinor(value: number, label = "amount"): number {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("NOT_INTEGER", `${label} must be an integer number of minor units (got ${value}).`);
  }
  if (Math.abs(value) > MAX_MINOR) {
    throw new MoneyError("OUT_OF_RANGE", `${label} is outside the supported range.`);
  }
  return value;
}

function big(value: number, label: string): bigint {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError("NOT_INTEGER", `${label} must be a safe integer (got ${value}).`);
  }
  return BigInt(value);
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new MoneyError("OVERFLOW", "Result exceeds the safe integer range.");
  return n;
}

/**
 * round(a * b / d), halves rounded AWAY FROM ZERO ("round half up" for
 * positive values, the HMRC "nearest penny" convention). d must be > 0.
 */
export function mulDivRound(a: number, b: number, d: number): number {
  const A = big(a, "a");
  const B = big(b, "b");
  const D = big(d, "d");
  if (D <= B0) throw new MoneyError("BAD_DIVISOR", "Divisor must be positive.");
  const product = A * B;
  const negative = product < B0;
  const abs = negative ? -product : product;
  const q = (abs * B2 + D) / (B2 * D);
  return toSafeNumber(negative ? -q : q);
}

/** floor(a * b / d) for non-negative a, b; d > 0. */
export function mulDivFloor(a: number, b: number, d: number): number {
  const A = big(a, "a");
  const B = big(b, "b");
  const D = big(d, "d");
  if (A < B0 || B < B0) throw new MoneyError("NEGATIVE", "mulDivFloor takes non-negative operands.");
  if (D <= B0) throw new MoneyError("BAD_DIVISOR", "Divisor must be positive.");
  return toSafeNumber((A * B) / D);
}

/** Percentage of an amount in basis points, rounded half up. */
export function percentOf(amountMinor: number, bps: number): number {
  return mulDivRound(amountMinor, bps, BPS_DENOMINATOR);
}

/** part / whole in basis points, rounded half away from zero. null when whole is 0. */
export function ratioBps(part: number, whole: number): number | null {
  if (whole === 0) return null;
  if (whole < 0) throw new MoneyError("NEGATIVE", "ratioBps whole must be positive.");
  return mulDivRound(part, BPS_DENOMINATOR, whole);
}

/**
 * A quantity as integer thousandths. Accepts at most three decimal places;
 * anything finer is rejected rather than silently rounded.
 */
export function toMilli(quantity: number): number {
  if (!Number.isFinite(quantity)) throw new MoneyError("BAD_QUANTITY", "Quantity must be a finite number.");
  const scaled = quantity * MILLI;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) > 1e-6) {
    throw new MoneyError("BAD_QUANTITY", "Quantity may have at most three decimal places.");
  }
  return rounded;
}

/** unit price x quantity(milli), rounded half up to the minor unit. */
export function extend(unitMinor: number, quantityMilli: number): number {
  return mulDivRound(unitMinor, quantityMilli, MILLI);
}

/**
 * Split `total` across `weights` in proportion, largest-remainder method.
 * The parts always sum to `total` exactly. Ties go to the lower index, so
 * the result is deterministic. When total <= sum(weights), no part exceeds
 * its weight. All inputs must be non-negative integers.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const T = big(total, "total");
  if (T < B0) throw new MoneyError("NEGATIVE", "Cannot allocate a negative total.");
  const W = weights.map((w, i) => {
    const value = big(w, `weight ${i}`);
    if (value < B0) throw new MoneyError("NEGATIVE", "Weights must be non-negative.");
    return value;
  });
  const sum = W.reduce((a, b) => a + b, B0);
  if (sum === B0) {
    if (T === B0) return weights.map(() => 0);
    throw new MoneyError("NO_WEIGHT", "Cannot allocate a non-zero total across zero weights.");
  }
  const floors = W.map((w) => (T * w) / sum);
  const remainders = W.map((w, i) => ({ i, r: (T * w) % sum }));
  let left = T - floors.reduce((a, b) => a + b, B0);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === B0) break;
    floors[i] += B1;
    left -= B1;
  }
  return floors.map(toSafeNumber);
}

/**
 * Split several row totals across buckets so that every row sums to its
 * total AND every bucket sums to its total, with no negative cell. Each row
 * is allocated in proportion to what is still left in each bucket, so the
 * last row takes exactly the remainder. Used to split a deposit / balance /
 * instalments across VAT-rate buckets, and a credit note across an
 * invoice's rates.
 */
export function allocateMatrix(rowTotals: readonly number[], bucketTotals: readonly number[]): number[][] {
  const rowSum = rowTotals.reduce((a, b) => a + assertMinor(b, "row"), 0);
  const bucketSum = bucketTotals.reduce((a, b) => a + assertMinor(b, "bucket"), 0);
  if (rowSum !== bucketSum) {
    throw new MoneyError("MISMATCH", `Rows (${rowSum}) and buckets (${bucketSum}) must sum to the same total.`);
  }
  const remaining = [...bucketTotals];
  return rowTotals.map((row) => {
    const cells = allocate(row, remaining);
    cells.forEach((cell, b) => {
      remaining[b] -= cell;
    });
    return cells;
  });
}

/* ------------------------------------------------------------- formatting */

const CURRENCY_SYMBOL: Record<string, string> = { GBP: "£", EUR: "€", USD: "$" };
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);

export function minorDigits(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

/**
 * Deterministic money formatting (no Intl, so the public page, the PDF and
 * the test suite render the same bytes on every runtime): "£1,234.56".
 */
export function formatMinor(minor: number, currency: string): string {
  assertMinor(minor);
  const digits = minorDigits(currency);
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const divisor = 10 ** digits;
  const major = Math.floor(abs / divisor);
  const fraction = abs % divisor;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const body = digits > 0 ? `${grouped}.${String(fraction).padStart(digits, "0")}` : grouped;
  const symbol = CURRENCY_SYMBOL[currency];
  const text = symbol ? `${symbol}${body}` : `${body} ${currency}`;
  return negative ? `-${text}` : text;
}

/** "12.5%" from basis points, without floats. */
export function formatBps(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const frac = Math.abs(bps % 100);
  if (frac === 0) return `${whole}%`;
  const text = String(frac).padStart(2, "0").replace(/0$/, "");
  return `${bps < 0 && whole === 0 ? "-" : ""}${whole}.${text}%`;
}

/** Milli-quantity back to a display string ("7.5"). */
export function formatMilli(milli: number): string {
  const whole = Math.trunc(milli / MILLI);
  const frac = Math.abs(milli % MILLI);
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(3, "0").replace(/0+$/, "")}`;
}
