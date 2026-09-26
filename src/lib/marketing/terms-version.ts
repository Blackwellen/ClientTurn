/**
 * The version of the Terms of Service a customer accepts, recorded on every
 * `terms_acceptances` row (signup and Checkout).
 *
 * Bump it whenever /terms changes materially. It is the date the current text
 * took effect, so an acceptance can always be matched to the words accepted.
 *
 * 2026-09-26: clause 5 (a card is taken before the trial; the trial converts
 * unless cancelled) and clause 7.6 (daily retry for up to 30 days).
 */
export const TERMS_VERSION = "2026-09-26";

export const TERMS_PATH = "/terms";
