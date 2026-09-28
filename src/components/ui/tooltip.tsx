"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Placement = "top" | "bottom" | "left" | "right";

const PLACEMENTS: Record<Placement, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

/** Grace period for the pointer to cross the gap onto the bubble (SC 1.4.13). */
const HIDE_DELAY_MS = 120;

/** What can take focus, and so can carry `aria-describedby` itself. */
const FOCUSABLE =
  'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

/**
 * A hover/focus hint.
 *
 * Accessibility (audit 2026-09-28):
 *  - The description used to be wired with `aria-describedby` on the wrapping
 *    <span>, which is never focused, so no screen reader ever announced it:
 *    every KPI hint, integration status and badge explanation was sighted-only
 *    (SC 1.3.1 / 4.1.2). Now a focusable trigger is described directly, from a
 *    node that is always in the DOM, and a non-focusable trigger (a badge, a
 *    truncated label) gets the text as a visually hidden sibling so it is read
 *    in the reading order.
 *  - The bubble can be hovered: it no longer ignores the pointer and hiding is
 *    delayed long enough to cross the gap (SC 1.4.13 "hoverable").
 *  - The wiring is done on the rendered DOM after mount, not by inspecting
 *    `children`: a trigger passed down from a Server Component arrives on the
 *    client as a lazy reference, not an element, so any render-time decision
 *    about it differed between the server HTML and the client and broke
 *    hydration on every page with a KPI hint (QA 2026-09-28). The markup is
 *    therefore identical on both sides: the text starts as a visually hidden
 *    sibling (correct for a badge or a truncated label), and a focusable
 *    trigger is then described directly and the sibling hidden, so it is not
 *    read twice.
 *  - `describe={false}` skips the screen-reader copy where the tooltip only
 *    repeats the trigger's own name (the collapsed sidebar's labels). A string
 *    tooltip identical to the trigger's text is skipped automatically.
 */
export function Tooltip({
  content,
  placement = "top",
  delay = 250,
  describe = true,
  className,
  children,
}: {
  content: React.ReactNode;
  placement?: Placement;
  delay?: number;
  /** Expose `content` to assistive technology (default). */
  describe?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = React.useId();
  const descId = `${id}-desc`;

  const show = React.useCallback(
    (immediate = false) => {
      if (timer.current) clearTimeout(timer.current);
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );

  const hide = React.useCallback((immediate = false) => {
    if (timer.current) clearTimeout(timer.current);
    if (immediate) setOpen(false);
    else timer.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Escape dismisses the tooltip without moving focus (SC 1.4.13), and only
  // the tooltip: captured and stopped, so a drawer or dialog behind it does
  // not close on the same key press. A second Escape reaches the overlay.
  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open]);

  const announce = describe && content != null && content !== "";
  const wrapRef = React.useRef<HTMLSpanElement>(null);

  React.useEffect(() => {
    if (!announce) return;
    const wrap = wrapRef.current;
    const desc = wrap ? document.getElementById(descId) : null;
    const trigger = wrap?.firstElementChild;
    if (!wrap || !desc || !trigger || trigger === desc) return;
    // A tooltip that only repeats the trigger's own text adds nothing.
    const triggerText = (trigger.getAttribute("aria-label") ?? trigger.textContent ?? "").trim();
    if (typeof content === "string" && content.trim() === triggerText) {
      desc.hidden = true;
      return () => {
        desc.hidden = false;
      };
    }
    if (!trigger.matches(FOCUSABLE)) return;
    const before = trigger.getAttribute("aria-describedby");
    trigger.setAttribute("aria-describedby", [before, descId].filter(Boolean).join(" "));
    desc.hidden = true;
    return () => {
      if (before) trigger.setAttribute("aria-describedby", before);
      else trigger.removeAttribute("aria-describedby");
      desc.hidden = false;
    };
  }, [announce, content, descId]);

  return (
    <span
      ref={wrapRef}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => show()}
      onMouseLeave={() => hide()}
      onFocus={() => show(true)}
      onBlur={() => hide(true)}
    >
      {children}
      {announce && (
        // Always mounted, so the description exists before the bubble does.
        <span id={descId} className="sr-only">
          {content}
        </span>
      )}
      {open && (
        <span
          role="tooltip"
          // Already exposed through the description above.
          aria-hidden
          className={cn(
            "absolute z-50 w-max max-w-56 px-2 py-1",
            "rounded-md bg-content text-content-inverse text-[12px] leading-snug shadow-md",
            "animate-[lr-fade-in_var(--lr-duration-fast)_var(--lr-ease)]",
            PLACEMENTS[placement],
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
