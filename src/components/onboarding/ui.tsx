"use client";

import * as React from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Dense dark-surface primitives for the onboarding wizard. These are
 * deliberately separate from the light-shell `@/components/ui/*` primitives —
 * onboarding continues the black/lime auth world (`--auth-*` tokens), not the
 * app shell's midnight-neutral ramp. Kept in one file per step so every step
 * shares the exact same control geometry instead of drifting.
 */

const FIELD_LABEL =
  "mb-1.5 block text-[13px] font-medium text-[#c3cbd8]";

export function OField({
  label,
  htmlFor,
  hint,
  required,
  className,
  children,
}: {
  label?: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={htmlFor} className={FIELD_LABEL}>
          {label}
          {required && <span className="text-[var(--auth-lime)]"> *</span>}
        </label>
      )}
      {children}
      {hint && <p className="mt-1.5 text-[12px] text-[#697488]">{hint}</p>}
    </div>
  );
}

const CONTROL_BASE = cn(
  "h-10 w-full rounded-[7px] px-3 text-[14px] outline-none transition-colors duration-150",
  "bg-[#0b141d] text-[#eef2f7] placeholder:text-[#5c6981]",
  "border border-[rgba(150,170,190,0.32)]",
  "focus:border-[rgba(168,255,31,0.75)] focus:ring-[3px] focus:ring-[rgba(168,255,31,0.1)]",
  "disabled:cursor-not-allowed disabled:opacity-50",
);

export const OInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function OInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_BASE, className)} {...props} />;
  },
);

export const OTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function OTextarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(CONTROL_BASE, "h-auto min-h-[80px] resize-none py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
});

export function OSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select
        className={cn(CONTROL_BASE, "appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#7a8698]"
        aria-hidden
      />
    </div>
  );
}

export function OToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-150",
        checked ? "bg-[var(--auth-lime)]" : "bg-[#586675]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]",
      )}
    >
      <span
        className={cn(
          "inline-block size-3.5 rounded-full bg-[#071009] shadow transition-transform duration-150",
          checked ? "translate-x-[18px] bg-[#071009]" : "translate-x-[3px] bg-[#0b141d]",
        )}
      />
    </button>
  );
}

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] text-[13.5px] font-semibold transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2";

const BUTTON_SIZES = {
  md: "h-[42px] px-4",
  sm: "h-8 px-3 text-[13px]",
};

const BUTTON_VARIANTS = {
  primary: cn(
    "bg-[var(--auth-lime)] text-[#071009] hover:bg-[var(--auth-lime-hover)]",
    "focus-visible:outline-[var(--auth-lime)]",
  ),
  secondary: cn(
    "border border-[rgba(150,170,190,0.35)] bg-transparent text-[#eef2f7] hover:border-[rgba(168,255,31,0.5)] hover:text-[var(--auth-lime)]",
    "focus-visible:outline-[var(--auth-lime)]",
  ),
  ghost: cn(
    "text-[#aab6c5] hover:text-[#eef2f7]",
    "focus-visible:outline-[var(--auth-lime)]",
  ),
};

export function OButton({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
  loading?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_SIZES[size], BUTTON_VARIANTS[variant], className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function OPanel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-[rgba(130,155,175,0.23)] bg-[#0a131b] p-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

const BADGE_TONES = {
  success: "bg-[rgba(168,255,31,0.12)] text-[var(--auth-lime)]",
  warning: "bg-[rgba(255,176,32,0.14)] text-[#ffb020]",
  danger: "bg-[rgba(255,77,85,0.14)] text-[#ff6b70]",
  neutral: "bg-[rgba(150,170,190,0.14)] text-[#a7b2c2]",
};

export function OBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium",
        BADGE_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function OSectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-semibold text-[#f8fafc]">{children}</h3>
      {hint && <p className="mt-0.5 text-[13px] text-[#96a1b3]">{hint}</p>}
    </div>
  );
}

export function MergeChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[5px] border border-[rgba(150,170,190,0.3)] bg-[#0b141d] px-1.5 py-0.5 font-mono text-[11.5px] text-[#9ad84a]">
      {children}
    </span>
  );
}

export function ORadioCard({
  selected,
  onSelect,
  disabled,
  children,
  className,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "flex w-full items-start gap-3 rounded-[10px] border p-3.5 text-left transition-colors duration-150",
        selected
          ? "border-[var(--auth-lime)] bg-[rgba(168,255,31,0.06)]"
          : "border-[rgba(150,170,190,0.28)] bg-[#0b141d] hover:border-[rgba(150,170,190,0.5)]",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-[var(--auth-lime)] bg-[var(--auth-lime)]" : "border-[#6b7688]",
        )}
      >
        {selected && <span className="size-1.5 rounded-full bg-[#071009]" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
