/**
 * Invoice (and credit-note) numbering: a per-workspace prefix and a
 * sequence. HMRC requires a unique, sequential number that identifies the
 * invoice. The rule here:
 *
 *   - DUPLICATES NEVER: `invoices (business_id, number)` is UNIQUE, and the
 *     sequence is allocated by one atomic `UPDATE invoice_counters SET
 *     next_seq = next_seq + 1 ... RETURNING` inside the issuing RPC.
 *   - GAPS ALLOWED: a number allocated by a transaction that then rolls
 *     back is not reused, and a draft never consumes a number (numbers are
 *     allocated at ISSUE, not at draft creation), so gaps are rare and
 *     explainable. auditSequence reports them for the admin view.
 *   - Changing the prefix starts a new series; a (prefix, seq) pair already
 *     used is still refused because the full number is unique.
 */

export const PREFIX_PATTERN = /^[A-Z0-9][A-Z0-9/-]{0,15}$/;
export const DEFAULT_INVOICE_PREFIX = "INV-";
export const DEFAULT_CREDIT_NOTE_PREFIX = "CN-";
export const DEFAULT_WIDTH = 5;

export type NumberCounter = { prefix: string; nextSeq: number; width: number };

export function validatePrefix(prefix: string): boolean {
  return PREFIX_PATTERN.test(prefix);
}

export function formatDocumentNumber(prefix: string, sequence: number, width = DEFAULT_WIDTH): string {
  if (!validatePrefix(prefix)) throw new Error("Prefix: capitals, digits, / and - only, at most 16 characters.");
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("Sequence must be a positive integer.");
  return `${prefix}${String(sequence).padStart(width, "0")}`;
}

/** Pure mirror of the atomic counter update: the number, and the counter after it. */
export function allocateNumber(counter: NumberCounter): { number: string; sequence: number; counter: NumberCounter } {
  const sequence = counter.nextSeq;
  return {
    number: formatDocumentNumber(counter.prefix, sequence, counter.width),
    sequence,
    counter: { ...counter, nextSeq: sequence + 1 },
  };
}

export function parseDocumentNumber(number: string, prefix: string): number | null {
  if (!number.startsWith(prefix)) return null;
  const digits = number.slice(prefix.length);
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalise(number: string): string {
  return number.trim().toUpperCase();
}

/** True when `candidate` is not already used (compared case-insensitively). */
export function isUnique(existing: Iterable<string>, candidate: string): boolean {
  const target = normalise(candidate);
  for (const number of existing) if (normalise(number) === target) return false;
  return true;
}

/** Duplicates (never allowed) and gaps (allowed, reported) in one series. */
export function auditSequence(numbers: readonly string[], prefix: string): { duplicates: string[]; gaps: number[] } {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const sequences: number[] = [];
  for (const number of numbers) {
    const key = normalise(number);
    if (seen.has(key)) duplicates.add(number);
    seen.add(key);
    const seq = parseDocumentNumber(number, prefix);
    if (seq !== null) sequences.push(seq);
  }
  const unique = [...new Set(sequences)].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < unique.length; i += 1) {
    for (let s = unique[i - 1] + 1; s < unique[i]; s += 1) gaps.push(s);
  }
  return { duplicates: [...duplicates], gaps };
}
