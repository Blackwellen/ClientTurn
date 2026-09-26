import * as React from "react";
import type { RetentionPreview } from "@/lib/data-rights/types";

/**
 * Settings -> Data controls -> Retention dry run.
 *
 * Shows what the daily job would do today with the periods set above, from
 * the same query the job runs, so the number here is the number it acts on.
 * Server-rendered: there is nothing to interact with, only a count to read
 * before changing a setting.
 */

function Row({
  label,
  days,
  count,
  unit,
  effect,
}: {
  label: string;
  days: number | null;
  count: number;
  unit: string;
  effect: string;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-2.5 py-2 text-[12.5px]">
      <div className="min-w-0">
        <p className="font-medium text-content">{label}</p>
        <p className="text-content-muted">
          {days === null ? "No period set — kept until removed by hand." : `After ${days} days: ${effect}`}
        </p>
      </div>
      <span className="font-semibold text-content">
        {days === null ? "—" : `${count.toLocaleString("en-GB")} ${unit}${count === 1 ? "" : "s"}`}
      </span>
    </li>
  );
}

export function RetentionPreviewCard({
  preview,
  canManage,
  loadError,
}: {
  preview: RetentionPreview | null;
  canManage: boolean;
  loadError: boolean;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-xs">
      <h3 className="text-[14px] font-semibold text-content">Retention dry run</h3>
      <p className="mt-0.5 text-[12.5px] text-content-muted">
        What the daily retention job would anonymise today with the periods set
        above. Anonymised records keep their dates and source for reporting and
        lose everything that identifies the person. Won leads, leads with an
        upcoming booking, an open privacy request or a restriction are never
        included.
      </p>

      {!canManage ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-[12.5px] text-content-muted">
          Only owners and admins can preview retention.
        </p>
      ) : loadError || !preview ? (
        <p className="mt-3 rounded-lg border border-danger-100 bg-danger-50 px-3 py-4 text-center text-[12.5px] text-danger-700">
          The preview could not be calculated. Refresh the page to try again.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          <Row
            label="Inactive leads"
            days={preview.settings.inactiveLeadsDays}
            count={preview.inactiveLeads}
            unit="lead"
            effect="anonymised"
          />
          <Row
            label="Uncontacted prospects"
            days={preview.settings.uncontactedProspectsDays}
            count={preview.uncontactedProspects}
            unit="prospect"
            effect="anonymised"
          />
          <Row
            label="Raw inbound events"
            days={preview.settings.rawEventsDays}
            count={preview.rawEvents}
            unit="payload"
            effect="payload removed, event record kept"
          />
        </ul>
      )}
    </section>
  );
}
