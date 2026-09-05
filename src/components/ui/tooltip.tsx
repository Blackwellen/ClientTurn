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

export function Tooltip({
  content,
  placement = "top",
  delay = 250,
  className,
  children,
}: {
  content: React.ReactNode;
  placement?: Placement;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = React.useId();

  const show = React.useCallback(
    (immediate = false) => {
      if (timer.current) clearTimeout(timer.current);
      if (immediate) setOpen(true);
      else timer.current = setTimeout(() => setOpen(true), delay);
    },
    [delay],
  );

  const hide = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => show()}
      onMouseLeave={hide}
      onFocus={() => show(true)}
      onBlur={hide}
      aria-describedby={open ? id : undefined}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          id={id}
          className={cn(
            "absolute z-50 w-max max-w-56 px-2 py-1 pointer-events-none",
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
