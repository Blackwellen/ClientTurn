import { NextResponse } from "next/server";
import { csvCell } from "@/lib/csv";
import { getSecureWorkspace } from "@/lib/auth/session";
import { getAttributionRows } from "@/lib/analytics/queries";
import { parseAnalyticsParams, sortAttribution } from "@/lib/analytics/types";
import { resolveRange, toDayString } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";
import { checkRateLimit, tooManyRequests } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

const HEADERS = [
  "Source",
  "Campaign",
  "Ad",
  "Leads",
  "Contacted",
  "Replied",
  "Qualified",
  "Booked",
  "Won",
  "Booking rate (%)",
  "Estimated pipeline (GBP)",
];

export async function GET(request: Request) {
  const workspace = await getSecureWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per signed-in user (gap audit 15 §3): an export reads up to its row cap,
  // so a script looping over it is bounded here.
  const limit = await checkRateLimit("app:export", workspace.userId);
  if (!limit.allowed) return tooManyRequests(limit);

  const url = new URL(request.url);
  const query = parseAnalyticsParams(Object.fromEntries(url.searchParams));
  const range = resolveRange(query);

  // Bounded like the prospect export: one row per source/campaign/ad, so a
  // long range over many ads cannot build an unbounded response in memory.
  const rows = sortAttribution(
    await getAttributionRows(workspace.businessId, range),
    query.sort,
    query.dir,
  ).slice(0, MAX_ROWS);

  const lines = [
    HEADERS.map(csvCell).join(","),
    ...rows.map((row) =>
      [
        row.source,
        row.campaign,
        row.ad,
        row.leads,
        row.contacted,
        row.replied,
        row.qualified,
        row.booked,
        row.won,
        row.bookingRate.toFixed(1),
        row.pipeline.toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    ),
  ];

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "export.performed",
    entityType: "analytics_attribution",
    metadata: {
      rows: rows.length,
      range: range.key,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    },
  });

  const filename = `client-turn-attribution-${toDayString(range.from)}-to-${toDayString(
    new Date(range.to.getTime() - 864e5),
  )}.csv`;

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
