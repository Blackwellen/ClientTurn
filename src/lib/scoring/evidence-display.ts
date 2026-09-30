/**
 * Puts a score evidence value into words for the lead page's "Why this score".
 *
 * Evidence values are stored as plain strings ("9000", "1", "2", "QUALIFIED").
 * Shown raw they read as internals: "estimated value: 9000", "qualification
 * answers met: 1", "recency of last reply: 2". The label says what the number
 * is, so the label picks the format. Pure, so it is unit-tested.
 */
const MONEY_LABELS = new Set(["estimated value"]);
const RATIO_LABELS = new Set([
  "qualification answers met",
  "buying-intent signal",
  "intent assessment",
]);

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString("en-GB")} ${count === 1 ? one : many}`;
}

export function formatEvidenceValue(label: string, value: string): string {
  const trimmed = value.trim();
  const numeric = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null;

  if (numeric !== null) {
    if (MONEY_LABELS.has(label)) {
      return `£${Math.round(numeric).toLocaleString("en-GB")}`;
    }
    if (RATIO_LABELS.has(label) && numeric >= 0 && numeric <= 1) {
      return `${Math.round(numeric * 100)}%`;
    }
    if (label === "recency of last reply") {
      const days = Math.max(0, Math.round(numeric));
      return days === 0 ? "today" : `${plural(days, "day", "days")} ago`;
    }
    if (label === "timeline") {
      return `within ${plural(Math.round(numeric), "day", "days")}`;
    }
    return numeric.toLocaleString("en-GB");
  }

  // Enum codes such as "QUALIFIED" or "NOT_QUALIFIED" read as words.
  return /^[A-Z][A-Z_]+$/.test(trimmed)
    ? trimmed.replace(/_/g, " ").toLowerCase()
    : trimmed;
}
