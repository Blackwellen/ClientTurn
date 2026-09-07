"use client";

import * as React from "react";

type Options = {
  /**
   * Set when the scroll container is already a landmark element (`<nav>`,
   * `<main>`, `<aside>`). Overwriting those with `role="region"` would strip
   * the landmark out of the accessibility tree — the navigation rail would
   * stop being navigation — so those elements get the tab stop only and keep
   * whatever accessible name they already carry.
   */
  landmark?: boolean;
};

/**
 * Makes an overflow container reachable by keyboard, but only while it is
 * actually scrollable.
 *
 * A `div` with `overflow-y: auto` is not focusable, so in Firefox, Safari and
 * older Chromium there is no way to scroll it with the arrow keys, Page
 * Up/Down or Home/End at all — a WCAG 2.2 SC 2.1.1 (Keyboard) failure that
 * bites hardest exactly where it matters: the navigation rail at high zoom,
 * where the content that has scrolled out of view is the rest of the menu.
 *
 * The fix has to be conditional. Giving every scroll container a permanent tab
 * stop adds a dead stop to the tab order on the (common) occasions when the
 * content fits, which is its own annoyance. So this measures the element and
 * only exposes the tab stop, the `region` role and the accessible name while
 * the content genuinely overflows.
 *
 * `attach` is a callback ref backed by state rather than a `useRef` object,
 * so the measurement re-runs if the element is swapped out, and nothing here
 * reads a ref during render. It is deliberately not named `ref`: the
 * react-hooks lint rule treats any `.ref` property access as reading a ref's
 * `current` during render, which this is not.
 *
 * @param label Accessible name announced when the region takes focus. Ignored
 *              for landmark elements, which already have one.
 */
export function useScrollableRegion(
  label: string,
  { landmark = false }: Options = {},
) {
  const [node, setNode] = React.useState<HTMLElement | null>(null);
  const [scrollable, setScrollable] = React.useState(false);

  React.useEffect(() => {
    if (!node) return;

    const measure = () => {
      // 1px of slack: sub-pixel layout at fractional zoom levels routinely
      // leaves scrollHeight a hair above clientHeight on content that visibly
      // fits, and a tab stop that appears only at 110% zoom is worse than none.
      setScrollable(node.scrollHeight - node.clientHeight > 1);
    };

    measure();

    // Both are needed: the box itself resizes with the viewport and with the
    // rail's density tiers, while its contents resize when nav items are
    // added or removed by an entitlement change.
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);

    return () => observer.disconnect();
  }, [node]);

  const props = scrollable
    ? landmark
      ? ({ tabIndex: 0 } as const)
      : ({ tabIndex: 0, role: "region", "aria-label": label } as const)
    : ({} as const);

  return { attach: setNode, props, scrollable };
}
