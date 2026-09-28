import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The one back affordance for detail pages, sub pages and wizards.
 *
 * It always links to a fixed parent (`href`), never the browser history: a page
 * opened from a notification, an email or a shared URL has no history to go
 * back to, and a history-based back button there is a dead end.
 *
 * 44px tall on touch screens, 13px medium muted text, arrow on the left,
 * matching the placement above the page heading everywhere in the app.
 */
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  /** "Back to Leads", "All agents", ... */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-back-link
      className={cn(
        "-ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[13px] font-medium text-content-muted",
        "transition-colors hover:text-content pointer-coarse:min-h-11",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        className,
      )}
    >
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
      {children}
    </Link>
  );
}
