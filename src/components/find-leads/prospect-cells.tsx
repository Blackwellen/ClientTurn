import * as React from "react";
import { Building2, Mail, ShieldAlert, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { eligibilityLabel, eligibilityTone } from "@/lib/policy/types";
import {
  gradeTone,
  intentFreshness,
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  prospectStatusTone,
  roleLabel,
  verificationLabel,
  verificationTone,
  type ProspectListRow,
} from "@/lib/prospects/types";

/**
 * The shared cell renderers for the Prospects table and card views.
 *
 * Every status vocabulary the prospect surface uses maps to a tone in exactly
 * one place (`lib/prospects/types.ts`), so a grade, a verification result and
 * an eligibility state can never drift into different colours on two screens.
 */

export function ProspectIdentityCell({ row }: { row: ProspectListRow }) {
  const name = prospectDisplayName(row);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="truncate text-[13px] font-semibold text-content">{name}</span>
        {row.promoted_to_lead_id && (
          <Badge tone="success" dense>
            Lead
          </Badge>
        )}
      </div>
      {row.company && (
        <div className="mt-0.5 flex items-center gap-1 text-[12px] text-content-muted">
          <Building2 className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{row.company.name}</span>
        </div>
      )}
      {row.email && (
        <div className="mt-0.5 flex items-center gap-1 text-[12px] text-content-subtle">
          <Mail className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{row.email}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Grade plus the number behind it. Both are shown because the grade is what
 * people act on and the score is what makes the grade arguable — §14.3 requires
 * the score to be explainable, and hiding it invites "the AI decided".
 */
export function ProspectFitCell({ row }: { row: ProspectListRow }) {
  if (!row.grade) {
    return <span className="text-[12px] text-content-subtle">Not scored</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <Badge tone={gradeTone(row.grade)} dense className="font-semibold tabular-nums">
        {row.grade}
      </Badge>
      {row.score !== null && (
        <span className="text-[12px] tabular-nums text-content-muted">
          {Math.round(row.score)}
        </span>
      )}
    </div>
  );
}

export function ProspectIntentCell({ row }: { row: ProspectListRow }) {
  if (!row.intent) {
    return <span className="text-[12px] text-content-subtle">—</span>;
  }

  const extra = row.intent.matchCount - 1;
  return (
    <Tooltip
      content={`${row.intent.categoryName} · observed ${intentFreshness(row.intent.observedAt).toLowerCase()}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <Badge tone="purple" dense>
          <Sparkles className="size-3" aria-hidden />
          <span className="max-w-[9rem] truncate">{row.intent.categoryName}</span>
        </Badge>
        {extra > 0 && (
          <span className="text-[11px] text-content-subtle">+{extra}</span>
        )}
      </span>
    </Tooltip>
  );
}

export function ProspectRoleCell({ row }: { row: ProspectListRow }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[12.5px] text-content-secondary">
        {row.role_title ?? "Unknown role"}
      </p>
      <p className="mt-0.5 text-[11.5px] text-content-subtle">
        {roleLabel(row.role_classification)}
      </p>
    </div>
  );
}

export function ProspectLocationCell({ row }: { row: ProspectListRow }) {
  const label = locationLabel(row.company?.location_json);
  return (
    <span className="text-[12.5px] text-content-secondary">{label ?? "—"}</span>
  );
}

export function ProspectVerificationCell({ row }: { row: ProspectListRow }) {
  return (
    <Badge tone={verificationTone(row.verification_status)} dense>
      {verificationLabel(row.verification_status)}
    </Badge>
  );
}

/**
 * Eligibility is the most consequential cell on the row: it is the difference
 * between "we may contact this person" and "we may not". The reason is always
 * available on hover rather than being reduced to a colour.
 */
export function ProspectEligibilityCell({ row }: { row: ProspectListRow }) {
  const tone = eligibilityTone(row.outreach_eligibility);
  const badge = (
    <Badge tone={tone} dense dot>
      {eligibilityLabel(row.outreach_eligibility)}
    </Badge>
  );

  if (!row.eligibility_reason) return badge;

  return (
    <Tooltip content={row.eligibility_reason}>
      <span className="inline-flex items-center gap-1">
        {badge}
        <ShieldAlert className="size-3 text-content-subtle" aria-hidden />
      </span>
    </Tooltip>
  );
}

export function ProspectStatusCell({ row }: { row: ProspectListRow }) {
  return (
    <Badge tone={prospectStatusTone(row.status)} dense dot>
      {prospectStatusLabel(row.status)}
    </Badge>
  );
}

export function ProspectCampaignCell({ row }: { row: ProspectListRow }) {
  if (!row.campaignName) {
    return <span className="text-[12px] text-content-subtle">Unassigned</span>;
  }
  return (
    <span className="truncate text-[12.5px] text-content-secondary">
      {row.campaignName}
    </span>
  );
}

export function RelativeTime({
  value,
  className,
}: {
  value: string | null;
  className?: string;
}) {
  if (!value) return <span className={cn("text-content-subtle", className)}>—</span>;
  return (
    <time dateTime={value} className={cn("text-[12.5px] text-content-secondary", className)}>
      {intentFreshness(value)}
    </time>
  );
}
