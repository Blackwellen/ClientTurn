"use client";

import * as React from "react";
import { Building2, Globe, Mail, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { eligibilityLabel, eligibilityTone } from "@/lib/policy/types";
import {
  gradeTone,
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  prospectStatusTone,
  roleLabel,
  verificationLabel,
  verificationTone,
  type ProspectListRow,
} from "@/lib/prospects/types";
import { ProspectIntentCell, RelativeTime } from "./prospect-cells";

/**
 * Card view for the Prospects inbox.
 *
 * Leads cards lead with the person and their enquiry; a prospect card leads
 * with fit and eligibility, because the decision being made here is "is this
 * worth contacting, and may we?" rather than "how do I reply?".
 */
export function ProspectCard({
  row,
  onOpen,
}: {
  row: ProspectListRow;
  onOpen: () => void;
}) {
  const name = prospectDisplayName(row);
  const location = locationLabel(row.company?.location_json);

  return (
    <article
      className="group flex flex-col rounded-xl border border-line bg-surface p-4 text-left shadow-xs transition-shadow duration-150 hover:shadow-sm focus-within:ring-2 focus-within:ring-accent-500/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpen}
            className="text-left focus-visible:outline-none"
          >
            <h3 className="truncate text-[14px] font-semibold text-content group-hover:text-content-accent">
              {name}
            </h3>
          </button>
          <p className="mt-0.5 truncate text-[12.5px] text-content-muted">
            {row.role_title ?? roleLabel(row.role_classification)}
          </p>
        </div>

        {row.grade && (
          <Badge tone={gradeTone(row.grade)} className="shrink-0 font-semibold tabular-nums">
            {row.grade}
            {row.score !== null && (
              <span className="ml-1 font-normal opacity-70">{Math.round(row.score)}</span>
            )}
          </Badge>
        )}
      </div>

      {row.company && (
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-1.5 text-[12.5px] text-content-secondary">
            <Building2 className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
            <span className="truncate">{row.company.name}</span>
          </div>
          {row.company.domain && (
            <div className="flex items-center gap-1.5 text-[12px] text-content-muted">
              <Globe className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
              <span className="truncate">{row.company.domain}</span>
            </div>
          )}
          {location && (
            <div className="flex items-center gap-1.5 text-[12px] text-content-muted">
              <MapPin className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
              <span className="truncate">{location}</span>
            </div>
          )}
        </div>
      )}

      {row.email && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-content-muted">
          <Mail className="size-3.5 shrink-0 text-content-subtle" aria-hidden />
          <span className="truncate">{row.email}</span>
          <Badge tone={verificationTone(row.verification_status)} dense className="ml-auto shrink-0">
            {verificationLabel(row.verification_status)}
          </Badge>
        </div>
      )}

      {row.intent && (
        <div className="mt-3">
          <ProspectIntentCell row={row} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge tone={prospectStatusTone(row.status)} dense dot>
          {prospectStatusLabel(row.status)}
        </Badge>
        <Badge tone={eligibilityTone(row.outreach_eligibility)} dense dot>
          {eligibilityLabel(row.outreach_eligibility)}
        </Badge>
      </div>

      {row.eligibility_reason && row.outreach_eligibility !== "ELIGIBLE" && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-content-muted">
          {row.eligibility_reason}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-line-subtle pt-3 text-[11.5px] text-content-subtle">
        <span className="truncate">{row.campaignName ?? "No campaign"}</span>
        <RelativeTime value={row.last_activity_at ?? row.created_at} className="text-[11.5px]" />
      </div>
    </article>
  );
}
