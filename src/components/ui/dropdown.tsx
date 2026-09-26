"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { FLOATING_ATTR } from "./floating";
import { normalise } from "./listbox-logic";
import { useFloatingPosition } from "./use-floating";

type Align = "start" | "end";

const Ctx = React.createContext<{ close: () => void } | null>(null);

const ITEM_SELECTOR = "[role=menuitem]:not([aria-disabled=true])";

/**
 * A `role="menu"` list of commands anchored to a trigger.
 *
 * The menu is portalled to <body> and positioned from the trigger's rect
 * (see ./floating.ts): it is no longer clipped by a scrolling table, drawer
 * body or `overflow-hidden` card, and it flips above the trigger when there
 * is no room below. Keyboard: arrows (wrapping), Home/End, typeahead on the
 * item text, Escape (returns focus to the trigger), Tab closes.
 */
export function DropdownMenu({
  trigger,
  children,
  align = "end",
  className,
  label,
}: {
  trigger: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
  children: React.ReactNode;
  align?: Align;
  className?: string;
  /** Accessible name for the menu, when the trigger's text is not enough. */
  label?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLSpanElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const typed = React.useRef({ buffer: "", at: 0 });

  const focusTrigger = React.useCallback(() => {
    rootRef.current
      ?.querySelector<HTMLElement>("button, a, [tabindex]")
      ?.focus();
  }, []);
  const close = React.useCallback(() => {
    setOpen(false);
    focusTrigger();
  }, [focusTrigger]);

  const position = useFloatingPosition(open, rootRef, menuRef, {
    align,
    maxHeight: 420,
  });

  React.useEffect(() => {
    if (!open) return;
    function inside(target: EventTarget | null) {
      const node = target as Node | null;
      return !!node && (rootRef.current?.contains(node) || menuRef.current?.contains(node));
    }
    function onPointerDown(e: PointerEvent) {
      if (!inside(e.target)) setOpen(false);
    }
    function onFocusIn(e: FocusEvent) {
      if (!inside(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [open]);

  // Focus the first item once the menu has been placed.
  React.useEffect(() => {
    if (open && position) {
      const menu = menuRef.current;
      if (menu && !menu.contains(document.activeElement)) {
        menu.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
      }
    }
  }, [open, position]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);

    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const next = e.key === "ArrowDown" ? index + 1 : index - 1;
        items[(next + items.length) % items.length].focus();
        return;
      }
      case "Home":
        e.preventDefault();
        items[0].focus();
        return;
      case "End":
        e.preventDefault();
        items[items.length - 1].focus();
        return;
      case "Escape":
        e.preventDefault();
        // Keep an enclosing drawer/modal open.
        e.nativeEvent.stopImmediatePropagation();
        close();
        return;
      case "Tab":
        setOpen(false);
        return;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          typed.current.buffer =
            now - typed.current.at > 600 ? e.key : typed.current.buffer + e.key;
          typed.current.at = now;
          const needle = normalise(typed.current.buffer);
          const order = items.slice(index + 1).concat(items.slice(0, index + 1));
          const match = order.find((el) =>
            normalise(el.textContent?.trim() ?? "").startsWith(needle),
          );
          match?.focus();
        }
    }
  }

  return (
    <span ref={rootRef} className="relative inline-block">
      {React.cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          trigger.props.onClick?.(e);
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            {...{ [FLOATING_ATTR]: "" }}
            onKeyDown={onMenuKeyDown}
            className={cn(
              "fixed z-[80] min-w-52 overflow-y-auto overscroll-contain p-1",
              "rounded-lg border border-line bg-surface-raised shadow-lg",
              "ring-1 ring-black/[0.02]",
              "animate-[lr-slide-up_var(--lr-duration-fast)_var(--lr-ease)]",
              position?.theme,
              className,
            )}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              maxHeight: position?.maxHeight ?? 420,
              maxWidth: "calc(100vw - 16px)",
              visibility: position ? "visible" : "hidden",
            }}
          >
            <Ctx.Provider value={{ close }}>{children}</Ctx.Provider>
          </div>,
          document.body,
        )}
    </span>
  );
}

export function DropdownItem({
  icon: Icon,
  destructive,
  disabled,
  onSelect,
  description,
  shortcut,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** A secondary line under the label — what the command will do. */
  description?: React.ReactNode;
  /** Trailing hint, e.g. a keyboard shortcut or "…" count. */
  shortcut?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const ctx = React.useContext(Ctx);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        // Close first so a dialog opened by the command receives focus
        // rather than having it pulled back to the menu trigger afterwards.
        ctx?.close();
        onSelect?.();
      }}
      className={cn(
        "group flex w-full gap-2.5 rounded-md px-2.5 text-left text-[13px] outline-none",
        description ? "items-start py-2" : "min-h-9 items-center py-1.5 sm:min-h-8",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        destructive
          ? "text-danger-600 hover:bg-danger-50 focus-visible:bg-danger-50 focus:bg-danger-50"
          : "text-content-secondary hover:bg-surface-hover hover:text-content focus:bg-surface-hover focus:text-content",
        className,
      )}
    >
      {Icon && (
        <span
          className={cn(
            "grid shrink-0 place-items-center",
            description ? "mt-px size-4" : "size-4",
            destructive
              ? "text-danger-600"
              : "text-content-subtle group-hover:text-content-secondary group-focus:text-content-secondary",
          )}
        >
          <Icon className="size-4" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{children}</span>
        {description && (
          <span
            className={cn(
              "mt-0.5 block text-[12px] font-normal leading-snug",
              destructive ? "text-danger-600/80" : "text-content-muted",
            )}
          >
            {description}
          </span>
        )}
      </span>
      {shortcut && (
        <span className="ml-3 shrink-0 self-center text-[11px] tabular-nums text-content-subtle">
          {shortcut}
        </span>
      )}
    </button>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line-subtle" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="presentation"
      className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-content-subtle first:pt-1"
    >
      {children}
    </div>
  );
}

/** A labelled run of items; renders a separator before every group but the first. */
export function DropdownGroup({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div
      role="group"
      aria-labelledby={label ? id : undefined}
      className="border-t border-line-subtle pt-1 mt-1 -mx-1 px-1 first:mt-0 first:border-t-0 first:pt-0"
    >
      {label && (
        <div
          id={id}
          role="presentation"
          className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-content-subtle"
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
