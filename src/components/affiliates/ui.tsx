import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Shared presentation for the partner portal.
 *
 * A deliberately small set. The portal has six pages that are all "a heading, a
 * few numbers and a table", and giving each one its own layout is how they
 * drift apart.
 */

export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-xs",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-content">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12.5px] text-content-muted">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export function SectionEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-5 py-10 text-center text-[13px] text-content-muted">
      {children}
    </p>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
      <p className="text-[12px] text-content-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-[22px] font-semibold tabular-nums",
          tone === "success" && "text-success-700",
          tone === "warning" && "text-warning-700",
          tone === "danger" && "text-danger-600",
          !tone && "text-content",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11.5px] text-content-subtle">{hint}</p>}
    </div>
  );
}

/** A plain data table. Scrolls inside itself so the page never scrolls sideways. */
export function DataGrid({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-y border-line-subtle bg-surface-sunken/60">
            {headers.map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-2 text-[11.5px] font-medium uppercase tracking-wide text-content-subtle sm:px-5"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">{children}</tbody>
      </table>
    </div>
  );
}

export function Cell({
  children,
  className,
  numeric,
}: {
  /** Optional so a spacer cell can be written as a bare `<Cell />`. */
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 text-[13px] text-content sm:px-5",
        numeric && "tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}
