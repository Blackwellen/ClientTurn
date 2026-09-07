"use client";

import * as React from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Variants,
} from "motion/react";
import { cn } from "@/lib/cn";

/**
 * The motion vocabulary for the public site.
 *
 * Three rules hold everything here together:
 *
 * 1. **Transform and opacity only.** Nothing animates a layout property, so a
 *    reveal can never cause reflow while the visitor is reading.
 * 2. **Once, on entry.** No scroll-jacking, no parallax on content, and
 *    nothing that keeps moving after it has arrived — a chart that redraws
 *    itself while you read it is noise, not craft.
 * 3. **Motion is never load-bearing for reading the page.** Content that only
 *    appears once JavaScript has run and an observer has fired is content some
 *    visitors never see. Two safeguards below make that impossible.
 *
 * ## Why reduced motion does not swap the markup
 *
 * The obvious implementation — return a plain element when `useReducedMotion()`
 * is true — is wrong here, and shipped a real bug: the hook reads a media
 * query, so it is always `false` during server rendering and `true` on a
 * reduced-motion client. The server therefore emitted `style="opacity:0"` while
 * the client rendered an element with no style at all. React reconciled that
 * mismatch by keeping the server's inline style, and whole sections stayed
 * invisible for exactly the people who had asked for less movement.
 *
 * So the element and its props are identical on both sides. Reduced motion
 * changes only the *timing*: the target is `shown` immediately, with a zero
 * duration. Same DOM, no mismatch, nothing hidden.
 */

/**
 * What a reveal wrapper forwards to the element it renders.
 *
 * Deliberately not `HTMLAttributes`: a motion component defines its own
 * `onDrag`, `onAnimationStart` and friends with different signatures, so
 * spreading React's DOM handlers into one is a type conflict and, if it were
 * forced through, a source of silently dropped handlers.
 */
type PassThrough = {
  id?: string;
  style?: React.CSSProperties;
  role?: React.AriaRole;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-hidden"?: boolean;
};

const EASE = [0.22, 1, 0.36, 1] as const;

/** Timing used whenever the visitor has asked for reduced motion. */
const INSTANT = { duration: 0 } as const;

/** How far an element travels on entry. Small — this is emphasis, not motion. */
const RISE = 18;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: RISE },
  shown: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.5, ease: EASE } },
};

export const softScale: Variants = {
  hidden: { opacity: 0, scale: 0.975, y: RISE },
  shown: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 0.7, ease: EASE },
  },
};

/** A container that hands its children a staggered entrance. */
export function staggerChildren(step = 0.07, delay = 0): Variants {
  return {
    hidden: {},
    shown: { transition: { staggerChildren: step, delayChildren: delay } },
  };
}

/**
 * How long content may stay hidden waiting for an intersection callback.
 *
 * A reveal that never fires is content the visitor can never read. An observer
 * can miss for reasons that have nothing to do with the visitor — a prerender,
 * a screenshot service, an embedded webview with the API stubbed — so entry
 * animation gets one deadline and then gives up in favour of showing content.
 */
const REVEAL_FAILSAFE_MS = 900;

/** True once the element has been seen, or once we have waited long enough. */
function useShown(
  ref: React.RefObject<Element | null>,
  amount: number,
): boolean {
  const inView = useInView(ref, { once: true, amount });
  const [expired, setExpired] = React.useState(false);

  React.useEffect(() => {
    if (inView) return;
    const timer = window.setTimeout(() => setExpired(true), REVEAL_FAILSAFE_MS);
    return () => window.clearTimeout(timer);
  }, [inView]);

  return inView || expired;
}

type Preset = "fadeUp" | "fadeIn" | "softScale";

/**
 * Marks an element shown once it has scrolled into view.
 *
 * The observer only ever *adds* the shown state, and a deadline adds it
 * anyway if the callback never arrives — a prerender, a screenshot service or
 * a webview with the API stubbed must not be able to leave a page unreadable.
 */
