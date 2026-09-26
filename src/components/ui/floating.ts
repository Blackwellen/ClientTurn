/**
 * Placement maths for anything that floats over the page: select listboxes,
 * comboboxes and dropdown menus.
 *
 * Floating layers are portalled to <body> and positioned `fixed` from the
 * trigger's viewport rect. Rendering them in place (the old
 * `absolute mt-1` approach) meant a menu inside a scrolling table, a drawer
 * body or a card with `overflow-hidden` was clipped — and a menu near the
 * bottom of the viewport opened off-screen with no way to reach its last
 * items. This module is pure (no DOM) so the flip and clamp rules are unit
 * tested in tests/ui-primitives.test.ts.
 */

export type Rect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export type FloatingInput = {
  anchor: Rect;
  /** Natural size of the floating layer's content. */
  floating: { width: number; height: number };
  viewport: { width: number; height: number };
  /** Gap between trigger and layer. */
  offset?: number;
  /** Minimum distance kept from every viewport edge. */
  margin?: number;
  align?: "start" | "end";
  /** Listboxes are at least as wide as their trigger; menus size to content. */
  matchAnchorWidth?: boolean;
  /** Upper bound on the layer's height before it scrolls. */
  maxHeight?: number;
};

export type FloatingPosition = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

export function computeFloatingPosition({
  anchor,
  floating,
  viewport,
  offset = 4,
  margin = 8,
  align = "start",
  matchAnchorWidth = false,
  maxHeight = 320,
}: FloatingInput): FloatingPosition {
  const spaceBelow = Math.max(0, viewport.height - anchor.bottom - offset - margin);
  const spaceAbove = Math.max(0, anchor.top - offset - margin);
  const desired = Math.min(floating.height, maxHeight);

  // Prefer opening downward; flip only when the content does not fit below
  // and there is more room above.
  const placement: "top" | "bottom" =
    spaceBelow >= desired || spaceBelow >= spaceAbove ? "bottom" : "top";
  const available = placement === "bottom" ? spaceBelow : spaceAbove;
  const cappedMax = Math.max(0, Math.min(maxHeight, available));
  const height = Math.min(desired, cappedMax);

  const maxWidth = Math.max(0, viewport.width - margin * 2);
  const naturalWidth = matchAnchorWidth
    ? Math.max(anchor.width, floating.width)
    : floating.width;
  const width = Math.min(naturalWidth, maxWidth);

  const rawLeft = align === "end" ? anchor.right - width : anchor.left;
  const left = clamp(rawLeft, margin, Math.max(margin, viewport.width - margin - width));

  const top =
    placement === "bottom" ? anchor.bottom + offset : anchor.top - offset - height;

  return { top, left, width, maxHeight: cappedMax, placement };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Every floating layer carries this attribute so an enclosing popover or
 * menu does not treat a click inside a portalled child layer as an "outside"
 * click and close itself.
 */
export const FLOATING_ATTR = "data-lr-floating";

export function isInsideFloatingLayer(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return (target as Element).closest(`[${FLOATING_ATTR}]`) !== null;
}
