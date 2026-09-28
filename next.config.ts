import type { NextConfig } from "next";

/**
 * Security headers (docs/SECURITY_HEADERS.md has the full reasoning and the
 * flows checked against them).
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
 * dependency cannot quietly prompt a customer for their camera. (Voice calls
 * are placed by the provider over the phone network, not in the browser, so
 * the microphone stays denied. If a browser voice SDK is ever added, allow
 * `microphone=(self)` on that route only.)
 *
 * CONTENT-SECURITY-POLICY, in two parts:
 *
 *   ENFORCED: `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`.
 *   None of these can break a page: nothing embeds ClientTurn, nothing uses
 *   <object>/<embed>, and nothing sets a <base>. They remove plugin content
 *   and base-tag hijacking as injection vectors.
 *
 *   REPORT-ONLY: a full policy (`reportOnlyCsp`). A `script-src` strict enough
 *   to matter needs per-request nonces threaded through the Next runtime and
 *   the Three.js marketing scene; enforcing a guessed policy risks a blank
 *   landing page or a broken checkout. Report-only shows every violation in
 *   the browser console (and in Sentry when a DSN is set) without blocking
 *   anything, so the policy can be tightened on evidence and then enforced.
 *   `form-action` lives here too, not in the enforced set: Chrome applies it to
 *   the redirect chain after a form post, and sign-in (Supabase -> Google),
 *   Stripe Checkout / Billing Portal and ~15 integration OAuth connect flows
 *   all leave the origin that way.
 */

const isDev = process.env.NODE_ENV !== "production";

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const supabaseOrigin = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^http/, "ws") : null;

/**
 * Sentry's CSP report endpoint, derived from the DSN (a public identifier).
 * `https://<key>@<host>/<project>` -> `https://<host>/api/<project>/security/?sentry_key=<key>`.
 */
function sentryCspReportUri(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\//, "");
    if (!url.username || !project) return null;
    return `${url.protocol}//${url.host}/api/${project}/security/?sentry_key=${url.username}`;
  } catch {
    return null;
  }
}

const sentryDsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || "";
const sentryOrigin = origin(sentryDsn);
const cspReportUri = sentryCspReportUri(sentryDsn);

const enforcedCsp = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join("; ");

const reportOnlyCsp = [
  "default-src 'self'",
  // 'unsafe-inline' until nonces: Next's inline bootstrap scripts need it.
  // 'unsafe-eval' in development only (React dev tooling / HMR).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  // Logos and recordings come from short-lived R2 signed URLs (https:);
  // QR codes and uploads preview as data:/blob:.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "media-src 'self' blob: https:",
  [
    "connect-src 'self'",
    supabaseOrigin,
    supabaseWs,
    sentryOrigin,
    isDev ? "ws: http://localhost:*" : null,
  ]
    .filter(Boolean)
    .join(" "),
  // Three.js / Motion may spin workers from blob: URLs.
  "worker-src 'self' blob:",
  "frame-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  [
    "form-action 'self'",
    supabaseOrigin,
    "https://accounts.google.com",
    "https://checkout.stripe.com",
    "https://billing.stripe.com",
  ]
    .filter(Boolean)
    .join(" "),
  cspReportUri ? `report-uri ${cspReportUri}` : null,
]
  .filter(Boolean)
  .join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: enforcedCsp },
  { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp },
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
  // The browser Sentry DSN (public by design). Empty when SENTRY_DSN is unset,
  // which keeps src/instrumentation-client.ts from loading the SDK at all.
  env: {
    NEXT_PUBLIC_SENTRY_DSN: sentryDsn,
  },
  // Article text is statically bundled; screenshot headers are still read
  // from disk to reserve figure dimensions in server-rendered articles.
  outputFileTracingIncludes: {
    // Screenshot headers are read for width/height so figures reserve space.
    "/**": ["./public/help/screenshots/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

/**
 * Sentry's build plugin (source-map upload) is only wired in when a DSN is
 * configured; without one the build is exactly as before. Source maps upload
 * only when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are also set, and
 * are deleted from the deployment after upload.
 */
async function withOptionalSentry(config: NextConfig): Promise<NextConfig> {
  if (!sentryDsn) return config;
  const { withSentryConfig } = await import("@sentry/nextjs/config");
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI,
    telemetry: false,
    widenClientFileUpload: true,
    sourcemaps: { deleteSourcemapsAfterUpload: true },
  });
}

export default async function config(): Promise<NextConfig> {
  return withOptionalSentry(nextConfig);
}
