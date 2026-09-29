import { NextResponse } from "next/server";
import { z } from "zod";
import { csvCell } from "@/lib/csv";
import { getSecureWorkspace, hasRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { leadDisplayName } from "@/lib/leads/types";
import { MAX_BULK_LEADS } from "@/lib/leads/bulk";

export const dynamic = "force-dynamic";

/**
 * Export of the leads selected on the Leads list (bulk "Export").
 *
 * The same three rules as the prospect export (api/exports/prospects):
 * admin only, audited, and the opt-out travels with the row so a spreadsheet
 * cannot launder an opt-out into someone else's mail merge.
 *
 * POST rather than GET: up to 200 ids do not belong in a URL (they would land
 * in access logs and browser history), and a form POST with an attachment
 * response downloads without the page navigating.
 */

const HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Postcode",
  "Status",
  "Qualification",
  "Service",
  "Source",
  "Opted out",
  "Follow-up",
  "Created",
  "Last contacted",
];

const idsSchema = z.array(z.uuid()).min(1).max(MAX_BULK_LEADS);

function isoDay(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const workspace = await getSecureWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per signed-in user (gap audit 15 §3): an export reads up to its row cap,
  // so a script looping over it is bounded here.
  const limit = await checkRateLimit("app:export", workspace.userId);
  if (!limit.allowed) return tooManyRequests(limit);
  if (!hasRole(workspace.role, "admin")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let ids: string[];
  try {
    const form = await request.formData();
    const parsed = idsSchema.safeParse(form.getAll("ids").map(String));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid_selection" }, { status: 400 });
    }
    ids = Array.from(new Set(parsed.data));
  } catch {
    return NextResponse.json({ error: "invalid_selection" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("leads")
    .select(
      "id, first_name, last_name, email, phone, postcode, status, qualification_state, opted_out, automation_active, human_takeover, created_at, last_contact_at, services(name), lead_sources(source_name, provider)",
    )
    .eq("business_id", workspace.businessId)
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "export_failed" }, { status: 500 });
  }

  const lines = [
    HEADERS.map(csvCell).join(","),
    ...(rows ?? []).map((row) => {
      const service = row.services as { name?: string } | null;
      const source = row.lead_sources as { source_name?: string | null; provider?: string } | null;
      return [
        leadDisplayName(row),
        row.email ?? "",
        row.phone ?? "",
        row.postcode ?? "",
        row.status,
        row.qualification_state,
        service?.name ?? "",
        source?.source_name ?? source?.provider ?? "",
        row.opted_out ? "Yes — do not contact" : "No",
        row.human_takeover ? "Taken over" : row.automation_active ? "Active" : "Stopped",
        isoDay(row.created_at),
        isoDay(row.last_contact_at),
      ]
        .map(csvCell)
        .join(",");
    }),
  ];

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "lead.exported",
    entityType: "lead",
    metadata: { rows: rows?.length ?? 0, requested: ids.length, source: "bulk_selection" },
  });

  const filename = `client-turn-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
