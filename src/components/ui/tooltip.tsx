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

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"]);

function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

type TriggerProps = {
  href?: unknown;
  onClick?: unknown;
  tabIndex?: unknown;
  "aria-describedby"?: string;
};

/**
 * Whether the trigger can take focus, and so can carry `aria-describedby`.
 * Components (Link, Button) are judged by the props that make them
 * interactive, since their rendered tag is not visible from here.
 */
function isInteractive(child: React.ReactElement<TriggerProps>): boolean {
  if (typeof child.type === "string" && INTERACTIVE_TAGS.has(child.type)) return true;
  const props = child.props;
  return props.href != null || props.onClick != null || props.tabIndex != null;
}

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

  const single = React.Children.count(children) === 1 && React.isValidElement<TriggerProps>(children)
    ? (children as React.ReactElement<TriggerProps>)
    : null;
  const redundant =
    typeof content === "string" && content.trim() === textOf(children).trim();
  const announce = describe && !redundant && content != null && content !== "";
  const describeTrigger = announce && single !== null && isInteractive(single);

  const trigger = describeTrigger && single
    ? React.cloneElement(single, {
        "aria-describedby": [single.props["aria-describedby"], descId].filter(Boolean).join(" "),
      })
    : children;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => show()}
      onMouseLeave={() => hide()}
      onFocus={() => show(true)}
      onBlur={() => hide(true)}
    >
      {trigger}
      {announce &&
        (describeTrigger ? (
          // Always mounted, so the description exists before the bubble does.
          <span id={descId} hidden>
            {content}
          </span>
        ) : (
          <span className="sr-only">{content}</span>
        ))}
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
