"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Marks a block `data-inview="true"` once it scrolls into view.
 *
 * This is how the revenue sections lazy-start their motion: every animation
 * in `revenue.css` is keyed off this attribute, so nothing below the fold
 * runs (or costs a frame) until the visitor reaches it. The markup is
 * identical on the server and the client and is fully readable before the
 * attribute arrives; the attribute only adds movement.
 *
 * Reduced motion is handled in CSS (`prefers-reduced-motion`), not here, so
 * the server and client render the same DOM and there is no hydration
 * mismatch. Items that wait to enter are hidden only once the component is
 * armed (JavaScript has run), so a visitor without it still reads everything.
 */
export function InView({
  as: Tag = "div",
  amount = 0.25,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "ol" | "ul" | "figure";
  amount?: number;
  className?: string;
  children: React.ReactNode;
  id?: string;
  role?: React.AriaRole;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const ref = React.useRef<HTMLElement>(null);
  const [inView, setInView] = React.useState(false);
  const [armed, setArmed] = React.useState(false);

  React.useEffect(() => {
    // Only once JavaScript is running may anything wait for the observer:
    // without it the block renders in its final, readable state.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- arming is a client-only fact, unknowable during SSR.
    setArmed(true);
  }, []);

  React.useEffect(() => {
    const node = ref.current;
    if (!node || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no observer to wait for; show the final state.
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { threshold: amount },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [amount, inView]);

  return (
    <Tag
      ref={ref as never}
      data-armed={armed ? "true" : undefined}
      data-inview={inView ? "true" : undefined}
      className={cn("rv-inview", className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}
