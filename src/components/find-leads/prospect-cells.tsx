"use client";

import * as React from "react";
import { ChevronRight, ShieldAlert } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { eligibilityLabel, eligibilityTone } from "@/lib/policy/types";
import { prospectActivityLabel, shortAgo } from "@/lib/prospects/activity";
import {
  gradeTone,
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  prospectStatusTone,
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
 *
 * Nothing here is colour-only: each badge carries its own word, so the row is
 * still readable without colour perception.
 */

export function ProspectIdentityCell({ row }: { row: ProspectListRow }) {
  const name = prospectDisplayName(row);
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={name} size="md" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-semibold text-content">{name}</span>
          {row.promoted_to_lead_id && (
            <Badge tone="success" dense>
              Lead
            </Badge>
          )}
        </div>
        <p className="truncate text-[12px] text-content-muted">
          {row.company?.name ?? "No company recorded"}
        </p>
      </div>
    </div>
  );
}

/**
 * Grade plus the number behind it, and a click through to the full breakdown.
 *
 * Both are shown because the grade is what people act on and the score is what
 * makes the grade arguable — §14.3 requires the score to be explainable, and a
 * grade with no way to open the reasoning is exactly the "the AI decided" the
 * section forbids.
 */
export function ProspectFitCell({
  row,
  onOpenScore,
}: {
  row: ProspectListRow;
  onOpenScore?: (id: string) => void;
}) {
  if (!row.grade) {
    return <span className="text-[12px] text-content-subtle">Not scored</span>;
  }

  const descriptor = fitDescriptor(row);

  const body = (
    <>
      <span className="flex items-center gap-2">
        <Badge tone={gradeTone(row.grade)} dense className="font-semibold tabular-nums">
          {row.grade}
        </Badge>
        {row.score !== null && (
          <span className="text-[13px] font-semibold tabular-nums text-content">
            {Math.round(row.score)}
          </span>
        )}
      </span>
      {descriptor && (
        <span className="mt-0.5 block truncate text-[11px] text-content-muted">
          {descriptor}
        </span>
      )}
    </>
  );

  if (!onOpenScore) return <span className="block min-w-0">{body}</span>;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpenScore(row.id);
      }}
      title="See how this score was calculated"
      className="block min-w-0 rounded-sm text-left transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-content-accent"
    >
      {body}
    </button>
  );
}

/**
 * A short, factual descriptor under the grade — the company's own recorded
 * attributes, never a generated characterisation. Null when nothing has been
 * recorded, because an invented label here would look like evidence.
 */
function fitDescriptor(row: ProspectListRow): string | null {
  const company = row.company;
  if (!company) return null;
  const parts = [company.industry, company.company_size].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  return parts.length ? parts.join(" · ") : null;
}

export function ProspectIntentCell({ row }: { row: ProspectListRow }) {
  if (!row.intent) {
    return <span className="text-[12px] text-content-subtle">No current intent</span>;
  }

  const extra = row.intent.matchCount - 1;
  return (
    <Tooltip
      content={`${row.intent.categoryName} — ${row.intent.matchCount} live signal${
        row.intent.matchCount === 1 ? "" : "s"
      }`}
    >
      <span className="block min-w-0">
        <span className="flex items-center gap-1.5">
          <Badge tone="purple" dense>
            <span className="max-w-[8.5rem] truncate">{row.intent.categoryName}</span>
          </Badge>
          {extra > 0 && <span className="text-[11px] text-content-subtle">+{extra}</span>}
        </span>
        <span className="mt-0.5 block text-[11px] text-content-muted">
          {shortAgo(row.intent.observedAt)}
        </span>
      </span>
    </Tooltip>
  );
}

export function ProspectRoleCell({ row }: { row: ProspectListRow }) {
  return (
    <span className="block truncate text-[12.5px] text-content-secondary">
      {row.role_title ?? "Unknown role"}
    </span>
  );
}

/**
 * City and postal district only.
 *
 * Never the full street address: §12.6 keeps personal location data out of a
 * list view, and the district is enough to answer "is this in my patch".
 */
export function ProspectLocationCell({ row }: { row: ProspectListRow }) {
  const location = row.company?.location_json ?? null;
  const city =
    location && typeof location.city === "string" && location.city.trim()
      ? location.city
      : null;
  const district = postalDistrict(location);

  if (!city && !district) {
    const fallback = locationLabel(location);
    return (
      <span className="text-[12.5px] text-content-secondary">{fallback ?? "—"}</span>
    );
  }

  return (
    <span className="block min-w-0">
      <span className="block truncate text-[12.5px] text-content-secondary">
        {city ?? "—"}
      </span>
      {district && (
        <span className="block text-[11px] text-content-muted">{district}</span>
      )}
    </span>
  );
}

/** "BH1" from "BH1 2AB". The outward code is the area; the rest identifies a
 *  building, which a list has no need for. */
function postalDistrict(location: Record<string, unknown> | null): string | null {
  const raw =
    location && typeof location.postcode === "string" ? location.postcode.trim() : "";
  if (!raw) return null;
  const outward = raw.split(/\s+/)[0];
  return outward ? outward.toUpperCase() : null;
}

export function ProspectVerificationCell({ row }: { row: ProspectListRow }) {
  return (
    <Badge tone={verificationTone(row.verification_status)} dense dot>
      {verificationLabel(row.verification_status)}
    </Badge>
  );
}

/**
 * Eligibility is the most consequential cell on the row: it is the difference
 * between "we may contact this person" and "we may not". It is deliberately
 * independent of the score — an A+ prospect can still be suppressed — and the
 * reason is always available rather than reduced to a colour.
 */
export function ProspectEligibilityCell({ row }: { row: ProspectListRow }) {
  const badge = (
    <Badge tone={eligibilityTone(row.outreach_eligibility)} dense>
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
    <Badge tone={prospectStatusTone(row.status)} dense>
      {prospectStatusLabel(row.status)}
    </Badge>
  );
}

export function ProspectCampaignCell({ row }: { row: ProspectListRow }) {
  if (!row.campaignName) {
    return <span className="text-[12px] text-content-subtle">—</span>;
  }
  return (
    <span className="block truncate text-[12.5px] text-content-secondary">
      {row.campaignName}
    </span>
  );
}

/** "Email sent yesterday" rather than a bare date — see `lib/prospects/activity`. */
export function ProspectActivityCell({ row }: { row: ProspectListRow }) {
  const label = prospectActivityLabel(row.lastActivity, row.created_at);
  const at = row.lastActivity?.at ?? row.created_at;

  return (
    <time dateTime={at} className="text-[12.5px] text-content-secondary">
      {label}
    </time>
  );
}

export function ProspectOpenCell() {
  return (
    <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-content-accent">
      Open
      <ChevronRight className="size-3.5" aria-hidden />
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
      {shortAgo(value)}
    </time>
  );
}
