import * as React from "react";
import { z } from "zod";
import { getSystemHealth } from "@/lib/admin/health";
import { getEventDetail, listOperationalEvents } from "@/lib/admin/events";
import { getPlatformError, listPlatformErrors } from "@/lib/admin/errors";
import {
  ADMIN_RANGES,
  ERROR_SEVERITIES,
  ERROR_STATUSES,
  EVENT_STATUS_FILTERS,
  EVENT_TYPE_FILTERS,
} from "@/lib/admin/types";
import {
  SYSTEM_VIEWS,
  SYSTEM_VIEW_DESCRIPTION,
  SystemViewSwitch,
} from "@/components/admin/system/system-view-switch";
import { SystemHealthView } from "@/components/admin/system/system-health-view";
import { SystemEventsView } from "@/components/admin/system/system-events-view";
import { SystemErrorsView } from "@/components/admin/system/system-errors-view";

export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  view: z.enum(SYSTEM_VIEWS).default("health").catch("health"),
  q: z.string().trim().max(80).default("").catch(""),
  type: z.enum(EVENT_TYPE_FILTERS).default("all").catch("all"),
  provider: z.string().trim().max(40).default("all").catch("all"),
  eventStatus: z.enum(EVENT_STATUS_FILTERS).default("all").catch("all"),
  severity: z.enum([...ERROR_SEVERITIES, "all"]).default("all").catch("all"),
  errorStatus: z.enum([...ERROR_STATUSES, "all"]).default("all").catch("all"),
  area: z.string().trim().max(60).default("all").catch("all"),
  range: z.enum(ADMIN_RANGES).default("7d").catch("7d"),
  sort: z
    .enum(["newest", "oldest", "severity", "occurrences"])
    .default("newest")
    .catch("newest"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
  size: z.coerce.number().int().min(10).max(50).default(10).catch(10),
  event: z.string().trim().max(64).optional().catch(undefined),
  error: z.string().trim().max(32).optional().catch(undefined),
});

export default async function AdminSystemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const status = first(raw.status);
  const params = paramsSchema.parse({
    view: first(raw.view),
    q: first(raw.q),
    type: first(raw.type),
    provider: first(raw.provider),
    // Events and Errors share the `status` key in the URL; each view parses it
    // against its own vocabulary and ignores a value that is not its own.
    eventStatus: status,
    errorStatus: status,
    severity: first(raw.severity),
    area: first(raw.area),
    range: first(raw.range),
    sort: first(raw.sort),
    page: first(raw.page),
    size: first(raw.size),
    event: first(raw.event),
    error: first(raw.error),
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-content sm:text-[30px]">
            System
          </h1>
          <p className="mt-1 text-[14px] text-content-muted">
            {SYSTEM_VIEW_DESCRIPTION[params.view]}
          </p>
        </div>
        <SystemViewSwitch view={params.view} />
      </div>

      {params.view === "health" && <HealthView />}
      {params.view === "events" && (
        <EventsView
          search={params.q}
          type={params.type}
          provider={params.provider}
          status={params.eventStatus}
          range={params.range}
          page={params.page}
          pageSize={params.size}
          eventId={params.event}
        />
      )}
      {params.view === "errors" && (
        <ErrorsView
          search={params.q}
          severity={params.severity}
          area={params.area}
          status={params.errorStatus}
          range={params.range}
          sort={params.sort}
          page={params.page}
          pageSize={params.size}
          fingerprint={params.error}
        />
      )}
    </div>
  );
}

async function HealthView() {
  const health = await getSystemHealth();
  return <SystemHealthView health={health} />;
}

async function EventsView(props: {
  search: string;
  type: (typeof EVENT_TYPE_FILTERS)[number];
  provider: string;
  status: (typeof EVENT_STATUS_FILTERS)[number];
  range: (typeof ADMIN_RANGES)[number];
  page: number;
  pageSize: number;
  eventId?: string;
}) {
  const [result, detail] = await Promise.all([
    listOperationalEvents({
      search: props.search,
      type: props.type,
      provider: props.provider,
      status: props.status,
      range: props.range,
      page: props.page,
      pageSize: props.pageSize,
    }),
    props.eventId ? getEventDetail(props.eventId) : Promise.resolve(null),
  ]);

  return (
    <SystemEventsView
      result={result}
      filters={{
        search: props.search,
        type: props.type,
        provider: props.provider,
        status: props.status,
        range: props.range,
      }}
      detail={detail}
    />
  );
}

async function ErrorsView(props: {
  search: string;
  severity: (typeof ERROR_SEVERITIES)[number] | "all";
  area: string;
  status: (typeof ERROR_STATUSES)[number] | "all";
  range: (typeof ADMIN_RANGES)[number];
  sort: "newest" | "oldest" | "severity" | "occurrences";
  page: number;
  pageSize: number;
  fingerprint?: string;
}) {
  const [result, selected] = await Promise.all([
    listPlatformErrors({
      search: props.search,
      severity: props.severity,
      area: props.area,
      status: props.status,
      range: props.range,
      sort: props.sort,
      page: props.page,
      pageSize: props.pageSize,
    }),
    props.fingerprint
      ? getPlatformError(props.fingerprint, props.range)
      : Promise.resolve(null),
  ]);

  return (
    <SystemErrorsView
      result={result}
      filters={{
        search: props.search,
        severity: props.severity,
        area: props.area,
        status: props.status,
        range: props.range,
        sort: props.sort,
      }}
      selected={selected}
    />
  );
}
