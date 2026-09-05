import { NextResponse } from "next/server";
import { getActiveWorkspace } from "@/lib/auth/session";
import { getAttributionRows } from "@/lib/analytics/queries";
import { parseAnalyticsParams, sortAttribution } from "@/lib/analytics/types";
import { resolveRange, toDayString } from "@/lib/dates";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

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

/** Guards against a leading =, +, - or @ being executed by a spreadsheet. */
function csvCell(value: string | number) {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = parseAnalyticsParams(Object.fromEntries(url.searchParams));
  const range = resolveRange(query);

  const rows = sortAttribution(
    await getAttributionRows(workspace.businessId, range),
    query.sort,
    query.dir,
  );

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
