"use client";

import * as React from "react";
import { useInView, useReducedMotion } from "motion/react";

/**
 * Steps a demo through `count` stages and loops.
 *
 * Two things it deliberately does not do: run while the panel is off screen,
 * and run at all when the visitor has asked for reduced motion. In both cases
 * it parks on the last stage, which is the *finished* state of every demo on
 * this page — a booking confirmed, a lead qualified, a sequence stopped — so
 * nothing is hidden from someone who never sees the animation.
 */
export function useStageLoop(
  ref: React.RefObject<Element | null>,
  count: number,
  stepMs: number,
  holdMs = stepMs * 2,
) {
  const reduced = useReducedMotion();
  const inView = useInView(ref, { amount: 0.25 });
  const active = !reduced && inView;
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => {
    if (!active) return;
    let index = 0;
    let timer = setTimeout(function run() {
      setTick(index);
      const last = index === count - 1;
      index = last ? 0 : index + 1;
      timer = setTimeout(run, last ? holdMs : stepMs);
    }, 0);
    return () => clearTimeout(timer);
  }, [active, count, stepMs, holdMs]);

  const stage = active ? tick : count - 1;

  return stage;
}

/** Fires once when the element first scrolls into view. Used for reveals. */
export function useRevealed(ref: React.RefObject<Element | null>) {
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.2 });
  return reduced ? true : inView;
}
