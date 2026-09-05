"use client";

import * as React from "react";

function prefersReducedMotion() {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveals `count` items one at a time on a fixed interval, and only once the
 * element is on screen. Returns `count` immediately when the visitor has asked
 * for reduced motion, so the same information is present without movement.
 */
export function useStagedReveal(count: number, intervalMs = 700) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = React.useState(0);

  React.useEffect(() => {
    if (prefersReducedMotion()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- matchMedia is browser-only, so reduced-motion can only be honoured after mount.
      setRevealed(count);
      return;
    }

    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setRevealed(count);
      return;
    }

    let timer: ReturnType<typeof setInterval> | undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setRevealed(1);
        timer = setInterval(() => {
          setRevealed((current) => {
            if (current >= count) {
              if (timer) clearInterval(timer);
              return current;
            }
            return current + 1;
          });
        }, intervalMs);
      },
      { threshold: 0.3 },
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer) clearInterval(timer);
    };
  }, [count, intervalMs]);

  return { ref, revealed };
}
