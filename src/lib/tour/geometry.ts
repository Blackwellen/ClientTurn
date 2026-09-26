/**
 * Coachmark positioning maths (Phase 8.4).
 *
 * Kept pure so it can be tested without a browser: every function takes
 * rectangles and a viewport and returns rectangles and coordinates. The
 * component measures, calls these, and applies the result.
 *
 * Coordinates are viewport-relative (what `getBoundingClientRect` returns),
 * because the overlay is `position: fixed`.
 */

export type Rect = { top: number; left: number; width: number; height: number };
export type Size = { width: number; height: number };
export type Side = "top" | "bottom" | "left" | "right";

/** Below this width the caption is always a bottom sheet. */
export const NARROW_BREAKPOINT = 640;
export const SPOTLIGHT_PADDING = 8;
export const POPOVER_GAP = 14;
export const VIEWPORT_MARGIN = 12;
/** How far the arrow is kept from the popover's corners. */
export const ARROW_INSET = 20;

export function isNarrow(viewport: Size): boolean {
  return viewport.width < NARROW_BREAKPOINT;
}

/** A target worth pointing at: has size and is at least partly on screen. */
export function isVisibleRect(rect: Rect | null | undefined, viewport: Size): rect is Rect {
  if (!rect || rect.width <= 0 || rect.height <= 0) return false;
  return (
    rect.left < viewport.width &&
    rect.top < viewport.height &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0
  );
}

/** Whether a target is wholly inside the viewport (so no scroll is needed). */
export function isFullyInView(rect: Rect, viewport: Size, margin = 0): boolean {
  return (
    rect.top >= margin &&
    rect.left >= margin &&
    rect.top + rect.height <= viewport.height - margin &&
    rect.left + rect.width <= viewport.width - margin
  );
}

