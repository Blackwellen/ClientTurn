/**
 * The version of the Terms of Service a customer accepts, recorded on every
 * `terms_acceptances` row (signup and Checkout).
 *
 * Bump it whenever /terms changes materially. It is the date the current text
 * took effect, so an acceptance can always be matched to the words accepted.
 *
 * 2026-09-26: clause 5 (a card is taken before the trial; the trial converts
 * unless cancelled) and clause 7.6 (daily retry for up to 30 days).
 *
 * 2026-09-27: clause 9.9 (top-up credit is prepaid, does not expire, and is
 * non-refundable once any credit from a purchase has been used).
 */
export const TERMS_VERSION = "2026-09-27";

export const TERMS_PATH = "/terms";
