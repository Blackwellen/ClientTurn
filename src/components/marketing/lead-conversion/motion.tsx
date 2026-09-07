"use client";

import * as React from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type Transition,
  type Variants,
} from "motion/react";
import { cn } from "@/lib/cn";

/**
 * The motion system for the Lead Conversion page.
 *
 * One easing curve, one distance scale and one set of variants, so every
 * section enters with the same weight instead of each component inventing its
 * own timing. Enterprise pages read as calm because the motion is consistent
 * and short — nothing here loops in the background, nothing moves on scroll
 * position, and every animation is a one-shot reveal or a state change.
 *
 * Reduced motion is handled once, here: `useReducedMotion` collapses every
 * variant to its resting state, so the page arrives fully composed rather than
 * partially animated. No content is ever hidden behind an animation that did
 * not run.
 */

type PassthroughProps = Omit<
  React.HTMLAttributes<HTMLElement>,
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onDragEnter"
  | "onDragExit"
  | "onDragLeave"
  | "onDragOver"
  | "onDrop"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration"
  | "style"
>;

export const EASE = [0.22, 0.61, 0.36, 1] as const;

export const SPRING: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 32,
  mass: 0.9,
};

/** Rise-and-fade. The default entrance for headings, copy and cards. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: { opacity: 1, y: 0, transition: { duration: 0.62, ease: EASE } },
};

/** For elements that should arrive without travel — trust lines, notes. */
export const softFade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.7, ease: EASE } },
};

/** Product panels: a touch of scale so they read as surfacing, not sliding. */
export const panelEnter: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.985 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.72, ease: EASE },
  },
};

/** Signal cards and list rows entering from the side they belong to. */
export const slideIn = (from: "left" | "right" = "right"): Variants => ({
  hidden: { opacity: 0, x: from === "right" ? 26 : -26 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: EASE } },
});

/** A container that hands its children a stagger. */
export const stagger = (step = 0.08, delay = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

/** SVG connectors: draw the stroke rather than fading the whole path in. */
export const pathDraw: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  show: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: 1.15, ease: EASE, opacity: { duration: 0.25 } },
  },
};

/** Status chips swapping value (Review → Qualified, Scheduled → Sent). */
export const statusTransition: Variants = {
  hidden: { opacity: 0, y: -5, scale: 0.94 },
  show: { opacity: 1, y: 0, scale: 1, transition: SPRING },
  exit: { opacity: 0, y: 5, scale: 0.94, transition: { duration: 0.18 } },
};

/**
 * Reveals its children once, when the block first scrolls into view.
 *
 * `amount: 0.15` fires as soon as a sixth of the block is visible, which keeps
 * tall product panels from waiting until they are almost past the fold.
 */
export function Reveal({
  as = "div",
  variants = fadeUp,
  delay = 0,
  amount = 0.15,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "li" | "article" | "span" | "p";
  variants?: Variants;
  delay?: number;
  amount?: number;
  className?: string;
  children: React.ReactNode;
} & PassthroughProps) {
  const reduced = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  if (reduced) {
    const Plain = as as "div";
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }

  return (
    <Tag
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      transition={{ delay }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A staggering container. Children should use `RevealItem`. */
export function RevealGroup({
  as = "div",
  step = 0.08,
  delay = 0,
  amount = 0.12,
  className,
  children,
  ...rest
}: {
  as?: "div" | "ul" | "section";
  step?: number;
  delay?: number;
  amount?: number;
  className?: string;
  children: React.ReactNode;
} & PassthroughProps) {
  const reduced = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  if (reduced) {
    const Plain = as as "div";
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }

  return (
    <Tag
      className={className}
      variants={stagger(step, delay)}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A child of `RevealGroup`. Inherits the parent's stagger. */
export function RevealItem({
  as = "div",
  variants = fadeUp,
  className,
  children,
  ...rest
}: {
  as?: "div" | "li" | "article" | "span" | "p";
  variants?: Variants;
  className?: string;
  children: React.ReactNode;
} & PassthroughProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    const Plain = as as "div";
    return (
      <Plain className={className} {...rest}>
        {children}
      </Plain>
    );
  }

  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag className={className} variants={variants} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A very small parallax drift for hero furniture.
 *
 * Capped at a few pixels and spring-smoothed: enough to give the hero depth as
 * the visitor starts scrolling, not enough to detach a card from the panel it
 * belongs to. Disabled entirely under reduced motion.
 */
export function useHeroDrift(
  ref: React.RefObject<HTMLElement | null>,
  distance = 18,
) {
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const raw = useTransform(scrollYProgress, [0, 1], [0, distance]);
  const smooth = useSpring(raw, { stiffness: 120, damping: 30, mass: 0.6 });
  return reduced ? 0 : smooth;
}

/** Adds a lift-on-hover to a product panel without touching its layout. */
export function HoverLift({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={cn(className)}
      whileHover={{ y: -4 }}
      transition={SPRING}
    >
      {children}
    </motion.div>
  );
}
