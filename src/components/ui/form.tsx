import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Wires a field's controls to its own hint and error text.
 *
 * `FormField` used to render the error as a bare `<p>` with no `id`, and the
 * input carried neither `aria-describedby` nor `aria-invalid`. Sighted users
 * saw red text under the box; a screen-reader user focusing the input heard
 * the label and nothing else — WCAG 2.2 SC 3.3.1 (Error Identification) and
 * 4.1.2. Leaving each caller to wire it by hand had predictably not happened
 * across the ~90 forms in the product, so the association is made here once
 * and inherited.
 *
 * A control that sets its own `aria-describedby` or `aria-invalid` still wins:
 * the context only fills in what the caller left unset.
 */
type FieldDescription = {
  describedBy?: string;
  invalid: boolean;
};

const FieldCtx = React.createContext<FieldDescription | null>(null);

function useFieldProps(props: {
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}) {
  const field = React.useContext(FieldCtx);
  if (!field) return props;
  return {
    ...props,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}

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

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  const a11y = useFieldProps(props);
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
