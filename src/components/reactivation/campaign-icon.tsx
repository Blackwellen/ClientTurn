import * as React from "react";
import {
  Mail,
  MessageSquare,
  Megaphone,
  UserRoundCheck,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/ui/badge";
import {
  ICON_TONES,
  type CampaignIconKey,
} from "@/lib/campaigns/reactivation-types";

const ICONS: Record<CampaignIconKey, React.ComponentType<{ className?: string }>> =
  {
    email: Mail,
    message: MessageSquare,
    megaphone: Megaphone,
    audience: UserRoundCheck,
    alert: XCircle,
  };

const TILE_SIZES = {
  sm: "size-8 rounded-lg",
  md: "size-10 rounded-xl",
} as const;

const GLYPH_SIZES = {
  sm: "size-4",
  md: "size-[18px]",
} as const;

/**
 * The tinted tile that identifies a campaign in the card grid, the table and
 * the drawer header. One icon set, one stroke weight, one tone per key — so a
 * campaign looks the same wherever it appears.
 */
export function CampaignIcon({
  icon,
  size = "md",
  className,
}: {
  icon: CampaignIconKey;
  size?: keyof typeof TILE_SIZES;
  className?: string;
}) {
  const Glyph = ICONS[icon];
  const tone = ICON_TONES[icon];

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center",
        TILE_SIZES[size],
        tone.tile,
        className,
      )}
    >
      <Glyph className={cn(GLYPH_SIZES[size], tone.icon)} />
    </span>
  );
}

/**
 * The compact uppercase status pill used across the Reactivation surface.
 * Colour comes from the single `CAMPAIGN_STATUS` map in `ui/badge`; the label
 * is always present as text, so status is never conveyed by colour alone.
 */
export function CampaignStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <StatusBadge
      kind="campaign"
      value={status}
      dot={false}
      className={cn(
        "px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.04em] leading-[18px]",
        className,
      )}
    />
  );
}
