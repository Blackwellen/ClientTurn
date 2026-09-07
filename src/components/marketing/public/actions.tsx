"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass, type ButtonSize } from "./ui";
import {
  trackCta,
  withCampaignParams,
  type CtaPlacement,
} from "@/lib/marketing/track";

/**
 * Tracked calls to action for the evaluation pages.
 *
 * Appearance comes from `buttonClass`, so these carry no styling of their own
 * and cannot drift from the buttons the rest of the public site uses. What
 * they add is the two things a marketing CTA needs and a plain link does not:
 * campaign parameters carried onto the destination, and a placement event.
 *
 * Campaign carry-over matters across pages, not just on the homepage — a
 * visitor who arrives from an ad and signs up three pages later is otherwise
 * unattributable.
 */

function useCampaignHref(href: string, placement: CtaPlacement) {
  const [resolved, setResolved] = React.useState(href);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- campaign params come from the browser URL, unavailable during SSR.
    setResolved(withCampaignParams(href, placement));
  }, [href, placement]);

  return resolved;
}

export function PrimaryCta({
  placement,
  href = "/signup",
  size = "md",
  children,
  className,
  withArrow = true,
}: {
  placement: CtaPlacement;
  href?: string;
  size?: ButtonSize;
  children: React.ReactNode;
  className?: string;
  withArrow?: boolean;
}) {
  const resolved = useCampaignHref(href, placement);

  return (
    <Link
      href={resolved}
      prefetch={false}
      onClick={() => trackCta(placement)}
      className={buttonClass("primary", size, className)}
    >
      {children}
      {withArrow && <ArrowRight aria-hidden className="size-4" />}
    </Link>
  );
}

/**
 * The secondary action. No campaign carry-over: /contact-sales and the
 * product pages are internal destinations that read attribution from the
 * session, not from the URL.
 */
export function SecondaryCta({
  placement,
  href,
  size = "md",
  children,
  className,
  withArrow = false,
}: {
  placement: CtaPlacement;
  href: string;
  size?: ButtonSize;
  children: React.ReactNode;
  className?: string;
  withArrow?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={false}
      onClick={() => trackCta(placement)}
      className={buttonClass("secondary", size, className)}
    >
      {children}
      {withArrow && <ArrowRight aria-hidden className="size-4" />}
    </Link>
  );
}

/**
 * An in-page anchor. Navigation within the page the visitor is already on, so
 * it deliberately fires no conversion event.
 */
export function AnchorCta({
  href,
  size = "md",
  children,
  className,
}: {
  href: string;
  size?: ButtonSize;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={href} className={buttonClass("secondary", size, className)}>
      {children}
    </a>
  );
}

/** The row a hero or panel ends on. */
export function ActionRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("mt-8 flex flex-wrap items-center gap-3", className)}
      {...props}
    />
  );
}
