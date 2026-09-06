import * as React from "react";
import { cn } from "@/lib/cn";

const FIELD_BASE = cn(
  "w-full bg-surface text-content placeholder:text-content-subtle",
  "border border-line-strong rounded-md shadow-xs",
  "transition-colors duration-[var(--lr-duration-fast)]",
  "focus:outline-none focus:border-accent-500 focus:ring-2 focus:ring-[var(--lr-ring)]",
  "disabled:bg-surface-sunken disabled:text-content-muted disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger-500 aria-[invalid=true]:ring-danger-100",
);

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(FIELD_BASE, "h-9 px-3 text-sm", className)}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(FIELD_BASE, "min-h-20 px-3 py-2 text-sm resize-y", className)}
      {...props}
    />
  );
});

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(FIELD_BASE, "h-9 pl-3 pr-8 text-sm appearance-none", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%236b7a8f' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 10px center",
      }}
      {...props}
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
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-[12px] text-danger-600">{error}</p>
      ) : hint ? (
        <p className="text-[12px] text-content-muted">{hint}</p>
      ) : null}
    </div>
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
        checked
          ? tone === "success"
            ? "bg-success-500"
            : "bg-accent-600"
          : "bg-line-strong",
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
