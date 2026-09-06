"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A small anchored panel for editing a value in place.
 *
 * Distinct from `DropdownMenu`, which is a `role="menu"` list of commands:
 * form controls inside a menu are announced wrongly and swallow arrow keys.
 * This is a labelled `role="dialog"` instead, so a number input and a select
 * behave normally inside it.
 */
export function Popover({
  trigger,
  label,
  children,
  align = "start",
  className,
}: {
  trigger: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
  /** Names the panel for screen readers. */
  label: string;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Escape returns focus to the control that opened the panel.
      rootRef.current?.querySelector("button")?.focus();
    }
    function onFocusIn(event: FocusEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    panelRef.current
      ?.querySelector<HTMLElement>("input, select, button, [tabindex]")
      ?.focus();
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-block">
      {React.cloneElement(trigger, {
        onClick: (event: React.MouseEvent) => {
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        "aria-expanded": open,
        "aria-haspopup": "dialog",
      })}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={label}
          className={cn(
            "absolute z-40 mt-1 min-w-56 p-3",
            "bg-surface-raised border-line rounded-lg border shadow-lg",
            "animate-[lr-slide-up_var(--lr-duration-fast)_var(--lr-ease)]",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      )}
    </div>
  );
}
