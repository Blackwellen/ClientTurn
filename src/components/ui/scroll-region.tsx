"use client";

import * as React from "react";
import { useScrollableRegion } from "./use-scrollable-region";

/**
 * A scrolling box that a keyboard can scroll.
 *
 * Wide tables, reference panels and card rails scroll inside an
 * `overflow-x: auto` wrapper at narrow widths and 200-400% zoom. A plain
 * element is not focusable, so in Firefox and Safari the part scrolled out of
 * view could not be reached without a pointer (SC 2.1.1; axe
 * `scrollable-region-focusable`). This takes a tab stop only while the content
 * actually overflows (see `useScrollableRegion`), so a table that fits costs
 * nothing.
 *
 * By default it adds only the tab stop: focus lands on a box whose content (a
 * table, a list) announces itself. Pass `region` with a `label` to also make it
 * a named `region` landmark -- only where that name is unique on the page, as
 * several identically named landmarks are their own failure (axe
 * `landmark-unique`). On a list (`as="ol" | "ul"`) the label names the list.
 *
 * A client leaf, so server components (legal pages, the Table primitive) can
 * use it without becoming client components themselves.
 */
export function ScrollRegion({
  as = "div",
  label,
  region = false,
  className,
  style,
  children,
}: {
  as?: "div" | "ol" | "ul";
  label?: string;
  region?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const landmark = !(region && label && as === "div");
  const { attach, props } = useScrollableRegion(label ?? "", { landmark });
  const Tag = as;
  return (
    <Tag
      ref={attach as React.Ref<never>}
      className={className}
      style={style}
      aria-label={as !== "div" ? label : undefined}
      {...props}
    >
      {children}
    </Tag>
  );
}
