import * as React from "react";
import { FileSpreadsheet, FlaskConical, Globe, Megaphone, UserPlus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * The real source taxonomy (`lead_sources.provider`), not a wishlist of
 * integrations. An unrecognised provider renders nothing rather than a
 * misleading logo, and no third-party brand marks are shipped.
 */
const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  meta: Megaphone,
  webform: Globe,
  csv: FileSpreadsheet,
  manual: UserPlus,
  test: FlaskConical,
};

const TONES: Record<string, string> = {
  meta: "text-info-600",
  webform: "text-purple-600",
  csv: "text-content-muted",
  manual: "text-content-muted",
  test: "text-warning-600",
};

export function SourceIcon({
  provider,
  className,
}: {
  provider: string | null | undefined;
  className?: string;
}) {
  const Icon = provider ? ICONS[provider] : undefined;
  if (!Icon) return null;
  return (
    <Icon
      aria-hidden
      className={cn("size-4", TONES[provider as string], className)}
    />
  );
}
