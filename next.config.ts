import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The deployment was shipping HSTS and nothing else. For an authenticated app
 * whose URLs carry prospect, lead and session identifiers, three of these are
 * not hardening — they close specific, reachable problems:
 *
 *   * **Clickjacking.** Without a framing rule, any site can load ClientTurn in
 *     an invisible iframe over its own controls and harvest clicks from a
 *     logged-in session. `frame-ancestors` is the enforced modern form;
 *     `X-Frame-Options` covers browsers that predate it. Nothing in the product
 *     is embedded anywhere, so denying outright costs nothing.
 *
 *   * **Referrer leakage.** `/app/leads?lead=<uuid>` and
 *     `/app/find-leads/runs/<uuid>` identify real records. The browser default
 *     sends the full path to any third-party origin a page touches — a font, an
 *     image, an outbound link a customer clicks. `strict-origin-when-cross-origin`
 *     sends the origin alone off-site while keeping full referrers internally.
 *
 *   * **MIME sniffing.** Customers upload CSVs and logos that are served back
 *     through signed URLs. `nosniff` stops a browser deciding that a file the
 *     server labelled `text/plain` is really HTML, and running it.
 *
 * `Permissions-Policy` denies hardware the product never asks for, so a future
 * dependency cannot quietly prompt a customer for their camera.
 *
 * Deliberately NOT a full Content-Security-Policy. A `script-src` strict enough
 * to be worth having needs per-request nonces threaded through the Next.js
 * runtime and the Three.js marketing scene; a half-strict one that has to be
 * loosened with `unsafe-inline` provides no real protection while implying it
 * does. That is a separate, testable piece of work — `frame-ancestors` is
 * carried here on its own because it stands alone and needs no nonce.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // Vercel sets HSTS at the edge; stating it here keeps the policy in the
  // repository rather than only in a dashboard someone has to remember to read.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
