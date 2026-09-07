"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { trackCta, withCampaignParams, type CtaPlacement } from "@/lib/marketing/track";
import { buttonClass, type ButtonSize } from "./ui";

/**
 * A conversion link on the public site.
 *
 * Same contract as the older `marketing/cta` — campaign parameters are
 * carried onto the destination so a signup can be joined back to the ad that
 * paid for it, and the click is reported under the visitor's consent — but
 * styled from the public button system rather than the app's, so the two
 * never disagree about what a primary action looks like.
 */
export function PublicCta({
  placement,
  href = "/signup",
  variant = "primary",
  size = "lg",
  fullWidth,
  arrow,
  className,
  children,
}: {
  placement: CtaPlacement;
  href?: string;
  variant?: "primary" | "secondary" | "quiet";
  size?: ButtonSize;
  fullWidth?: boolean;
  arrow?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [resolved, setResolved] = React.useState(href);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- campaign params come from the browser URL, which does not exist during SSR.
    setResolved(withCampaignParams(href, placement));
  }, [href, placement]);

  return (
    <Link
      href={resolved}
      prefetch={false}
      onClick={() => trackCta(placement)}
      className={buttonClass(variant, size, fullWidth ? `w-full ${className ?? ""}` : className)}
    >
      {children}
      {arrow ? <ArrowRight aria-hidden className="size-4" /> : null}
    </Link>
  );
}
