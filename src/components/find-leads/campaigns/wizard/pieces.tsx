import * as React from "react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The shapes every wizard step is built from.
 *
 * They live together because the six steps have to look like one screen with
 * different contents, not six screens that happen to share a header. A card
 * header, a helper rail card and a field row are each defined once here and
 * nowhere else.
 */

/** A panel with an icon badge, a title and a line of explanation. */
export function SectionCard({
  icon: Icon,
  title,
  description,
  tone = "accent",
  action,
  className,
  bodyClassName,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  tone?: "accent" | "info" | "warning" | "purple" | "danger";
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface shadow-xs overflow-hidden",
        className,
      )}
    >
      <header className="flex items-start gap-3 px-5 pt-5 pb-4">
        <IconBadge icon={Icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold leading-tight text-content">{title}</h2>
          {description && (
            <p className="mt-1 text-[12.5px] leading-snug text-content-muted">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children && (
        <div className={cn("border-t border-line-subtle px-5 py-4", bodyClassName)}>
          {children}
        </div>
      )}
    </section>
  );
}

const BADGE_TONES: Record<string, string> = {
  accent: "bg-success-50 text-success-600",
  info: "bg-info-50 text-info-600",
  warning: "bg-warning-50 text-warning-600",
  purple: "bg-purple-50 text-purple-600",
  danger: "bg-danger-50 text-danger-600",
};

export function IconBadge({
  icon: Icon,
  tone = "accent",
  className,
}: {
  icon: LucideIcon;
  tone?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
        BADGE_TONES[tone] ?? BADGE_TONES.accent,
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

/** A right-rail card. Same construction as SectionCard, tighter by design. */
export function RailCard({
  icon: Icon,
  title,
  description,
  tone = "accent",
  className,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  tone?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-line bg-surface p-4 shadow-xs", className)}>
      <div className="flex items-start gap-2.5">
        {Icon && <IconBadge icon={Icon} tone={tone} className="size-8 rounded-lg" />}
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold leading-tight text-content">{title}</h3>
          {description && (
            <p className="mt-0.5 text-[12px] leading-snug text-content-muted">{description}</p>
          )}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A tick list, used by every "tips" card in the designs. */
export function TickList({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex gap-2 text-[12.5px] leading-snug text-content-secondary">
          <span
            aria-hidden
            className="mt-[1px] flex size-4 shrink-0 items-center justify-center rounded-full bg-success-500 text-white"
          >
            <Check className="size-2.5" strokeWidth={3} />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** A labelled field with hint and error, matching the wizard's spacing. */
export function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cn("min-w-0", className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-content"
      >
        {label}
        {required && (
          <span className="ml-0.5 text-danger-600" aria-hidden>
            *
          </span>
        )}
      </label>
      <div className="mt-1.5">{children}</div>
      {error ? (
        <p id={describedBy} className="mt-1.5 text-[12px] text-danger-600">
          {error}
        </p>
      ) : hint ? (
        <p id={describedBy} className="mt-1.5 text-[12px] text-content-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A radio row with a title and a supporting line, as used for the source and
 *  promotion choices. */
export function RadioRow({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
  disabledReason,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const id = `${name}-${value}`;

  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className={cn(
          "mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--lr-success-600)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-600",
          disabled && "cursor-not-allowed opacity-50",
        )}
      />
      <label htmlFor={id} className={cn("min-w-0", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="block text-[13px] font-medium leading-snug text-content">{title}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-snug text-content-muted">
            {description}
          </span>
        )}
        {disabled && disabledReason && (
          <span className="mt-0.5 block text-[12px] leading-snug text-warning-700">
            {disabledReason}
          </span>
        )}
      </label>
    </div>
  );
}

/** A checkbox row for the exclusion list. */
export function CheckRow({
  id,
  checked,
  onChange,
  title,
  description,
  locked,
  lockedReason,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description?: string;
  /** A rule the customer is not permitted to switch off. */
  locked?: boolean;
  lockedReason?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby={locked && lockedReason ? `${id}-locked` : undefined}
        className={cn(
          "mt-0.5 size-4 shrink-0 rounded-[4px] accent-[var(--lr-success-600)]",
          locked ? "cursor-not-allowed opacity-90" : "cursor-pointer",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-success-600",
        )}
      />
      <label htmlFor={id} className={cn("min-w-0", locked ? "cursor-not-allowed" : "cursor-pointer")}>
        <span className="block text-[13px] font-medium leading-snug text-content">{title}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-snug text-content-muted">
            {description}
          </span>
        )}
        {locked && lockedReason && (
          <span
            id={`${id}-locked`}
            className="mt-0.5 block text-[12px] leading-snug text-content-subtle"
          >
            {lockedReason}
          </span>
        )}
      </label>
    </div>
  );
}

/** A removable token, used for locations, industries, roles and categories. */
export function Chip({
  label,
  onRemove,
  tone = "neutral",
}: {
  label: string;
  onRemove?: () => void;
  tone?: "neutral" | "accent";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-medium",
        tone === "accent"
          ? "border-success-100 bg-success-50 text-success-700"
          : "border-line bg-surface-sunken text-content-secondary",
      )}
    >
      <span className="truncate">{label}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="text-content-subtle transition-colors hover:text-content"
          aria-label={`Remove ${label}`}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path
              d="M2.5 2.5l7 7m0-7l-7 7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}

/** The key/value rows used by the targeting and review summaries. */
export function SummaryRow({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-line-subtle py-2 last:border-0",
        className,
      )}
    >
      <dt className="shrink-0 text-[12px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[12.5px] font-medium text-content">{value}</dd>
    </div>
  );
}

/** A meter with its own label and figures, as used by Plan usage. */
export function Meter({
  label,
  used,
  limit,
  format,
}: {
  label: string;
  used: number;
  limit: number;
  format: (value: number) => string;
}) {
  const percent = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tone =
    percent >= 100 ? "bg-danger-500" : percent >= 80 ? "bg-warning-500" : "bg-success-500";

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[12px] text-content-secondary">{label}</span>
        <span className="shrink-0 text-[11.5px] tabular-nums text-content-muted">
          {format(used)} / {format(limit)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div className={cn("h-full rounded-full", tone)} style={{ width: `${percent}%` }} />
        </div>
        <span className="w-8 shrink-0 text-right text-[11.5px] tabular-nums text-content-muted">
          {percent}%
        </span>
      </div>
    </div>
  );
}

/** A tinted note box. Used for the email-first policy and "things to know". */
export function NoteBox({
  icon: Icon,
  tone = "info",
  title,
  children,
  className,
}: {
  icon?: LucideIcon;
  tone?: "info" | "warning" | "accent";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-info-100 bg-info-50 text-info-700",
    warning: "border-warning-100 bg-warning-50 text-warning-700",
    accent: "border-success-100 bg-success-50 text-success-700",
  } as const;

  return (
    <div className={cn("flex gap-2.5 rounded-lg border px-3.5 py-3", tones[tone], className)}>
      {Icon && <Icon className="mt-px size-4 shrink-0" aria-hidden />}
      <div className="min-w-0 text-[12px] leading-snug">
        {title && <p className="font-semibold text-content">{title}</p>}
        <div className={cn(title && "mt-0.5", "text-content-secondary")}>{children}</div>
      </div>
    </div>
  );
}
