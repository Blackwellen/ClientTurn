"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/observability/report-client-error";

/**
 * The last-resort boundary: an error thrown in the root layout, or in a
 * group layout such as `(app)/layout.tsx` (entitlement, health or
 * notification reads), which the route `error.tsx` files sit inside and so
 * cannot catch. It replaces the root layout, so it renders its own
 * <html>/<body> and styles itself inline: globals.css may be what failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="en-GB">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          background: "#0B1020",
          color: "#F7F9FC",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: 24,
        }}
      >
        <main style={{ maxWidth: 440, textAlign: "center" }}>
          <p style={{ color: "#B7F34A", fontWeight: 600, letterSpacing: "0.04em", margin: 0 }}>ClientTurn</p>
          <h1 style={{ fontSize: 24, margin: "16px 0 8px" }}>Something went wrong</h1>
          <p style={{ opacity: 0.8, lineHeight: 1.5, margin: 0 }}>
            The page could not be loaded. The problem has been logged.
            {error.digest ? ` If it keeps happening, quote reference ${error.digest} to support.` : " If it keeps happening, contact support."}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                background: "#B7F34A",
                color: "#0B1020",
                border: 0,
                borderRadius: 10,
                padding: "10px 18px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            {/* A full page load, not a client transition: the app shell is what failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                color: "#F7F9FC",
                border: "1px solid rgba(247,249,252,0.25)",
                borderRadius: 10,
                padding: "10px 18px",
                textDecoration: "none",
              }}
            >
              Go to the home page
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
