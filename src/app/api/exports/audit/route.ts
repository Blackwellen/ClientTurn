import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSecureWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { serverEnv } from "@/lib/env";
import { checkRateLimit, tooManyRequests } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import {
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_EXPORT_PAGE_SIZE,
  auditCsvHeader,
  auditCsvLine,
  auditExportFilename,
  auditExportSchema,
  auditJsonRecord,
  exportBounds,
  mayExportAudit,
  nextPageFilter,
  type AuditRow,
} from "@/lib/audit-export";

export const dynamic = "force-dynamic";
// Streaming keeps memory flat; this bounds wall-clock for a very large range.
export const maxDuration = 60;

/**
 * Settings -> Data Controls -> Export audit log.
 *
 *   * Owners and admins only, checked here against the live membership row.
 *   * Same-origin POST (a cookie-authenticated route handler gets no CSRF
 *     protection from Next.js), form-encoded so the browser downloads the
 *     attachment without leaving the page.
 *   * Rate limited per user (`app:audit_export`, 5 an hour).
 *   * Recorded in the audit log itself before the first byte is sent.
 *   * Streamed: rows are read 1,000 at a time, keyset-paged on
 *     (created_at, id), and written straight to the response, so a year of
 *     history neither sits in memory nor rides on one long query.
 *
 * Reads use the service role hard-scoped to the caller's business_id; the
 * browser role cannot read `metadata` (0079 column grant), which is why this
 * is a server route rather than a client query.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request.headers, [new URL(request.url).origin, serverEnv.siteUrl])) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const workspace = await getSecureWorkspace();
  if (!workspace) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!mayExportAudit(workspace.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const parsed = auditExportSchema.safeParse({
    from: form.get("from"),
    to: form.get("to"),
    format: form.get("format") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_range", message: parsed.error.issues[0]?.message ?? "Check the dates." },
      { status: 400 },
    );
  }
  const query = parsed.data;

  const limit = await checkRateLimit("app:audit_export", workspace.userId);
  if (!limit.allowed) return tooManyRequests(limit);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "audit_log.exported",
    entityType: "audit_log",
    metadata: { from: query.from, to: query.to, format: query.format },
  });

  const { start, end } = exportBounds(query);
  const db = createAdminClient() as unknown as SupabaseClient;
  const businessId = workspace.businessId;
  const encoder = new TextEncoder();
  const emails = new Map<string, string | null>();

  async function resolveEmails(rows: AuditRow[]) {
    const missing = [
      ...new Set(rows.map((r) => r.actor_user_id).filter((id): id is string => Boolean(id))),
    ].filter((id) => !emails.has(id));
    if (missing.length === 0) return;
    const { data } = await db.from("profiles").select("id, email").in("id", missing);
    for (const id of missing) emails.set(id, null);
    for (const profile of (data ?? []) as { id: string; email: string | null }[]) {
      emails.set(profile.id, profile.email);
    }
  }

  let last: AuditRow | null = null;
  let written = 0;
  let first = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (query.format === "csv") controller.enqueue(encoder.encode(`﻿${auditCsvHeader()}`));
      else controller.enqueue(encoder.encode("["));
    },
    async pull(controller) {
      try {
        let builder = db
          .from("audit_log")
          .select("id, created_at, actor_user_id, actor_type, action, entity_type, entity_id, metadata")
          .eq("business_id", businessId)
          .gte("created_at", start)
          .lt("created_at", end);
        const after = nextPageFilter(last);
        if (after) builder = builder.or(after);
        const { data, error } = await builder
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(AUDIT_EXPORT_PAGE_SIZE);

        if (error) throw new Error("audit_read_failed");
        const rows = (data ?? []) as AuditRow[];
        await resolveEmails(rows);

        let chunk = "";
        for (const row of rows) {
          if (written >= AUDIT_EXPORT_MAX_ROWS) break;
          const email = row.actor_user_id ? (emails.get(row.actor_user_id) ?? null) : null;
          if (query.format === "csv") {
            chunk += auditCsvLine(row, email);
          } else {
            chunk += (first ? "\n" : ",\n") + JSON.stringify(auditJsonRecord(row, email));
            first = false;
          }
          written += 1;
        }
        if (chunk) controller.enqueue(encoder.encode(chunk));
        last = rows[rows.length - 1] ?? last;

        if (rows.length < AUDIT_EXPORT_PAGE_SIZE || written >= AUDIT_EXPORT_MAX_ROWS) {
          if (query.format === "json") controller.enqueue(encoder.encode("\n]\n"));
          controller.close();
        }
      } catch {
        // Headers are already sent; erroring the stream makes the download
        // fail visibly rather than end as a silently truncated file.
        controller.error(new Error("The audit log export could not be completed."));
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": query.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${auditExportFilename(query)}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
