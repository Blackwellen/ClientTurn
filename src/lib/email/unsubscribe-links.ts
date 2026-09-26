/**
 * Pure helpers for the unsubscribe and complaint paths. No `server-only`, so
 * the unit tests can import them.
 */

/** The shape every unsubscribe token has: a UUID from the database. */
export function isUnsubscribeToken(token: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(token);
}

/**
 * The RFC 8058 one-click endpoint for a visible unsubscribe page URL.
 *
 * The page (`/unsubscribe/<token>`) only confirms on GET — link scanners and
 * mail-client previews prefetch GETs, and one must never unsubscribe anybody.
 * Gmail and Yahoo's one-click button POSTs `List-Unsubscribe=One-Click` to the
 * URL in `List-Unsubscribe`, which therefore has to be a route that accepts
 * POST: `/api/unsubscribe/<token>`. A page and a route handler cannot share a
 * path in the App Router, hence two URLs for the one token.
 *
 * A URL that is not in the page shape is returned unchanged.
 */
export function oneClickUnsubscribeUrl(pageUrl: string): string {
  return pageUrl.replace(/\/unsubscribe\/([^/?#]+)(?=$|[?#])/, "/api/unsubscribe/$1");
}

/**
 * True for an ARF (RFC 5965) abuse report, or a feedback-loop message that
 * says the same thing in its subject.
 *
 * Deliberately narrow: a complaint suppresses permanently, so an ordinary
 * reply that happens to mention "spam" must never match.
 */
export function isAbuseReport(subject: string | null, body: string): boolean {
  if (/^\s*feedback-type:\s*abuse\b/im.test(body)) return true;
  const title = (subject ?? "").toLowerCase();
  return /\b(abuse report|complaint about message|spam complaint)\b/.test(title) &&
    /^\s*(original-rcpt-to|original-mail-from|feedback-type):/im.test(body);
}

/**
 * The recipient who complained, from an abuse report.
 *
 * `Original-Rcpt-To` is the ARF field for exactly this. Failing that, the `To:`
 * header of the embedded original message. Never the report's own sender —
 * that is the mailbox provider's feedback loop, not the person.
 */
export function complainedAddress(body: string): string | null {
  const match =
    body.match(/^\s*original-rcpt-to:\s*<?([\w.+-]+@[\w.-]+\.[a-z]{2,})>?/im) ??
    body.match(/^\s*to:\s*(?:[^<\n]*<)?([\w.+-]+@[\w.-]+\.[a-z]{2,})>?/im);
  return match ? match[1].trim().toLowerCase() : null;
}
