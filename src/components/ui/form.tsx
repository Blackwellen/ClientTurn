import * as React from "react";
import { cn } from "@/lib/cn";

import { FIELD_BASE, FieldCtx, useFieldProps } from "./field";

export { Select, Combobox } from "./select";
export type { SelectProps, SelectOption, ComboboxProps } from "./select";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  const a11y = useFieldProps(props);
  return (
    <input
      ref={ref}
      className={cn(FIELD_BASE, "h-9 px-3 text-sm", className)}
      {...a11y}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  const a11y = useFieldProps(props);
  return (
    <textarea
      ref={ref}
      className={cn(FIELD_BASE, "min-h-20 px-3 py-2 text-sm resize-y", className)}
      {...a11y}
    />
  );
});

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label
      className={cn("block text-[13px] font-medium text-content", className)}
      {...props}
    >
      {children}
      {required && (
        <span className="text-danger-600 ml-0.5" aria-hidden>
          *
        </span>
      )}
    </label>
  );
}

export function FormField({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reactId = React.useId();
  const messageId = `${htmlFor ?? reactId}-message`;
  const described = error || hint ? messageId : undefined;

  return (
    <FieldCtx.Provider value={{ describedBy: described, invalid: !!error }}>
      <div className={cn("space-y-1.5", className)}>
        {label && (
          <Label htmlFor={htmlFor} required={required}>
            {label}
          </Label>
        )}
        {children}
        {error ? (
          // `alert` so a validation failure that appears after submit is
          // announced, not just rendered.
          <p id={messageId} role="alert" className="text-[12px] text-danger-600">
            {error}
          </p>
        ) : hint ? (
          <p id={messageId} className="text-[12px] text-content-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldCtx.Provider>
  );
}

export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "size-4 rounded-xs border border-line-strong text-content-accent",
        "accent-[var(--lr-accent-600)] cursor-pointer",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  tone = "accent",
  size = "md",
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  /** "success" reads as "this is on and healthy" rather than a brand accent. */
  tone?: "accent" | "success";
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 items-center rounded-full",
        "transition-colors duration-[var(--lr-duration-fast)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent",
        "disabled:cursor-not-allowed disabled:opacity-60",
        size === "lg" ? "h-[22px] w-10" : "h-5 w-9",
        // Track colours carry the state, so each clears 3:1 against the
        // surface (SC 1.4.11): success-500 and line-strong measured 2.6:1
        // and 1.4:1, which left an "off" switch all but invisible.
        checked
          ? tone === "success"
            ? "bg-success-600"
            : "bg-accent-600"
          : "bg-[var(--lr-switch-off)]",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-white shadow-sm",
          "transition-transform duration-[var(--lr-duration-fast)]",
          size === "lg" ? "size-[18px]" : "size-4",
          checked
            ? size === "lg"
              ? "translate-x-[20px]"
              : "translate-x-4.5"
            : "translate-x-0.5",
        )}
      />
    </button>
  );
}
