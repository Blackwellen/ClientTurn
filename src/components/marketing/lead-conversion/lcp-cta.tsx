"use client";

import * as React from "react";
import Link from "next/link";
import {
  trackCta,
  withCampaignParams,
  type CtaPlacement,
} from "@/lib/marketing/track";

/**
 * The signup link for this page.
 *
 * It carries the same campaign parameters and click tracking as the shared
 * `CtaLink`, but brings no preset Tailwind sizing with it — the page styles its
 * buttons through `.lcp-btn`, and the two sets of single-class rules would
 * otherwise fight over height and padding depending on stylesheet order.
 */
export function LcpCta({
  placement,
  href = "/signup",
  className,
  children,
}: {
  placement: CtaPlacement;
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [resolved, setResolved] = React.useState(href);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- campaign params come from the browser URL, unavailable during SSR.
    setResolved(withCampaignParams(href, placement));
  }, [href, placement]);

  return (
    <Link
      href={resolved}
      prefetch={false}
      onClick={() => trackCta(placement)}
      className={className}
    >
      {children}
    </Link>
  );
}
