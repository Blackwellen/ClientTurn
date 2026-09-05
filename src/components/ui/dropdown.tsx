"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Align = "start" | "end";

const Ctx = React.createContext<{ close: () => void } | null>(null);

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  className,
}: {
  trigger: React.ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    "aria-expanded"?: boolean;
    "aria-haspopup"?: string;
  }>;
  children: React.ReactNode;
  align?: Align;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>("[role=menuitem]:not([aria-disabled=true])")?.focus();
  }, [open]);

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(
        "[role=menuitem]:not([aria-disabled=true])",
      ) ?? [],
    );
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length].focus();
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      {React.cloneElement(trigger, {
        onClick: (e: React.MouseEvent) => {
          trigger.props.onClick?.(e);
          setOpen((v) => !v);
        },
        "aria-expanded": open,
        "aria-haspopup": "menu",
      })}
      {open && (
        <div
          ref={menuRef}
          role="menu"
          onKeyDown={onMenuKeyDown}
          className={cn(
            "absolute z-40 mt-1 min-w-48 py-1",
            "bg-surface-raised border border-line rounded-lg shadow-lg",
            "animate-[lr-slide-up_var(--lr-duration-fast)_var(--lr-ease)]",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          <Ctx.Provider value={{ close }}>{children}</Ctx.Provider>
        </div>
      )}
    </div>
  );
}

export function DropdownItem({
  icon: Icon,
  destructive,
  disabled,
  onSelect,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  destructive?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
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
        onSelect?.();
        ctx?.close();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px]",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-content-accent",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        destructive
          ? "text-danger-600 hover:bg-danger-50"
          : "text-content-secondary hover:bg-surface-hover hover:text-content",
        className,
      )}
    >
      {Icon && <Icon className="size-4 shrink-0" />}
      {children}
    </button>
  );
}

export function DropdownSeparator() {
  return <div role="separator" className="my-1 h-px bg-line-subtle" />;
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-content-subtle">
      {children}
    </div>
  );
}
