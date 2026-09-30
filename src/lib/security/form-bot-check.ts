/**
 * The bot checks shared by the public forms (/contact-sales, /privacy-request).
 *
 * Pure, so it is tested directly. Two signals:
 *
 *   * a honeypot field a person never sees, so never fills;
 *   * `startedAt`, the time the form mounted in the browser. A submission
 *     sooner than `minSeconds` after it is a script.
 *
 * A missing, unparseable or future `startedAt` is `"no-timing"`, not a pass.
 * Before surface QA 2026-09-30 both forms only ran the timing check when the
 * field was present, so a script that simply left it out skipped it entirely.
 * The caller decides what to say for `"no-timing"`: it is also what a person
 * with JavaScript disabled sends, so it must never be a silent drop.
 */

export type FormBotVerdict = "ok" | "honeypot" | "too-fast" | "no-timing";

/** Clock skew tolerated between the browser and the server. */
const FUTURE_TOLERANCE_MS = 60_000;

export function formBotVerdict(input: {
  honeypot: FormDataEntryValue | null;
  startedAt: FormDataEntryValue | null;
  minSeconds: number;
  now?: number;
}): FormBotVerdict {
  if (typeof input.honeypot === "string" && input.honeypot.trim().length > 0) return "honeypot";

  const now = input.now ?? Date.now();
  const raw = typeof input.startedAt === "string" ? input.startedAt.trim() : "";
  const startedAt = /^\d{10,16}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + FUTURE_TOLERANCE_MS) return "no-timing";

  if (now - startedAt < input.minSeconds * 1000) return "too-fast";
  return "ok";
}
