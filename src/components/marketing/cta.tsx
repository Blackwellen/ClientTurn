"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { trackCta, withCampaignParams, type CtaPlacement } from "@/lib/marketing/track";

type Variant = "primary" | "secondary" | "quiet";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-primary text-on-primary shadow-xs hover:bg-primary-hover active:bg-primary-active",
  secondary:
    "bg-surface text-content border border-line-strong shadow-xs hover:bg-surface-hover active:bg-surface-active",
  quiet:
    "text-content-secondary hover:text-content hover:bg-surface-hover",
};

const SIZES: Record<Size, string> = {
  md: "h-9 px-4 text-sm gap-2 rounded-md",
  lg: "h-11 px-6 text-[15px] gap-2 rounded-lg",
};

export function CtaLink({
  placement,
  href = "/signup",
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  children,
}: {
  placement: CtaPlacement;
  href?: string;
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
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
        "inline-flex items-center justify-center font-medium whitespace-nowrap",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        VARIANTS[variant],
        SIZES[size],
        fullWidth && "w-full",
        className,
      )}
    >
      {children}
    </Link>
  );
}
