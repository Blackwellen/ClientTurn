import type { ReactNode } from "react";

/**
 * The public status shell (V4 §22.4).
 *
 * Deliberately shares nothing with the customer app: no sidebar, no top bar,
 * no workspace context, no session read. Someone reaching this page during an
 * incident may not be able to sign in — and may not have an account at all —
 * so the page must render with no authenticated dependency whatsoever.
 *
 * Fixed light palette rather than the app's themed tokens: a status page is
 * quoted, screenshotted and embedded, and must look the same everywhere.
 */
export default function StatusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-slate-50 text-slate-900">
      <a
        href="#status-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-900 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      {children}
    </div>
  );
}
