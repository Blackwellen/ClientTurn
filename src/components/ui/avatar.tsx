"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Size = "xs" | "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, string> = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-8 text-[11px]",
  lg: "size-10 text-[13px]",
  xl: "size-14 text-[18px]",
};

const PALETTE = [
  "bg-accent-100 text-content-accent",
  "bg-success-100 text-success-700",
  "bg-warning-100 text-warning-700",
  "bg-danger-100 text-danger-700",
  "bg-info-100 text-info-700",
  "bg-purple-100 text-purple-700",
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paletteFor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: Size;
  className?: string;
}) {
  const base = cn(
    "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
    SIZES[size],
    className,
  );

  // Reset the broken-image flag whenever the source changes (e.g. the list
  // re-renders with a different lead) so a previous failure doesn't stick.
  // Adjusted during render rather than in an effect, per React's guidance
  // for state that depends on a changed prop.
  const [failed, setFailed] = React.useState(false);
  const [trackedSrc, setTrackedSrc] = React.useState(src);
  if (src !== trackedSrc) {
    setTrackedSrc(src);
    setFailed(false);
  }

  if (src && !failed) {
    return (
      // Avatars may come from short-lived R2 signed URLs or a Gravatar
      // lookup (which 404s when nothing is registered for the address), so
      // next/image optimisation cannot cache them and a load failure is
      // expected, not exceptional — it falls back to initials below.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        onError={() => setFailed(true)}
        className={cn(base, "object-cover bg-surface-sunken")}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(base, paletteFor(name))}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
  className,
}: {
  people: { name: string; src?: string | null }[];
  max?: number;
  size?: Size;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  return (
    <div className={cn("flex items-center", className)}>
      {shown.map((p, i) => (
        <Avatar
          key={`${p.name}-${i}`}
          name={p.name}
          src={p.src}
          size={size}
          className="ring-2 ring-[var(--lr-surface)] -ml-1.5 first:ml-0"
        />
      ))}
      {overflow > 0 && (
        <span
          aria-label={`${overflow} more`}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
            "bg-surface-sunken text-content-secondary ring-2 ring-[var(--lr-surface)] -ml-1.5 lr-tabular",
            SIZES[size],
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
