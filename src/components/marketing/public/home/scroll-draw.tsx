"use client";

import * as React from "react";

/**
 * Draws the lime connectors as their section arrives.
 *
 * GSAP + ScrollTrigger, loaded lazily on the client and only once the wrapper
 * is close to the viewport, so nothing about this is on the critical path: the
 * connectors are already fully drawn in the server HTML, and this only replays
 * them. If the import fails, or the browser prefers reduced motion, the
 * section simply stays as rendered — the diagram is never blank.
 *
 * It animates `strokeDashoffset` on paths that opt in with `data-draw`, and
 * `transform` on markers that opt in with `data-draw-pop`. Both are compositor
 * friendly; nothing here triggers layout.
 */
export function ScrollDraw({
  children,
  className,
  /** Seconds each path takes to draw. */
  duration = 1.1,
  /** Seconds between consecutive paths. */
  stagger = 0.08,
}: {
  children: React.ReactNode;
  className?: string;
  duration?: number;
  stagger?: number;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches) return;

    let cancelled = false;
    const cleanups: (() => void)[] = [];

    // Only pay for the animation library once the section is actually near.
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();

        void (async () => {
          try {
            const [{ gsap }, { ScrollTrigger }] = await Promise.all([
              import("gsap"),
              import("gsap/ScrollTrigger"),
            ]);
            if (cancelled) return;
            gsap.registerPlugin(ScrollTrigger);

            const paths = Array.from(root.querySelectorAll<SVGPathElement>("[data-draw]"));
            const pops = Array.from(root.querySelectorAll<SVGElement>("[data-draw-pop]"));
            const lines = Array.from(root.querySelectorAll<HTMLElement>("[data-draw-line]"));

            const context = gsap.context(() => {
              if (paths.length > 0) {
                gsap.fromTo(
                  paths,
                  { strokeDasharray: 1, strokeDashoffset: 1 },
                  {
                    strokeDashoffset: 0,
                    duration,
                    stagger,
                    ease: "power2.out",
                    clearProps: "strokeDasharray,strokeDashoffset",
                    scrollTrigger: { trigger: root, start: "top 80%", once: true },
                  },
                );
              }
              if (lines.length > 0) {
                gsap.from(lines, {
                  scaleX: 0,
                  transformOrigin: "left center",
                  duration: duration * 1.2,
                  ease: "power2.out",
                  scrollTrigger: { trigger: root, start: "top 80%", once: true },
                });
              }
              if (pops.length > 0) {
                gsap.from(pops, {
                  scale: 0,
                  opacity: 0,
                  transformOrigin: "50% 50%",
                  duration: 0.4,
                  stagger: stagger * 1.5,
                  delay: 0.25,
                  ease: "back.out(2)",
                  scrollTrigger: { trigger: root, start: "top 80%", once: true },
                });
              }
            }, root);

            cleanups.push(() => context.revert());
          } catch {
            /* The diagram is already drawn; motion is an enhancement only. */
          }
        })();
      },
      { rootMargin: "200px" },
    );

    observer.observe(root);

    return () => {
      cancelled = true;
      observer.disconnect();
      for (const cleanup of cleanups) cleanup();
    };
  }, [duration, stagger]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
