"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion } from "motion/react";

/**
 * The one motion preset the evaluation pages use: content rises a little as it
 * arrives, once, and never again.
 *
 * Deliberately narrow. Panels animating individually is the whole effect —
 * there is no scroll-jacking, nothing animates continuously, and no chart
 * redraws itself while the visitor is trying to read it. `useReducedMotion`
 * returns the content with no transform at all rather than a faster one.
 */
export function Reveal({
  children,
  delay = 0,
  as = "div",
  className,
  amount = 0.15,
}: {
  children: React.ReactNode;
  delay?: number;
  as?: "div" | "section";
  className?: string;
  amount?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount });
  const reduced = useReducedMotion();

  const Tag = as === "section" ? motion.section : motion.div;

  if (reduced) {
    const Plain = as === "section" ? "section" : "div";
    return (
      <Plain ref={ref} className={className}>
        {children}
      </Plain>
    );
  }

  return (
    <Tag
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Tag>
  );
}

/**
 * Staggers a list of siblings by index. Used for card grids, where a single
 * block reveal reads as a jump and per-card observers would be wasteful.
 */
export function RevealGroup({
  children,
  className,
  step = 0.07,
}: {
  children: React.ReactNode;
  className?: string;
  step?: number;
}) {
  const items = React.Children.toArray(children);
  return (
    <div className={className}>
      {items.map((child, index) => (
        <Reveal key={index} delay={index * step}>
          {child}
        </Reveal>
      ))}
    </div>
  );
}
