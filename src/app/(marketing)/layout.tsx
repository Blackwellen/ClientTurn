import type { ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/marketing-header";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import { CookieConsent } from "@/components/marketing/cookie-consent";
import "./clientturn.css";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ct-marketing flex min-h-dvh w-full flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingFooter />
      <CookieConsent />
    </div>
  );
}
