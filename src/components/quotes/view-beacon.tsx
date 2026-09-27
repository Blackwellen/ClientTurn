"use client";

import * as React from "react";

/**
 * Records "the customer opened the quote" once per browser session: a
 * sessionStorage flag keyed by a hash of the link (never the link itself),
 * then one POST with the page's nonce. The server records the first view
 * only (SENT -> VIEWED), so a second session is harmless too. Link scanners
 * that fetch the page without running scripts never trigger it.
 */
export function ViewBeacon({ token, nonce }: { token: string; nonce: string }) {
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      let key = "ct-quote-viewed";
      try {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        key += `:${Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}`;
        if (sessionStorage.getItem(key)) return;
      } catch {
        // Storage unavailable (private mode): still record; the server is idempotent.
      }
      if (cancelled) return;
      await fetch(`/q/${encodeURIComponent(token)}/view`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-clientturn-quote": "1" },
        credentials: "same-origin",
        body: JSON.stringify({ nonce }),
      }).catch(() => undefined);
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, nonce]);
  return null;
}
