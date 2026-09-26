"use client";

import * as React from "react";
import {
  computeFloatingPosition,
  type FloatingPosition,
} from "./floating";

export type FloatingState = FloatingPosition & {
  anchorWidth: number;
  /** Theme scope class to copy onto the portalled layer (see themeClassFor). */
  theme: string | undefined;
};

/**
 * Keeps a portalled, `position: fixed` layer attached to its trigger while it
 * is open: re-measures on scroll (any ancestor, via capture), resize, and
 * whenever the layer's own content changes size (a filtered list shrinking).
 *
 * Returns null until the first measurement so the layer can render hidden
 * for one frame instead of flashing at 0,0.
 */
export function useFloatingPosition(
  open: boolean,
  anchorRef: React.RefObject<HTMLElement | null>,
  floatingRef: React.RefObject<HTMLElement | null>,
  options: {
    align?: "start" | "end";
    matchAnchorWidth?: boolean;
    maxHeight?: number;
    offset?: number;
  } = {},
): FloatingState | null {
  const { align = "start", matchAnchorWidth = false, maxHeight = 320, offset = 4 } =
    options;
  const [position, setPosition] = React.useState<FloatingState | null>(null);

  const update = React.useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const rect = anchor.getBoundingClientRect();
    const next = computeFloatingPosition({
      anchor: rect,
      floating: { width: floating.offsetWidth, height: floating.scrollHeight },
      viewport: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
      align,
      matchAnchorWidth,
      maxHeight,
      offset,
    });
    const withAnchor: FloatingState = {
      ...next,
      anchorWidth: rect.width,
      theme: themeClassFor(anchor),
    };
    setPosition((prev) =>
      prev &&
      prev.top === withAnchor.top &&
      prev.left === withAnchor.left &&
      prev.maxHeight === withAnchor.maxHeight &&
      prev.placement === withAnchor.placement &&
      prev.anchorWidth === withAnchor.anchorWidth &&
      prev.theme === withAnchor.theme
        ? prev
        : withAnchor,
    );
  }, [anchorRef, floatingRef, align, matchAnchorWidth, maxHeight, offset]);

  React.useLayoutEffect(() => {
    if (!open) return;
    update();
    const floating = floatingRef.current;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    if (floating) observer?.observe(floating);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      observer?.disconnect();
    };
  }, [open, update, floatingRef]);

  // A stale position from the previous opening is replaced by the layout
  // effect before paint; while closed there is nothing to place.
  return open ? position : null;
}

/**
 * Portalled layers render at the end of <body>, outside any scoped theme
 * wrapper. The onboarding/auth flows redefine the tokens under
 * `.ct-force-dark`; copying that class onto the layer keeps a listbox opened
 * there dark instead of flashing the light palette.
 */
export function themeClassFor(anchor: HTMLElement | null): string | undefined {
  if (!anchor) return undefined;
  return anchor.closest(".ct-force-dark") ? "ct-force-dark" : undefined;
}
