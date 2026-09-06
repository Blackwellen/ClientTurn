import * as React from "react";
import Link from "next/link";
import type { Route } from "next";

/**
 * Every dashboard card header uses this one control, so "View all" can never
 * render at two different weights or with two different arrows.
 */
export function CardActionLink({
  href,
  children = "View all",
}: {
  href: Route | string;
  children?: React.ReactNode;
}) {
  return (
    <Link
      href={href as Route}
      className="text-content-accent hover:text-accent-800 focus-visible:outline-content-accent inline-flex items-center gap-1 rounded-xs text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
      <span aria-hidden>→</span>
    </Link>
  );
}
