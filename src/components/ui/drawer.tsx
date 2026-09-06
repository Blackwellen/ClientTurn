"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useBodyScrollLock(active: boolean) {
  React.useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

/** Traps Tab within the container and restores focus to the opener on close. */
export function useFocusTrap(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
) {
  React.useEffect(() => {
    if (!active) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [ref, active]);
}

export function useEscape(active: boolean, onEscape: () => void) {
  React.useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [active, onEscape]);
}

export function Overlay({
  onClick,
  className,
}: {
  onClick?: () => void;
  /** Pass `absolute inset-0` to dim only the drawer's own positioning box. */
  className?: string;
}) {
  return (
    <div
      aria-hidden
      onClick={onClick}
      className={cn(
        "bg-[var(--lr-overlay)] animate-[lr-fade-in_var(--lr-duration-base)_var(--lr-ease)]",
        className ?? "fixed inset-0",
      )}
    />
  );
}

const SIZES = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-2xl",
  xl: "sm:max-w-4xl",
  /**
   * A working panel beside the page rather than over it: roughly 38% of a
   * wide desktop, floored so it stays usable on a laptop and capped so it
   * never becomes a second page on an ultrawide.
   */
  panel: "sm:w-[min(560px,46vw)] sm:min-w-[400px] sm:max-w-[560px]",
} as const;

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZES;
  /**
   * `content` anchors the drawer inside the app shell's content area on large
   * screens, so the sidebar and top bar stay visible and undimmed. It reads
   * `--lr-shell-pad`, which `AppShell` sets on the content wrapper and which
   * inherits down to anything rendered inside `main`.
   */
  anchor?: "viewport" | "content";
  /** Replaces the default title row entirely (icon tiles, badges, tabs). */
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  bodyClassName?: string;
};

export function Drawer({
  open,
  onClose,
  title,
  description,
  size = "md",
  anchor = "viewport",
  header,
  children,
  footer,
  bodyClassName,
}: DrawerProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();

  useBodyScrollLock(open);
  useFocusTrap(panelRef, open);
  useEscape(open, onClose);

  // Portalled to the body rather than rendered where it is written.
  //
  // Callers mount drawers wherever the trigger lives, and that is frequently
  // inside chrome that traps them twice over. The top bar, for instance, is
  // `sticky z-30 backdrop-blur-md`: the z-index makes a stacking context, so
  // an inner `z-50` only ever competes inside `z-30` and sinks under the
  // support bubble; and a `backdrop-filter` ancestor becomes the containing
  // block for `position: fixed` descendants, so `inset-0` stops meaning the
  // viewport. Escaping to the body is what makes the classes below mean what
  // they say, wherever the drawer is written.
  //
  // `mounted` keeps the first server render and the first client render
  // identical -- there is no document to portal into during SSR. Read through
  // useSyncExternalStore rather than an effect: the server snapshot is false
  // and the client snapshot is true, which is exactly the distinction needed,
  // without a state write during render or an effect that lints badly.
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50",
        anchor === "content" &&
          "lg:left-[var(--lr-shell-pad,0px)] lg:top-[var(--lr-topbar-height)]",
      )}
    >
      <Overlay
        onClick={onClose}
        className={cn(
          "absolute inset-0",
          // A content-anchored drawer leaves the sidebar and top bar fully
          // lit, so the page behind it only needs a light scrim to fall back
          // — the heavy modal overlay would read as a blocked page.
          anchor === "content" && "bg-[rgb(16_24_40_/_0.12)]",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-desc` : undefined}
        tabIndex={-1}
        className={cn(
          "absolute inset-0 flex flex-col bg-surface shadow-xl outline-none",
          "sm:inset-y-0 sm:right-0 sm:left-auto sm:w-full sm:border-l sm:border-line",
          "animate-[lr-slide-in-right_var(--lr-duration-slow)_var(--lr-ease)]",
          "motion-reduce:animate-none",
          SIZES[size],
        )}
      >
        {header ?? (
          <DrawerHeader>
            <div className="min-w-0">
              <h2
                id={`${id}-title`}
                className="text-[15px] font-semibold text-content truncate"
              >
                {title}
              </h2>
              {description && (
                <p
                  id={`${id}-desc`}
                  className="mt-0.5 text-[13px] text-content-muted"
                >
                  {description}
                </p>
              )}
            </div>
            <IconButton size="sm" label="Close panel" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </DrawerHeader>
        )}

        {/* When a custom header is supplied it carries its own heading, so the
            dialog is still labelled — this keeps `aria-labelledby` valid. */}
        {header && (
          <span id={`${id}-title`} className="sr-only">
            {title}
          </span>
        )}

        <DrawerBody className={bodyClassName}>{children}</DrawerBody>
        {footer && <DrawerFooter>{footer}</DrawerFooter>}
      </div>
    </div>,
    document.body,
  );
}

export function DrawerHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 shrink-0",
        "px-5 py-4 border-b border-line",
        className,
      )}
      {...props}
    />
  );
}

export function DrawerBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto px-5 py-4", className)}
      {...props}
    />
  );
}

export function DrawerFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-2 shrink-0",
        "px-5 py-3 border-t border-line bg-surface-sunken/40",
        className,
      )}
      {...props}
    />
  );
}
