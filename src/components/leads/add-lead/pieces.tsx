import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The repeated shapes of the Add Lead wizard: the icon tile that opens every
 * section, the bordered section card, the right-rail card and the numbered
 * guidance list. Kept in one file so all four steps stay visually identical
 * without class strings being copied between them.
 */

const TILE_TONES = {
  accent: "bg-accent-50 text-content-accent",
  info: "bg-info-50 text-info-700",
  success: "bg-success-50 text-success-600",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-600",
  neutral: "bg-surface-sunken text-content-muted",
} as const;

export type TileTone = keyof typeof TILE_TONES;

export function IconTile({
  icon: Icon,
  tone = "info",
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className="size-[17px]" />
    </span>
  );
}

/** A bordered card in the main column, with an icon-led heading. */
export function SectionCard({
  icon,
  tone = "neutral",
  title,
  description,
  action,
  children,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <IconTile icon={icon} tone={tone} />}
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-content">{title}</h3>
            {description && (
              <p className="mt-0.5 text-[12.5px] text-content-muted">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children && <div className="mt-3.5">{children}</div>}
    </section>
  );
}

/** The step's own heading, above the cards. */
export function StepHeading({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <header>
      <h2 className="text-[21px] font-bold leading-tight tracking-[-0.02em] text-content">
        Step {step} — {title}
      </h2>
      <p className="mt-1 text-[13px] text-content-muted">{description}</p>
    </header>
  );
}

/* --------------------------------------------------------------- the rail */

export function RailCard({
  icon,
  tone = "info",
  title,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface p-4 shadow-xs",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <IconTile icon={icon} tone={tone} />
        <h3 className="text-[14px] font-semibold text-content">{title}</h3>
      </div>
      {children && <div className="mt-3">{children}</div>}
    </section>
  );
}

const NOTE_TONES = {
  success: "border-success-100 bg-success-50/70",
  info: "border-info-100 bg-info-50/70",
  warning: "border-warning-100 bg-warning-50/70",
} as const;

/** The tinted footnote card at the bottom of each rail. */
export function RailNote({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: keyof typeof NOTE_TONES;
  title: string;
  children: React.ReactNode;
}) {
  const iconTone =
    tone === "success"
      ? "bg-success-500 text-white"
      : tone === "warning"
        ? "bg-warning-500 text-white"
        : "bg-info-500 text-white";

  return (
    <div className={cn("rounded-xl border p-3.5", NOTE_TONES[tone])}>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full",
            iconTone,
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-content">{title}</p>
          <p className="mt-0.5 text-[12px] leading-[1.45] text-content-secondary">
            {children}
          </p>
        </div>
      </div>
    </div>
  );
}

/** The numbered "what happens next" list used by every rail. */
export function GuidanceList({
  items,
  activeIndex,
}: {
  items: { title: string; detail: string }[];
  activeIndex?: number;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => {
        const active = activeIndex === index;
        return (
          <li key={item.title} className="flex gap-2.5">
            <span className="flex flex-col items-center">
              <span
                aria-hidden
                className={cn(
                  "lr-tabular flex size-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  active
                    ? "bg-success-500 text-white"
                    : "bg-surface-sunken text-content-muted",
                )}
              >
                {index + 1}
              </span>
              {index < items.length - 1 && (
                <span aria-hidden className="mt-1 w-px flex-1 bg-line" />
              )}
            </span>
            <div className="min-w-0 pb-0.5">
              <p className="text-[12.5px] font-semibold text-content">
                {item.title}
              </p>
              <p className="mt-0.5 text-[12px] leading-[1.45] text-content-muted">
                {item.detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** A coloured dot + label + detail row, used by the relationship guidance. */
export function DotList({
  items,
}: {
  items: { label: string; detail: string; tone: "success" | "warning" | "danger" }[];
}) {
  const DOT = {
    success: "bg-success-500",
    warning: "bg-warning-500",
    danger: "bg-danger-500",
  } as const;

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="flex gap-2.5">
          <span
            aria-hidden
            className={cn("mt-1 size-2.5 shrink-0 rounded-full", DOT[item.tone])}
          />
          <div className="min-w-0">
            <p className="text-[12.5px] font-semibold text-content">{item.label}</p>
            <p className="mt-0.5 text-[12px] leading-[1.45] text-content-muted">
              {item.detail}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "116/500" under a textarea. Turns red once the limit is passed. */
export function CharCount({ value, max }: { value: string; max: number }) {
  return (
    <p
      className={cn(
        "lr-tabular mt-1 text-right text-[11.5px]",
        value.length > max ? "text-danger-600" : "text-content-subtle",
      )}
    >
      {value.length}/{max}
    </p>
  );
}

/** Two-column responsive grid used by the field groups. */
export function FieldRow({
  columns = 3,
  children,
}: {
  columns?: 2 | 3;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid gap-3",
        columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3",
      )}
    >
      {children}
    </div>
  );
}

/** Label / value line used by the Step 4 lead summary. */
export function SummaryRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 py-1">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-content-subtle" aria-hidden />
      <span className="w-[86px] shrink-0 text-[12px] leading-[1.35] text-content-muted">
        {label}
      </span>
      <span className="min-w-0 flex-1 text-[12.5px] font-medium text-content">
        {value}
      </span>
    </div>
  );
}