/** The cut-out: the target plus padding, clipped to the viewport. */
export function spotlightRect(target: Rect, viewport: Size, padding = SPOTLIGHT_PADDING): Rect {
  const left = Math.max(0, target.left - padding);
  const top = Math.max(0, target.top - padding);
  const right = Math.min(viewport.width, target.left + target.width + padding);
  const bottom = Math.min(viewport.height, target.top + target.height + padding);
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * SVG path for a full-viewport dim with a rounded-rectangle hole. Drawn with
 * `fill-rule="evenodd"`, so the hole is transparent.
 */
export function cutoutPath(viewport: Size, hole: Rect | null, radius = 12): string {
  const outer = `M0 0H${viewport.width}V${viewport.height}H0Z`;
  if (!hole || hole.width <= 0 || hole.height <= 0) return outer;
  const r = Math.max(0, Math.min(radius, hole.width / 2, hole.height / 2));
  const { left: x, top: y, width: w, height: h } = hole;
  const round = (n: number) => Math.round(n * 100) / 100;
  return (
    `${outer}M${round(x + r)} ${round(y)}H${round(x + w - r)}` +
    `A${r} ${r} 0 0 1 ${round(x + w)} ${round(y + r)}V${round(y + h - r)}` +
    `A${r} ${r} 0 0 1 ${round(x + w - r)} ${round(y + h)}H${round(x + r)}` +
    `A${r} ${r} 0 0 1 ${round(x)} ${round(y + h - r)}V${round(y + r)}` +
    `A${r} ${r} 0 0 1 ${round(x + r)} ${round(y)}Z`
  );
}

export type Placement =
  | {
      mode: "anchored";
      side: Side;
      top: number;
      left: number;
      /** Arrow offset along the popover edge facing the target, in px. */
      arrow: number;
    }
  | {
      /**
       * No room beside the target, no target, or a narrow screen: the caption
       * floats at the bottom of the viewport (a bottom sheet on phones) and
       * the spotlight still shows what it is talking about.
       */
      mode: "floating";
    };

const clamp = (value: number, min: number, max: number) =>
  max < min ? min : Math.min(Math.max(value, min), max);

function positionFor(side: Side, target: Rect, popover: Size, gap: number): { top: number; left: number } {
  const centreX = target.left + target.width / 2;
  const centreY = target.top + target.height / 2;
  switch (side) {
    case "bottom":
      return { top: target.top + target.height + gap, left: centreX - popover.width / 2 };
    case "top":
      return { top: target.top - gap - popover.height, left: centreX - popover.width / 2 };
    case "right":
      return { top: centreY - popover.height / 2, left: target.left + target.width + gap };
    case "left":
      return { top: centreY - popover.height / 2, left: target.left - gap - popover.width };
  }
}

/** Whether the popover fits on a side along the axis that points at the target. */
function fitsOnSide(side: Side, target: Rect, popover: Size, viewport: Size, gap: number, margin: number): boolean {
  switch (side) {
    case "bottom":
      return target.top + target.height + gap + popover.height <= viewport.height - margin &&
        popover.width <= viewport.width - margin * 2;
    case "top":
      return target.top - gap - popover.height >= margin && popover.width <= viewport.width - margin * 2;
    case "right":
      return target.left + target.width + gap + popover.width <= viewport.width - margin &&
        popover.height <= viewport.height - margin * 2;
    case "left":
      return target.left - gap - popover.width >= margin && popover.height <= viewport.height - margin * 2;
  }
}

/**
 * Where the caption goes.
 *
 * Tries the preferred side, then bottom, top, right, left. The first side with
 * room wins; the popover is then slid along that edge to stay on screen and
 * the arrow is moved to keep pointing at the target's centre.
 */
export function placePopover(input: {
  target: Rect | null;
  popover: Size;
  viewport: Size;
  preferred?: Side | "auto";
  gap?: number;
  margin?: number;
}): Placement {
  const { target, popover, viewport } = input;
  const gap = input.gap ?? POPOVER_GAP;
  const margin = input.margin ?? VIEWPORT_MARGIN;

  if (!target || isNarrow(viewport) || !isVisibleRect(target, viewport)) return { mode: "floating" };

  const order: Side[] = ["bottom", "top", "right", "left"];
  const preferred = input.preferred && input.preferred !== "auto" ? input.preferred : null;
  const sides = preferred ? [preferred, ...order.filter((side) => side !== preferred)] : order;

  const side = sides.find((candidate) => fitsOnSide(candidate, target, popover, viewport, gap, margin));
  if (!side) return { mode: "floating" };

  const raw = positionFor(side, target, popover, gap);
  const top = clamp(raw.top, margin, viewport.height - margin - popover.height);
  const left = clamp(raw.left, margin, viewport.width - margin - popover.width);

  const vertical = side === "top" || side === "bottom";
  const arrow = vertical
    ? clamp(target.left + target.width / 2 - left, ARROW_INSET, popover.width - ARROW_INSET)
    : clamp(target.top + target.height / 2 - top, ARROW_INSET, popover.height - ARROW_INSET);

  return { mode: "anchored", side, top, left, arrow };
}

/**
 * Which viewport edge a floating caption sits on: the bottom, unless the
 * spotlight is in the lower part of the screen, where a bottom sheet would
 * cover the very thing it describes.
 */
export function floatingEdge(target: Rect | null, viewport: Size): "top" | "bottom" {
  if (!target || !isVisibleRect(target, viewport)) return "bottom";
  const centre = target.top + target.height / 2;
  return centre > viewport.height * 0.55 ? "top" : "bottom";
}

/* ------------------------------------------------------ connector line */

/**
 * The leader line from a caption to the thing it describes.
 *
 * The arrow nub alone only works when the caption sits right against the
 * target. With a connector the caption can stand a little off, and on a phone,
 * where the caption is a sheet pinned to one edge, the line is what ties the
 * words to the component. Pure, like everything else here.
 */

export type Point = { x: number; y: number };

export type Connector = {
  /** On the caption's edge facing the target. */
  from: Point;
  /** On the spotlight's edge facing the caption: where the dot is drawn. */
  to: Point;
  /** The side of the target the line meets. */
  side: Side;
  length: number;
};

/** Room left between spotlight and caption when anchoring, for the line. */
export const CONNECTOR_GAP = 40;
/** Shorter than this and a line is just a smudge between two edges. */
export const CONNECTOR_MIN_LENGTH = 10;
/** Keeps the line's ends away from rounded corners. */
export const CONNECTOR_INSET = 18;

/** Clamp to `[lo, hi]`, or to the midpoint when the range is inverted (a rect narrower than two insets). */
function clampInto(value: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(Math.max(value, lo), hi);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The straight line between a caption and a target, or null when there is no
 * clear gap between them (they overlap, or touch) or the gap is too small to
 * be worth drawing.
 *
 * The line runs across whichever gap is widest: below, above, right or left.
 * Along that gap's edge it starts as close to the target's centre as the
 * caption allows and ends as close to the start as the target allows, so it is
 * straight whenever the two overlap on that axis and only slants when the
 * caption has been slid clear of the target.
 */
export function connectorLine(
  caption: Rect,
  target: Rect,
  options: { inset?: number; minLength?: number } = {},
): Connector | null {
  const inset = options.inset ?? CONNECTOR_INSET;
  const minLength = options.minLength ?? CONNECTOR_MIN_LENGTH;
  if (caption.width <= 0 || caption.height <= 0 || target.width <= 0 || target.height <= 0) return null;

  const captionRight = caption.left + caption.width;
  const captionBottom = caption.top + caption.height;
  const targetRight = target.left + target.width;
  const targetBottom = target.top + target.height;

  const gaps: { side: Side; gap: number }[] = [
    // `side` is the side of the target the caption is on.
    { side: "bottom", gap: caption.top - targetBottom },
    { side: "top", gap: target.top - captionBottom },
    { side: "right", gap: caption.left - targetRight },
    { side: "left", gap: target.left - captionRight },
  ];
  const best = gaps.reduce((a, b) => (b.gap > a.gap ? b : a));
  if (best.gap <= 0) return null;

  const targetCentre = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
  const targetInsetX = Math.min(inset, target.width / 2);
  const targetInsetY = Math.min(inset, target.height / 2);

  let from: Point;
  let to: Point;
  if (best.side === "bottom" || best.side === "top") {
    const x = clampInto(targetCentre.x, caption.left + inset, captionRight - inset);
    const endX = clampInto(x, target.left + targetInsetX, targetRight - targetInsetX);
    from = { x, y: best.side === "bottom" ? caption.top : captionBottom };
    to = { x: endX, y: best.side === "bottom" ? targetBottom : target.top };
  } else {
    const y = clampInto(targetCentre.y, caption.top + inset, captionBottom - inset);
    const endY = clampInto(y, target.top + targetInsetY, targetBottom - targetInsetY);
    from = { x: best.side === "right" ? caption.left : captionRight, y };
    to = { x: best.side === "right" ? targetRight : target.left, y: endY };
  }

  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length < minLength) return null;

  return {
    from: { x: round2(from.x), y: round2(from.y) },
    to: { x: round2(to.x), y: round2(to.y) },
    side: best.side,
    length: round2(length),
  };
}

/** SVG path data for a connector. */
export function connectorPath(line: Connector): string {
  return `M${line.from.x} ${line.from.y}L${line.to.x} ${line.to.y}`;
}

/**
 * Where an anchored caption goes when a connector is drawn: first with room
 * for the line, then, if that does not fit, tight against the target as
 * before. Only when neither fits does the caption float.
 */
export function placeCaption(input: {
  target: Rect | null;
  popover: Size;
  viewport: Size;
  preferred?: Side | "auto";
}): Placement {
  const roomy = placePopover({ ...input, gap: CONNECTOR_GAP });
  if (roomy.mode === "anchored") return roomy;
  return placePopover({ ...input, gap: POPOVER_GAP });
}

/** Distance of a floating desktop caption from the viewport edge (Tailwind `bottom-6` / `top-6`). */
export const FLOATING_OFFSET = 24;

/**
 * Where a floating caption sits, mirroring the coachmark's CSS: on a narrow
 * screen a full-width sheet on the chosen edge; otherwise a card centred
 * horizontally, `FLOATING_OFFSET` from that edge. Needed so the connector can
 * be drawn from a sheet as well as from an anchored caption.
 */
export function floatingCaptionRect(viewport: Size, caption: Size, edge: "top" | "bottom"): Rect {
  if (isNarrow(viewport)) {
    return {
      left: 0,
      width: viewport.width,
      height: caption.height,
      top: edge === "bottom" ? viewport.height - caption.height : 0,
    };
  }
  return {
    left: (viewport.width - caption.width) / 2,
    width: caption.width,
    height: caption.height,
    top: edge === "bottom" ? viewport.height - FLOATING_OFFSET - caption.height : FLOATING_OFFSET,
  };
}
