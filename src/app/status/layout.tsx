import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
// The dark palette the rest of the public site uses. It lives with the
// marketing group rather than in globals, so it is imported explicitly here.
import "../(marketing)/clientturn.css";

/**
 * The public status shell.
 *
 * Still shares nothing functional with the customer app: no sidebar, no
 * workspace context, no session read. Someone reaching this page during an
 * incident may not be able to sign in — and may not have an account at all —
 * so it renders with no authenticated dependency whatsoever.
 *
 * What it does share is the *look*. It previously used a fixed light palette
 * on the theory that a status page gets screenshotted and embedded and should
 * look the same everywhere. In practice that made the one page customers are
 * sent to during an incident look like a different company's, so it now wears
 * the same chrome and the same dark palette as the rest of clientturn.com.
 */
export default function StatusLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ct-marketing flex min-h-dvh w-full flex-col">
      <a
        href="#status-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <MarketingHeader />
      {children}
      <MarketingFooter />
    </div>
  );
}
