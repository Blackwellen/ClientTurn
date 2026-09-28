"use client";

import * as React from "react";
import { BypassPill } from "./bypass-pill";

/** The cookie the proxy sets on an admin-bypass response (proxy-gate.ts). */
export const BYPASS_HINT_COOKIE = "ct-maintenance-bypass";

const LABELS: Record<string, string> = {
  APP_OFFLINE: "App offline",
  SITE_OFFLINE: "Site offline",
};

/**
 * The website's "Maintenance bypass" pill. The marketing pages are static, so
 * they cannot ask the server who is looking; instead the proxy, having
 * verified a platform-admin session itself, drops a short-lived display hint
 * cookie on the bypass response. The hint decides only whether this label is
 * drawn: access was already decided in the proxy, and forging the cookie
 * shows a pill and nothing else.
 */
export function MarketingBypassPill() {
  const label = React.useSyncExternalStore(noopSubscribe, readHint, () => null);
  return label ? <BypassPill label={label} /> : null;
}

function noopSubscribe(): () => void {
  return () => {};
}

function readHint(): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${BYPASS_HINT_COOKIE}=([A-Z_]+)`));
    return (match && LABELS[match[1]]) || null;
  } catch {
    // No cookie access: no pill.
    return null;
  }
}
