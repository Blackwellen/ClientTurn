import * as React from "react";
import {
  Globe,
  Upload,
  UserPlus,
  PenLine,
  RotateCcw,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { sourceLabel, type LeadSourceRef } from "@/lib/leads/types";

/* --------------------------------------------------------------------------
   Brand marks. Inline SVG rather than a hosted icon set so the badge renders
   with no network request and no third-party asset in the bundle. Only the
   providers Client Turn actually ingests from are represented — an unknown
   provider gets the neutral globe, never an invented network.
   -------------------------------------------------------------------------- */

function MetaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <path
        d="M6.2 5.5C3.9 5.5 2.4 7.9 2.4 11.2c0 3.2 1.4 5.3 3.5 5.3 1.6 0 2.6-1 4.1-3.5l1-1.7c.3-.5.6-1 .9-1.5.3.5.6 1 .9 1.5l1 1.7c1.5 2.5 2.5 3.5 4.1 3.5 2.1 0 3.6-2.1 3.6-5.4 0-3.3-1.6-5.6-3.9-5.6-1.5 0-2.7.9-4 2.9l-.7 1.1-.7-1.1c-1.3-2-2.5-2.9-4-2.9Zm0 1.9c1 0 1.9.9 3 2.6l.5.8-.6 1c-1.2 2-1.9 2.7-2.8 2.7-1 0-1.8-1.2-1.8-3.4 0-2.3.8-3.7 1.7-3.7Zm11.6 0c.9 0 1.7 1.4 1.7 3.7 0 2.2-.8 3.4-1.8 3.4-.9 0-1.6-.7-2.8-2.7l-.6-1 .5-.8c1.1-1.7 2-2.6 3-2.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FacebookMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12Z"
        fill="currentColor"
      />
    </svg>
  );
}

function InstagramMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3.8" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" />
    </svg>
  );
}

function GoogleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="#4285F4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.4Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2L6.4 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.4L6.4 10c.8-2.3 3-4.1 5.6-4.1Z"
      />
    </svg>
  );
}

type ProviderStyle = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Applied to the icon only — the pill itself stays neutral. */
  iconClass?: string;
};

/**
 * The real source taxonomy. Anything Client Turn does not ingest from is
 * deliberately absent: a badge is a claim about where a lead came from, and
 * an invented network would be a false one.
 */
const PROVIDERS: Record<string, ProviderStyle> = {
  meta: { label: "Meta", icon: MetaMark, iconClass: "text-[#0866FF]" },
  meta_lead_ads: { label: "Meta", icon: MetaMark, iconClass: "text-[#0866FF]" },
  facebook: { label: "Facebook", icon: FacebookMark, iconClass: "text-[#1877F2]" },
  instagram: {
    label: "Instagram",
    icon: InstagramMark,
    iconClass: "text-[#E1306C]",
  },
  google: { label: "Google Ads", icon: GoogleMark },
  google_ads: { label: "Google Ads", icon: GoogleMark },
  website: { label: "Website", icon: Globe, iconClass: "text-content-muted" },
  webhook: { label: "Website", icon: Globe, iconClass: "text-content-muted" },
  referral: { label: "Referral", icon: UserPlus, iconClass: "text-content-muted" },
  manual: { label: "Manual", icon: PenLine, iconClass: "text-content-muted" },
  import: { label: "Imported", icon: Upload, iconClass: "text-content-muted" },
  csv: { label: "Imported", icon: Upload, iconClass: "text-content-muted" },
  reactivation: {
    label: "Reactivation",
    icon: RotateCcw,
    iconClass: "text-content-muted",
  },
};

export function providerStyle(provider: string | null | undefined): ProviderStyle {
  const key = (provider ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  return (
    PROVIDERS[key] ?? {
      label: provider ? provider.replace(/_/g, " ") : "Unknown",
      icon: HelpCircle,
      iconClass: "text-content-subtle",
    }
  );
}

/**
 * Compact source pill used in both list views. Shows the provider, not the
 * campaign — the campaign belongs in the drawer where there is room for it.
 */
export function LeadSourceBadge({
  source,
  size = "md",
  className,
}: {
  source: LeadSourceRef | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const style = providerStyle(source?.provider);
  const Icon = style.icon;
  const detail = sourceLabel(source);

  return (
    <span
      title={detail !== style.label ? `${style.label} · ${detail}` : style.label}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line-subtle",
        "bg-surface-sunken/70 font-medium text-content-secondary",
        size === "sm"
          ? "h-[22px] px-1.5 text-[11px]"
          : "h-[26px] px-2 text-[12px]",
        className,
      )}
    >
      <Icon
        className={cn(size === "sm" ? "size-3" : "size-3.5", "shrink-0", style.iconClass)}
      />
      <span className="truncate">{style.label}</span>
    </span>
  );
}

/** Larger provider glyph for the drawer's source summary. */
export function LeadSourceGlyph({
  provider,
  className,
}: {
  provider: string | null | undefined;
  className?: string;
}) {
  const style = providerStyle(provider);
  const Icon = style.icon;
  return <Icon className={cn("size-5", style.iconClass, className)} />;
}
