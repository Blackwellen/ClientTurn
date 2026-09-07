"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  trackCta,
  withCampaignParams,
  type CtaPlacement,
} from "@/lib/marketing/track";

/**
 * A call to action styled by this page's own stylesheet.
 *
 * It carries the same two behaviours as the shared `CtaLink` — campaign
 * parameters forwarded onto the signup URL, and a consent-gated click event —
 * but takes its appearance from `.fl-btn` rather than the site-wide button
 * utilities, so the page's button geometry cannot be half-overridden by
 * whichever stylesheet happens to load last.
 */
export function FlCta({
  placement,
  href = "/signup",
  variant = "primary",
  className,
  children,
}: {
  placement: CtaPlacement;
  href?: string;
  variant?: "primary" | "secondary";
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
      className={cn(
        "fl-btn",
        variant === "primary" ? "fl-btn-primary" : "fl-btn-secondary",
        className,
      )}
    >
      {children}
    </Link>
  );
}
