import { NextResponse } from "next/server";
import { getActiveWorkspace, hasRole } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import {
  ANALYTICS_VIEWS,
  formatMetric,
  metric as metricDefinition,
  type AnalyticsView,
} from "@/lib/analytics/v4-metrics";
import {
  getV4Analytics,
  rangeBounds,
  type AnalyticsRange,
} from "@/lib/analytics/v4-queries";
import {
  getCampaignPerformance,
  getChannelPerformance,
  getConversionGoals,
  getProviderWaterfall,
  getTrends,
} from "@/lib/analytics/v4-extras";

export const dynamic = "force-dynamic";

/**
 * Analytics export (V4 §21.9).
 *
 * Generated on the server from the same analytics service the page renders, so
 * a download can never disagree with the screen it was taken from. Nothing is
 * recomputed here — this route formats rows, it does not define metrics.
 *
 * Three constraints:
 *
 *   * **Scoped to the caller's workspace**, resolved from the session. The
 *     query string chooses a view and a range; it cannot choose a tenant.
 *   * **Role-gated.** An export leaves the product, so it is not available to
 *     a viewer even though the figures are visible on screen.
 *   * **No provider pricing.** The acquisition sheet reports provider yield;
 *     the wholesale price book is platform-confidential and is not emitted.
 */

const RANGES: AnalyticsRange[] = ["7d", "30d", "90d", "12m"];

/** Guards against a leading =, +, - or @ being executed by a spreadsheet. */
function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "";
  return `${(value * 100).toFixed(digits)}%`;
}

export async function GET(request: Request) {
  const workspace = await getActiveWorkspace();
  if (!workspace) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasRole(workspace.role, "member")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const rawView = url.searchParams.get("view");
  const view: AnalyticsView = ANALYTICS_VIEWS.includes(rawView as AnalyticsView)
    ? (rawView as AnalyticsView)
    : "overview";

  const rawRange = url.searchParams.get("range");
  const range: AnalyticsRange = RANGES.includes(rawRange as AnalyticsRange)
    ? (rawRange as AnalyticsRange)
    : "30d";

  const bounds = rangeBounds(range);
  const businessId = workspace.businessId;

  const data = await getV4Analytics(businessId, view, bounds);
  const active =
    data.overview ?? data.acquisition ?? data.outreach ?? data.conversion ?? null;

  const lines: string[] = [];

  const section = (title: string, headers: string[]) => {
    if (lines.length > 0) lines.push("");
    lines.push(csvCell(title));
    lines.push(headers.map(csvCell).join(","));
  };

  // The window is stated in the file itself: a spreadsheet with no dates on it
  // becomes untraceable the moment it is emailed to someone else.
  lines.push(csvCell("ClientTurn analytics export"));
  lines.push(
    [csvCell("View"), csvCell(view)].join(","),
  );
  lines.push(
    [csvCell("From"), csvCell(bounds.from.toISOString())].join(","),
  );
  lines.push([csvCell("To"), csvCell(bounds.to.toISOString())].join(","));
  lines.push(
    [
      csvCell("Exclusions"),
      csvCell("Test records and internal support traffic are excluded."),
    ].join(","),
  );

  if (active) {
    section("Metrics", ["Metric", "Definition", "Value", "Previous", "Change"]);
    for (const value of active.metrics) {
      const definition = metricDefinition(value.key);
      lines.push(
        [
          definition.label,
          definition.definition,
          formatMetric(value.value, definition.format),
          formatMetric(value.previous ?? null, definition.format),
          percent(value.change),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  if (active && "funnel" in active && active.funnel) {
    section("Funnel", ["Stage", "Count", "Share of first stage", "Share of previous"]);
    for (const stage of active.funnel) {
      lines.push(
        [
          stage.label,
          stage.count,
          percent(stage.shareOfTop),
          percent(stage.shareOfPrevious),
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  if (view === "overview") {
    const [trends, sources, goals, campaigns] = await Promise.all([
      getTrends(businessId, bounds),
      Promise.resolve(data.overview?.sources ?? []),
      getConversionGoals(businessId, bounds),
      getCampaignPerformance(businessId),
    ]);

    if (sources.length > 0) {
      section("Source performance", ["Source", "Leads", "Won", "Win rate"]);
      for (const row of sources) {
        lines.push(
          [
            row.label,
            row.leads,
            row.won,
            row.leads > 0 ? percent(row.won / row.leads) : "",
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }

    if (trends.length > 0) {
      section("Daily trends", [
        "Date",
        "Prospects",
        "Contacts sent",
        "Replies",
        "Leads",
        "Converted",
      ]);
      for (const point of trends) {
        lines.push(
          [
            point.date,
            point.prospects,
            point.contactsSent,
            point.replies,
            point.leads,
            point.converted,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }

    writeGoals(lines, section, goals);
    writeCampaigns(lines, section, campaigns);
  }

  if (view === "outreach") {
    const channels = await getChannelPerformance(businessId, bounds);
    if (channels.length > 0) {
      section("Channel performance", [
        "Channel",
        "Sent",
        "Delivered",
        "Delivery rate",
        "Replies",
        "Reply rate",
        "Opt-outs",
      ]);
      for (const row of channels) {
        lines.push(
          [
            row.channel,
            row.sent,
            row.delivered,
            percent(row.deliveryRate),
            row.replies,
            percent(row.replyRate),
            row.optOuts,
          ]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }

  if (view === "acquisition") {
    const providers = await getProviderWaterfall(businessId, bounds);
    if (providers.length > 0) {
      // Yield only. No unit cost, no credential, no endpoint.
      section("Provider waterfall", ["Provider", "Candidates", "Verified", "Yield"]);
      for (const row of providers) {
        lines.push(
          [row.provider, row.candidates, row.verified, percent(row.yield)]
            .map(csvCell)
            .join(","),
        );
      }
    }
  }

  if (view === "conversion") {
    const [goals, campaigns] = await Promise.all([
      getConversionGoals(businessId, bounds),
      getCampaignPerformance(businessId),
    ]);
    writeGoals(lines, section, goals);
    writeCampaigns(lines, section, campaigns);
  }

  await recordAudit({
    businessId,
    actorUserId: workspace.userId,
    action: "analytics.exported",
    entityType: "analytics",
    metadata: { view, range, rows: lines.length },
  });

  const filename = `clientturn-analytics-${view}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;

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

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

type Section = (title: string, headers: string[]) => void;

function writeGoals(
  lines: string[],
  section: Section,
  goals: { name: string; count: number; share: number | null }[],
) {
  if (goals.length === 0) return;
  section("Conversion goals", ["Goal", "Count", "Share"]);
  for (const row of goals) {
    lines.push([row.name, row.count, percent(row.share)].map(csvCell).join(","));
  }
}

function writeCampaigns(
  lines: string[],
  section: Section,
  campaigns: {
    name: string;
    status: string;
    prospects: number;
    replies: number;
    leads: number;
    conversionRate: number | null;
  }[],
) {
  if (campaigns.length === 0) return;
  section("Campaign performance", [
    "Campaign",
    "Status",
    "Prospects",
    "Replies",
    "Leads",
    "Conversion rate",
  ]);
  for (const row of campaigns) {
    lines.push(
      [
        row.name,
        row.status,
        row.prospects,
        row.replies,
        row.leads,
        percent(row.conversionRate),
      ]
        .map(csvCell)
        .join(","),
    );
  }
}
