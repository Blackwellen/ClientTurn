import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The small repeated shapes of the reactivation wizard: the icon tile that
 * opens every section, the right-rail card, the label/value row and the
 * ticked list item. Kept in one file so the three steps stay visually
 * identical without copying class strings between them.
 */

const TILE_TONES = {
  accent: "bg-accent-50 text-content-accent",
  info: "bg-info-50 text-info-700",
  success: "bg-success-50 text-success-600",
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
        "flex size-9 shrink-0 items-center justify-center rounded-lg",
        TILE_TONES[tone],
        className,
      )}
    >
      <Icon className="size-[18px]" />
    </span>
  );
}

/** Section heading inside the main wizard card. */
export function StepSection({
  icon,
  tone,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <IconTile icon={icon} tone={tone} />
          <div className="min-w-0">
            <h3 className="text-content text-[15px] font-semibold">{title}</h3>
            {description && (
              <p className="text-content-muted mt-0.5 text-[13px]">
                {description}
              </p>
            )}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A card in the narrow right-hand rail. */
export function RailCard({
  icon,
  tone,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone?: TileTone;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border-line rounded-xl border shadow-xs">
      <div className="border-line-subtle flex items-start gap-3 border-b px-4 py-3.5">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0">
          <h3 className="text-content text-[14px] font-semibold">{title}</h3>
          {description && (
            <p className="text-content-muted mt-0.5 text-[12px]">{description}</p>
          )}
        </div>
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** Label on the left, value on the right, hairline between rows. */
export function SummaryRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  /** Highlights the bottom line of a set of figures. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2 text-[13px]",
        emphasis && "bg-success-50 rounded-md",
      )}
    >
      <span
        className={cn(
          emphasis ? "text-content font-semibold" : "text-content-secondary",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "lr-tabular",
          emphasis ? "text-content font-semibold" : "text-content font-medium",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function SummaryTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-line divide-line-subtle divide-y rounded-lg border">
      {children}
    </div>
  );
}

/** Green tick + label, used by every checklist in the wizard. */
export function CheckItem({
  label,
  done = true,
  size = "sm",
}: {
  label: React.ReactNode;
  done?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-px flex shrink-0 items-center justify-center rounded-full",
          size === "md" ? "size-5" : "size-4",
          done
            ? "bg-success-500 text-white"
            : "border-line-strong text-content-subtle border bg-surface",
        )}
      >
        {done && <Check className={size === "md" ? "size-3" : "size-2.5"} />}
      </span>
      <span
        className={cn(
          "text-[13px]",
          done ? "text-content-secondary" : "text-content-muted",
        )}
      >
        {label}
        <span className="sr-only">{done ? " (done)" : " (outstanding)"}</span>
      </span>
    </li>
  );
}

/** The big number a rail card leads with. */
export function BigFigure({
  value,
  caption,
  tone = "success",
}: {
  value: string;
  caption: string;
  tone?: "success" | "danger" | "info";
}) {
  const colour =
    tone === "danger"
      ? "text-danger-600"
      : tone === "info"
        ? "text-info-700"
        : "text-success-600";
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={cn("lr-tabular text-[30px] font-bold leading-none", colour)}>
        {value}
      </span>
      <span className="text-content-muted text-[13px]">{caption}</span>
    </p>
  );
}

/** One of the three prominent figures on Step 3. */
export function StatTile({
  value,
  label,
  caption,
  tone,
}: {
  value: string;
  label: string;
  caption: string;
  tone: "success" | "danger" | "info";
}) {
  const styles = {
    success: "bg-success-50 border-success-100 text-success-600",
    danger: "bg-danger-50 border-danger-100 text-danger-600",
    info: "bg-info-50 border-info-100 text-info-700",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-4 py-3.5", styles)}>
      <p className="lr-tabular text-[26px] font-bold leading-none">{value}</p>
      <p className="text-content mt-2 text-[13px] font-medium">{label}</p>
      <p className="text-content-muted mt-0.5 text-[12px]">{caption}</p>
    </div>
  );
}

/** Horizontal share bar used by the audience breakdown. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span
      aria-hidden
      className="bg-surface-sunken h-1.5 w-full overflow-hidden rounded-full"
    >
      <span
        className="bg-success-500 block h-full rounded-full"
        style={{ width: `${Math.min(100, Math.max(2, share))}%` }}
      />
    </span>
  );
}

const BANNER_TONES = {
  success: "border-success-100 bg-success-50",
  danger: "border-danger-100 bg-danger-50",
  warning: "border-warning-100 bg-warning-50",
  info: "border-info-100 bg-info-50",
} as const;

export function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof BANNER_TONES;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const iconTone =
    tone === "success"
      ? "bg-success-500 text-white"
      : tone === "danger"
        ? "bg-danger-600 text-white"
        : tone === "warning"
          ? "bg-warning-500 text-white"
          : "bg-info-600 text-white";

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3.5 py-3",
        BANNER_TONES[tone],
      )}
    >
      <span
        aria-hidden
        className={cn(
          "mt-px flex size-5 shrink-0 items-center justify-center rounded-full",
          iconTone,
        )}
      >
        <Icon className="size-3" />
      </span>
      <div className="text-content-secondary min-w-0 text-[13px]">{children}</div>
    </div>
  );
}

export function formatCount(value: number) {
  return value.toLocaleString("en-GB");
}
