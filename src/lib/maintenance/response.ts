/**
 * What the proxy sends back when maintenance refuses a request.
 *
 * Every refusal is an HTTP 503 with `Retry-After`, `Cache-Control: no-store`
 * and `X-Robots-Tag: noindex`. That combination is what search engines read as
 * "temporarily unavailable, come back later", so a SITE_OFFLINE window does
 * not drop pages from the index the way a 200 maintenance page (soft 404) or a
 * redirect would.
 *
 * The maintenance page is self-contained HTML with inline styles: it must
 * render when the thing being maintained is the app itself, so it depends on
 * no React tree, no stylesheet bundle and no database read.
 *
 * Pure: relative imports only.
 */

import type { MaintenanceDecision } from "./routes.ts";
import { expectedBack, formatLondon, retryAfterSeconds } from "./schedule.ts";
import { WRITES_PAUSED_MESSAGE, type MaintenanceStatus } from "./types.ts";

export type MaintenanceResponseSpec = {
  status: 503;
  headers: Record<string, string>;
  body: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The sentence people read about when things are back. */
export function backLine(status: MaintenanceStatus): string | null {
  const back = expectedBack(status.active);
  return back ? `We expect to be back by ${formatLondon(back)} (UK time).` : null;
}

/** The friendly refusal a Server Action, form or API write receives. */
export function writesPausedText(status: MaintenanceStatus): string {
  const back = backLine(status);
  return back
    ? `${WRITES_PAUSED_MESSAGE} Nothing was saved. ${back}`
    : `${WRITES_PAUSED_MESSAGE} Nothing was saved. Please try again shortly.`;
}

export function maintenancePageHtml(input: {
  status: MaintenanceStatus;
  /** "offline": the page is unavailable. "writes_paused": a change was refused. */
  kind: "offline" | "writes_paused";
}): string {
  const window = input.status.active;
  const title =
    input.kind === "writes_paused"
      ? "Changes are paused for maintenance"
      : "ClientTurn is down for planned maintenance";
  const lead =
    input.kind === "writes_paused"
      ? "We are carrying out planned maintenance, so nothing can be saved right now. Your data is safe, and what you just tried was not saved, so please try again once we are back."
      : "We are carrying out planned maintenance to keep ClientTurn fast and reliable. Your data is safe, and leads, payments and opt-outs that arrive now are still being received.";
  const message = window?.message?.trim() ? escapeHtml(window.message.trim()) : null;
  const back = backLine(input.status);

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Planned maintenance · ClientTurn</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    min-height: 100dvh; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; background: #050814; color: #F7F9FC;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  main {
    width: 100%; max-width: 560px; padding: 32px 28px; border-radius: 16px;
    background: #0B1020; border: 1px solid rgb(117 148 180 / 0.18);
    box-shadow: 0 24px 64px -32px rgb(0 0 0 / 0.9);
  }
  .brand { display: flex; width: fit-content; align-items: center; }
  .brand img { display: block; height: 40px; width: 120px; }
  .pill { display: flex; width: fit-content; align-items: center; gap: 8px; margin-top: 28px; padding: 4px 12px; border-radius: 999px; background: rgb(183 243 74 / 0.12); color: #E7FFC0; font-size: 13px; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: #B7F34A; }
  h1 { margin: 14px 0 10px; font-size: clamp(24px, 5vw, 30px); line-height: 1.2; letter-spacing: -0.02em; }
  p { margin: 0 0 14px; color: #C5CEDB; }
  .note { margin: 18px 0; padding: 14px 16px; border-radius: 12px; background: rgb(247 249 252 / 0.05); border: 1px solid rgb(117 148 180 / 0.18); color: #F7F9FC; white-space: pre-line; }
  .back { color: #E7FFC0; font-weight: 600; }
  .links { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 24px; }
  a.btn { display: inline-flex; align-items: center; min-height: 44px; padding: 0 18px; border-radius: 10px; font-weight: 600; font-size: 15px; text-decoration: none; }
  a.primary { background: #B7F34A; color: #0B1020; }
  a.secondary { color: #F7F9FC; border: 1px solid rgb(117 148 180 / 0.35); }
  a:focus-visible { outline: 2px solid #B7F34A; outline-offset: 3px; }
  @media (prefers-reduced-motion: no-preference) { .dot { animation: pulse 2s ease-in-out infinite; } }
  @keyframes pulse { 50% { opacity: 0.35; } }
</style>
</head>
<body>
<main role="main" aria-labelledby="maintenance-title">
  <a class="brand" href="/status"><img src="/dark_background_logo.png" alt="ClientTurn" width="120" height="40"></a>
  <div class="pill" role="status"><span class="dot" aria-hidden="true"></span>Planned maintenance</div>
  <h1 id="maintenance-title">${title}</h1>
  <p>${lead}</p>
  ${message ? `<div class="note">${message}</div>` : ""}
  ${back ? `<p class="back">${escapeHtml(back)}</p>` : ""}
  <div class="links">
    <a class="btn primary" href="/status">Check live status</a>
    <a class="btn secondary" href="mailto:support@clientturn.com">Email support</a>
  </div>
</main>
</body>
</html>`;
}

/**
 * The full response for a refused request.
 *
 *   * a Server Action gets `text/plain` exactly: that is the one content type
 *     Next's client turns into the thrown error's message, so the person sees
 *     "changes are paused" rather than "An unexpected response was received";
 *   * a browser navigation gets the maintenance page;
 *   * an API client gets JSON it can branch on.
 */
export function maintenanceResponse(input: {
  decision: Extract<MaintenanceDecision, { action: "offline" | "writes_paused" }>;
  status: MaintenanceStatus;
  now: Date;
  method: string;
  isServerAction: boolean;
  acceptsHtml: boolean;
}): MaintenanceResponseSpec {
  const retryAfter = retryAfterSeconds(input.status, input.now);
  const headers: Record<string, string> = {
    "Retry-After": String(retryAfter),
    "Cache-Control": "no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow",
    "X-ClientTurn-Maintenance": input.status.level,
  };
  const head = input.method.toUpperCase() === "HEAD";

  if (input.isServerAction) {
    headers["Content-Type"] = "text/plain";
    return { status: 503, headers, body: head ? null : writesPausedText(input.status) };
  }

  if (input.acceptsHtml) {
    headers["Content-Type"] = "text/html; charset=utf-8";
    return {
      status: 503,
      headers,
      body: head ? null : maintenancePageHtml({ status: input.status, kind: input.decision.action }),
    };
  }

  headers["Content-Type"] = "application/json; charset=utf-8";
  const message =
    input.decision.action === "writes_paused"
      ? writesPausedText(input.status)
      : `ClientTurn is down for planned maintenance. ${backLine(input.status) ?? "Please try again shortly."}`;
  return {
    status: 503,
    headers,
    body: head
      ? null
      : JSON.stringify({
          error: {
            code: input.decision.action === "writes_paused" ? "maintenance_read_only" : "maintenance",
            message,
            retry_after_seconds: retryAfter,
            expected_back_at: expectedBack(input.status.active),
          },
        }),
  };
}
