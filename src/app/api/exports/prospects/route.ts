import { NextResponse } from "next/server";
import { getActiveWorkspace, hasRole } from "@/lib/auth/session";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { parseProspectFilters } from "@/lib/prospects/filters";
import { listProspects } from "@/lib/prospects/queries";
import { prospectActivityLabel } from "@/lib/prospects/activity";
import {
  locationLabel,
  prospectDisplayName,
  prospectStatusLabel,
  roleLabel,
  verificationLabel,
} from "@/lib/prospects/types";
import { eligibilityLabel } from "@/lib/policy/types";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Prospect export (V4 §12.7).
 *
 * Exports what is on screen: the same parsed filters the table used, so a
 * download always matches the view that produced it rather than silently
 * dumping the whole workspace.
 *
 * Three deliberate constraints:
 *
 *   * **Admin only.** An export removes a record from every control the product
 *     has — suppression, eligibility, retention — so it is not a viewer action.
 *   * **Eligibility travels with the row.** A suppressed prospect that is
 *     exported must carry "Suppressed" beside it, or the spreadsheet becomes a
 *     way to launder an opt-out into someone else's mail merge.
 *   * **The unsubscribe token is never included**, and cannot be: it is not
 *     selected by `listProspects`, and the browser role has no SELECT on it.
 */

const MAX_ROWS = 5000;

const HEADERS = [
  "Name",
  "Company",
  "Role",
  "Decision authority",
  "Email",
  "Phone",
  "Location",
  "Industry",
  "Company size",
  "Grade",
  "Score",
  "Intent category",
  "Intent observed",
  "Email verification",
  "Contactability",
  "Contactability reason",
  "Campaign",
  "Outreach status",
  "Source provider",
  "Sourced",
  "Last activity",
];

/** Guards against a leading =, +, - or @ being executed by a spreadsheet. */
function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function isoDay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasRole(workspace.role, "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const entitlements = await getV4Entitlements(workspace.businessId);
  if (!entitlements.sourcingEnabled) {
    return NextResponse.json({ error: "plan_limit" }, { status: 402 });
  }

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams);

  // Same parser as the page, so the export cannot drift from the table. The
  // page size is overridden because an export is not paginated.
  const filters = {
    ...parseProspectFilters(params),
    page: 1,
    pageSize: MAX_ROWS,
  };

  const { rows, total } = await listProspects(workspace.businessId, filters);

  const lines = [
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        prospectDisplayName(row),
        row.company?.name ?? "",
        row.role_title ?? "",
        roleLabel(row.role_classification),
        row.email ?? "",
        row.phone_e164 ?? "",
        locationLabel(row.company?.location_json) ?? "",
        row.company?.industry ?? "",
        row.company?.company_size ?? "",
        row.grade ?? "",
        row.score === null ? "" : Math.round(row.score),
        row.intent?.categoryName ?? "",
        isoDay(row.intent?.observedAt ?? null),
        verificationLabel(row.verification_status),
        eligibilityLabel(row.outreach_eligibility),
        row.eligibility_reason ?? "",
        row.campaignName ?? "",
        prospectStatusLabel(row.status),
        row.source_provider ?? "",
        isoDay(row.created_at),
        prospectActivityLabel(row.lastActivity, row.created_at),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "prospect.exported",
    entityType: "prospect",
    metadata: {
      rows: rows.length,
      // Recorded when the result set was larger than the cap, so a partial
      // export is visible in the log rather than looking complete.
      matched: total,
      truncated: total > rows.length,
      quick: filters.quick,
      search: filters.search || null,
    },
  });

  const filename = `client-turn-prospects-${new Date().toISOString().slice(0, 10)}.csv`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // BOM so Excel opens the file as UTF-8.
      controller.enqueue(encoder.encode("﻿"));
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\r\n`));
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