function useRevealed<T extends HTMLElement>(amount: number) {
  const ref = React.useRef<T>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || shown) return;

    // Where the API is missing there is nothing to observe, so the deadline
    // below is the only thing that will reveal the content — start it and
    // skip the observer entirely.
    const supported = typeof IntersectionObserver !== "undefined";

    const observer = supported
      ? new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) setShown(true);
          },
          { threshold: amount, rootMargin: "0px 0px -5% 0px" },
        )
      : null;

    observer?.observe(node);

    const failsafe = window.setTimeout(
      () => setShown(true),
      supported ? REVEAL_FAILSAFE_MS : 0,
    );

    return () => {
      observer?.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [amount, shown]);

  return [ref, shown] as const;
}

/**
 * Reveals its children once, when they scroll into view.
 *
 * `amount` is deliberately low: a tall section whose reveal waited for half of
 * it to be visible would still be animating in as the visitor started reading.
 */
export function Reveal({
  children,
  delay = 0,
  amount = 0.08,
  as: Tag = "div",
  className,
  ...rest
}: {
  children: React.ReactNode;
  /** Kept for call-site compatibility; presets differ only in distance. */
  preset?: Preset;
  delay?: number;
  amount?: number;
  as?: "div" | "section" | "li" | "span";
  className?: string;
} & PassThrough) {
  const [ref, shown] = useRevealed<HTMLDivElement>(amount);

  return (
    <Tag
      ref={ref as never}
      data-shown={shown ? "true" : undefined}
      className={cn("pub-reveal", className)}
      style={
        delay
          ? ({ "--pub-reveal-delay": `${Math.round(delay * 1000)}ms` } as React.CSSProperties)
          : undefined
      }
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A container whose children arrive one after another. */
export function RevealStagger({
  children,
  amount = 0.08,
  as: Tag = "div",
  className,
  ...rest
}: {
  children: React.ReactNode;
  step?: number;
  delay?: number;
  amount?: number;
  as?: "div" | "ul" | "ol" | "section";
  className?: string;
} & PassThrough) {
  const [ref, shown] = useRevealed<HTMLDivElement>(amount);

  return (
    <Tag
      ref={ref as never}
      data-shown={shown ? "true" : undefined}
      className={cn("pub-reveal-group", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * One child of a `RevealStagger`.
 *
 * The stagger is applied by the parent in CSS, so this only needs to be the
 * right element — it carries no animation state of its own.
 */
export function RevealItem({
  children,
  as: Tag = "div",
  className,
  ...rest
}: {
  children: React.ReactNode;
  preset?: Preset;
  as?: "div" | "li" | "section";
  className?: string;
} & PassThrough) {
  return (
    <Tag className={className} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A grid whose children arrive one after another.
 *
 * Wraps each child itself, so a grid of plain cards staggers without every
 * call site having to wrap its own children.
 */
export function RevealGrid({
  children,
  amount = 0.08,
  className,
  ...rest
}: {
  children: React.ReactNode;
  step?: number;
  amount?: number;
  className?: string;
} & PassThrough) {
  const [ref, shown] = useRevealed<HTMLDivElement>(amount);
  const items = React.Children.toArray(children);

  return (
    <div
      ref={ref}
      data-shown={shown ? "true" : undefined}
      className={cn("pub-reveal-group", className)}
      {...rest}
    >
      {items.map((child, index) => (
        <div key={index} className="min-w-0">
          {child}
        </div>
      ))}
    </div>
  );
}

/**
 * Draws an SVG path on entry.
 *
 * Used for the connector lines in the /how-it-works diagrams, where the
 * drawing *is* the explanation. Every relationship it draws is also stated in
 * the copy, so a visitor who never sees the animation loses nothing.
 */
export function PathDraw({
  d,
  duration = 1.1,
  delay = 0,
  className,
  ...rest
}: {
  d: string;
  duration?: number;
  delay?: number;
  className?: string;
  stroke?: string;
  strokeWidth?: number | string;
  strokeLinecap?: "butt" | "round" | "square";
  fill?: string;
  vectorEffect?: string;
}) {
  const ref = React.useRef<SVGPathElement>(null);
  const shown = useShown(ref, 0.2);
  const reduced = useReducedMotion();

  return (
    <motion.path
      ref={ref}
      d={d}
      className={className}
      initial={{ pathLength: 0, opacity: 0 }}
      animate={reduced || shown ? { pathLength: 1, opacity: 1 } : undefined}
      transition={
        reduced
          ? INSTANT
          : {
              pathLength: { duration, delay, ease: EASE },
              opacity: { duration: 0.25, delay },
            }
      }
      {...rest}
    />
  );
}

/**
 * A horizontal bar that grows from its leading edge.
 *
 * Grows via `scaleX` with a left origin rather than by animating `width`, so
 * the bar's neighbours never reflow mid-animation.
 */
export function GrowBar({
  width,
  colour,
  delay = 0,
  className,
}: {
  width: string;
  colour: string;
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = useShown(ref, 0.4);
  const reduced = useReducedMotion();

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ width, background: colour, transformOrigin: "left center" }}
      initial={{ scaleX: 0 }}
      animate={reduced || shown ? { scaleX: 1 } : undefined}
      transition={reduced ? INSTANT : { duration: 0.8, delay, ease: EASE }}
    />
  );
}

/** A vertical column that grows from its base. */
export function GrowColumn({
  height,
  colour,
  delay = 0,
  className,
}: {
  height: string;
  colour: string;
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const shown = useShown(ref, 0.4);
  const reduced = useReducedMotion();

  return (
    <motion.span
      ref={ref}
      className={className}
      style={{ height, background: colour, transformOrigin: "bottom center" }}
      initial={{ scaleY: 0 }}
      animate={reduced || shown ? { scaleY: 1 } : undefined}
      transition={reduced ? INSTANT : { duration: 0.7, delay, ease: EASE }}
    />
  );
}

/**
 * The thin lime progress line under the header.
 *
 * The one thing on these pages that tracks scroll continuously. It is a
 * position indicator on a very long page, it moves only in response to the
 * visitor's own scrolling, and it carries no content — so it is exempt from
 * the "nothing keeps moving" rule rather than a breach of it.
 */
export function ScrollProgress() {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 180,
    damping: 30,
    restDelta: 0.001,
  });

  if (reduced) return null;

  return <motion.div aria-hidden className="pub-scroll-progress" style={{ scaleX }} />;
}

/**
 * Moves its child a few pixels against the scroll.
 *
 * Reserved for decoration — never for text or for a product screen a visitor
 * is trying to read.
 */
export function Drift({
  children,
  range = 26,
  className,
}: {
  children: React.ReactNode;
  range?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], [range, -range]);

  return (
    <motion.div ref={ref} className={className} style={reduced ? undefined : { y }}>
      {children}
    </motion.div>
  );
}

/**
 * A hero heading that arrives a line at a time.
 *
 * Takes ready-made lines rather than splitting text itself: splitting a string
 * into spans breaks selection, search-in-page and screen-reader phrasing. The
 * whole heading is one accessible node; only its visual lines are staggered.
 */
export function HeadingLines({
  lines,
  className,
  id,
}: {
  lines: React.ReactNode[];
  className?: string;
  id?: string;
}) {
  const ref = React.useRef<HTMLHeadingElement>(null);
  const shown = useShown(ref, 0.3);
  const reduced = useReducedMotion();

  return (
    <motion.h1
      ref={ref}
      id={id}
      className={className}
      variants={reduced ? staggerChildren(0, 0) : staggerChildren(0.09)}
      initial="hidden"
      animate={reduced || shown ? "shown" : "hidden"}
    >
      {lines.map((line, index) => (
        // `clip` on the wrapper is what makes the line look like it rises out
        // of the one above rather than simply fading upward.
        <span key={index} className={cn("block overflow-hidden pb-[0.06em]")}>
          <motion.span
            className="block"
            variants={fadeUp}
            transition={reduced ? INSTANT : undefined}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </motion.h1>
  );
}
