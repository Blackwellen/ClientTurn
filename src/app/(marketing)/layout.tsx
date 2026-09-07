import type { ReactNode } from "react";
import { PublicHeader } from "@/components/marketing/public/public-header";
import { PublicFooter } from "@/components/marketing/public/public-footer";
import { CookieConsent } from "@/components/marketing/cookie-consent";
import "./clientturn.css";
import "./evaluation.css";

/**
 * The public shell.
 *
 * `.ct-marketing` is what remaps the shared design tokens onto the dark
 * public canvas, so every public route — homepage, product pages, the legal
 * pack, contact sales — must render inside it.
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="ct-marketing flex min-h-dvh w-full flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[70] focus:rounded-lg focus:bg-[var(--pub-lime)] focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[var(--pub-lime-ink)]"
      >
        Skip to content
      </a>
      <PublicHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <PublicFooter />
      <CookieConsent />
    </div>
  );
}
