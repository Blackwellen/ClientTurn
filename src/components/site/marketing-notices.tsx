import * as React from "react";
import { getMarketingNotices } from "@/lib/banners/server";
import { bannerDismissStorageKey, stackNotices } from "@/lib/banners/select";
import type { StackItem } from "@/lib/banners/types";
import { PlatformBanner } from "./platform-banner";
import { MarketingBypassPill } from "./marketing-bypass-pill";

/**
 * The website top bar: at most one admin banner (audience Everyone or Website
 * visitors) and, 24 hours before a SITE_OFFLINE window, the maintenance
 * notice. Read from the tagged Next data cache, so the marketing pages stay
 * static and a banner change reaches them when its tag is revalidated.
 *
 * A visitor's dismissal lives in localStorage. The inline script after each
 * dismissible banner hides it before first paint when it was dismissed on an
 * earlier visit, so a dismissed banner never flashes in and then jumps away.
 */
export async function MarketingNotices() {
  const notices = await getMarketingNotices().catch(() => ({ banner: null, maintenance: null }));

  type Item = StackItem & {
    node: React.ReactNode;
  };
  const items: Item[] = [];

  const slot = (key: string, dismissible: boolean, banner: React.ReactNode) => (
    <React.Fragment key={key}>
      <div data-banner-slot={key} suppressHydrationWarning>
        {banner}
      </div>
      {dismissible ? (
        <script
          // Pre-paint: hide a banner this visitor dismissed before. The key is
          // a uuid or `maintenance:<uuid>:upcoming`, JSON-encoded regardless.
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem(${JSON.stringify(bannerDismissStorageKey(key))})){var s=document.currentScript;var e=s&&s.previousElementSibling;if(e)e.hidden=true}}catch(_){}`,
          }}
        />
      ) : null}
    </React.Fragment>
  );

  if (notices.maintenance) {
    const m = notices.maintenance;
    items.push({
      key: m.id,
      source: "maintenance",
      tone: m.tone,
      priority: 1000,
      node: slot(
        m.id,
        m.dismissible,
        <PlatformBanner
          dismissKey={m.id}
          title={m.title}
          body={m.body}
          linkUrl={m.linkUrl}
          linkLabel={m.linkLabel}
          tone={m.tone}
          dismissible={m.dismissible}
          dismissMode="local"
          variant="marketing"
        />,
      ),
    });
  }

  if (notices.banner) {
    const b = notices.banner;
    items.push({
      key: b.id,
      source: "platform",
      tone: b.tone,
      priority: b.priority,
      node: slot(
        b.id,
        b.dismissible,
        <PlatformBanner
          dismissKey={b.id}
          title={b.title}
          body={b.body}
          linkUrl={b.linkUrl}
          linkLabel={b.linkLabel}
          tone={b.tone}
          dismissible={b.dismissible}
          dismissMode="local"
          variant="marketing"
        />,
      ),
    });
  }

  const { visible } = stackNotices(items);

  return (
    <>
      {visible.length > 0 ? <div className="relative z-[61]">{visible.map((item) => item.node)}</div> : null}
      <MarketingBypassPill />
    </>
  );
}
