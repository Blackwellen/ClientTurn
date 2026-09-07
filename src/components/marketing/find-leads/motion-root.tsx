"use client";

import * as React from "react";
import { MotionConfig, useReducedMotion } from "motion/react";

/**
 * Motion policy for the whole page.
 *
 * `prefers-reduced-motion` is honoured in exactly one place:
 * `reducedMotion="always"` makes every `motion` element below this point
 * resolve straight to its final state, so a visitor who has asked for less
 * movement gets the finished page rather than a set of panels caught
 * mid-flight. Individual components still read `useReducedMotion()` to decide
 * whether to offer a hover lift or a pulse at all, and this provider is what
 * makes that one decision consistent across the page.
 */
export function MotionRoot({ children }: { children: React.ReactNode }) {
  const prefersReduced = useReducedMotion();

  return (
    <MotionConfig reducedMotion={prefersReduced ? "always" : "user"}>
      {children}
    </MotionConfig>
  );
}
