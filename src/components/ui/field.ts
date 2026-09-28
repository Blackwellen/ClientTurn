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
 *
 * Lives outside form.tsx so the Select primitive (select.tsx) can share it
 * without a circular import.
 */
export type FieldDescription = {
  describedBy?: string;
  invalid: boolean;
};

export const FieldCtx = React.createContext<FieldDescription | null>(null);

export function useFieldProps<
  P extends {
    "aria-describedby"?: string;
    "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  },
>(props: P): P {
  const field = React.useContext(FieldCtx);
  if (!field) return props;
  return {
    ...props,
    "aria-describedby": props["aria-describedby"] ?? field.describedBy,
    "aria-invalid": props["aria-invalid"] ?? (field.invalid || undefined),
  };
}

export const FIELD_BASE = cn(
  "w-full bg-surface text-content placeholder:text-content-subtle",
  "border border-line-strong rounded-md shadow-xs",
  "transition-colors duration-[var(--lr-duration-fast)]",
  "focus:outline-none focus:border-[var(--lr-focus-border)] focus:ring-2 focus:ring-[var(--lr-ring)]",
  "disabled:bg-surface-sunken disabled:text-content-muted disabled:cursor-not-allowed",
  "aria-[invalid=true]:border-danger-500 aria-[invalid=true]:ring-danger-100",
);
