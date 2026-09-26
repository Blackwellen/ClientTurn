import * as React from "react";
import {
  Bot,
  Briefcase,
  Building2,
  Code2,
  CalendarDays,
  DoorOpen,
  FlaskConical,
  Globe,
  Mail,
  MessageCircle,
  Music2,
  PenLine,
  PhoneCall,
  Plug,
  RotateCcw,
  Search,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { sourceLabel, type LeadSourceRef } from "@/lib/leads/types";

/**
 * Neutral glyphs in tinted tiles, never a reproduced brand mark — the same
 * rule (and, where the vocabularies overlap, the same glyph and tint) as
 * `components/settings/connections/provider-icon.tsx`, so a source reads
 * identically in Leads and in Connections.
 *
 * Lead sources carry a wider vocabulary than the integration catalog: a lead
 * can arrive from a website form, a referral, a manual entry or a
 * reactivation campaign, none of which are connectable providers.
 */
type SourceStyle = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
};

const NEUTRAL = "bg-surface-sunken text-content-muted border-line";
const INFO = "bg-info-50 text-info-600 border-info-100";

const SOURCES: Record<string, SourceStyle> = {
  // Meta family — one glyph, distinct labels. The label carries the
  // distinction; the mark stays generic.
  meta: { label: "Meta", icon: Users, tint: INFO },
  meta_lead_ads: { label: "Meta", icon: Users, tint: INFO },
  facebook: { label: "Facebook", icon: Users, tint: INFO },
  instagram: { label: "Instagram", icon: Users, tint: INFO },
  // A Messenger or Instagram DM that became a lead (social/meta-inbound.ts).
  meta_dm: { label: "Meta message", icon: MessageCircle, tint: INFO },
  meta_webhook: { label: "Meta", icon: Users, tint: INFO },

  google: {
    label: "Google Ads",
    icon: Search,
    tint: "bg-warning-50 text-warning-700 border-warning-100",
  },
  google_ads: {
    label: "Google Ads",
    icon: Search,
    tint: "bg-warning-50 text-warning-700 border-warning-100",
  },
  tiktok_ads: { label: "TikTok Ads", icon: Music2, tint: NEUTRAL },
  // The catalogue's name for the connection, so a lead reads the same here as
  // the card it came from in Settings -> Connections.
  linkedin_ads: { label: "LinkedIn Lead Gen Forms", icon: Briefcase, tint: INFO },
  linkedin: { label: "LinkedIn", icon: Briefcase, tint: INFO },
  tiktok: { label: "TikTok", icon: Music2, tint: NEUTRAL },

  website: { label: "Website", icon: Globe, tint: NEUTRAL },
  webhook: { label: "Website", icon: Globe, tint: NEUTRAL },
  webform: { label: "Website form", icon: Globe, tint: NEUTRAL },
  // Machine callers, named for a person rather than as raw slugs.
  api: { label: "API", icon: Code2, tint: NEUTRAL },
  mcp: { label: "AI assistant", icon: Bot, tint: NEUTRAL },
  connector: { label: "Connected app", icon: Plug, tint: NEUTRAL },
  hubspot: { label: "HubSpot", icon: Briefcase, tint: NEUTRAL },
  zoho_crm: { label: "Zoho CRM", icon: Briefcase, tint: NEUTRAL },
  salesforce: { label: "Salesforce", icon: Briefcase, tint: NEUTRAL },
  email: { label: "Email", icon: Mail, tint: NEUTRAL },
  referral: {
    label: "Referral",
    icon: UserPlus,
    tint: "bg-purple-50 text-purple-700 border-purple-100",
  },
  manual: { label: "Manual", icon: PenLine, tint: NEUTRAL },
  // The manual intake vocabulary the Add Lead wizard writes. Each reads as its
  // own origin rather than collapsing into a generic "Manual".
  phone_call: { label: "Phone call", icon: PhoneCall, tint: NEUTRAL },
  walk_in: { label: "Walk-in", icon: DoorOpen, tint: NEUTRAL },
  event: { label: "Event", icon: CalendarDays, tint: NEUTRAL },
  pipedrive: { label: "Pipedrive", icon: Briefcase, tint: NEUTRAL },
  other: { label: "Other", icon: Building2, tint: NEUTRAL },
  import: { label: "Imported", icon: Upload, tint: NEUTRAL },
  csv: { label: "Imported", icon: Upload, tint: NEUTRAL },
  csv_import: { label: "Imported", icon: Upload, tint: NEUTRAL },
  manual_prospect: { label: "Promoted prospect", icon: UserPlus, tint: NEUTRAL },
  reactivation: {
    label: "Reactivation",
    icon: RotateCcw,
    tint: "bg-accent-50 text-content-accent border-accent-200/60",
  },
  test: { label: "Test", icon: FlaskConical, tint: NEUTRAL },
};

export function sourceStyle(provider: string | null | undefined): SourceStyle {
  const key = (provider ?? "").toLowerCase().replace(/[\s-]+/g, "_");
  return (
    SOURCES[key] ?? {
      // Same fallback shape as ProviderIcon: name it plainly rather than
      // guessing at a network we do not actually ingest from.
      label: provider ? provider.replace(/_/g, " ") : "Unknown",
      icon: Building2,
      tint: NEUTRAL,
    }
  );
}

/**
 * Compact source pill for both list views. Shows the provider, not the
 * campaign — the campaign belongs in the drawer, where there is room for it.
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
  const style = sourceStyle(source?.provider);
  const Icon = style.icon;
  const detail = sourceLabel(source);

  return (
    <span
      title={detail !== style.label ? `${style.label} · ${detail}` : style.label}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-md border border-line-subtle",
        "bg-surface font-medium text-content-secondary",
        size === "sm" ? "h-[22px] pl-1 pr-2 text-[11px]" : "h-[26px] pl-1 pr-2 text-[12px]",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[4px] border",
          size === "sm" ? "size-[15px]" : "size-[18px]",
          style.tint,
        )}
      >
        <Icon className={size === "sm" ? "size-2.5" : "size-3"} />
      </span>
      <span className="truncate">{style.label}</span>
    </span>
  );
}

/**
 * Tile-sized glyph for the drawer, matching `ProviderIcon`'s dimensions so the
 * two surfaces line up.
 */
export function LeadSourceGlyph({
  provider,
  size = "md",
  className,
}: {
  provider: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}) {
  const style = sourceStyle(provider);
  const Icon = style.icon;

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[10px] border",
        size === "sm" ? "size-8" : "size-9",
        style.tint,
        className,
      )}
    >
      <Icon className={size === "sm" ? "size-4" : "size-[18px]"} />
    </span>
  );
}
