import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements, getV4Usage } from "@/lib/billing/v4-entitlements";
import type {
  FindLeadsKpi,
  RecurringSearchView,
  SearchSessionSummary,
} from "../types";
import { listSessions, type SessionGroup, groupSessions } from "./sessions";
import { listRecentRuns, type RecentRun } from "./runs";
import { readAcquisitionProfile, defaultWebsiteUrl } from "./profile";
import { getAnalysisProgress } from "./analysis";

/**
 * Everything the Discover view needs, gathered in one pass.
 *
 * Assembled server-side and handed to client components as plain data, which
 * is what keeps the service-role client out of the browser bundle while the
 * chat and the rails stay interactive. Nothing here loads a prospect list —
 * Discover is about starting a search, and paging thousands of records to
 * render a landing page is the performance mistake §11.24 calls out.
 */

export type DiscoverData = {
  kpis: FindLeadsKpi[];
  sessionGroups: SessionGroup[];
  sessionCount: number;
  /** Sessions that have a saved plan, and so can be put on a schedule. */
  schedulableSessions: SearchSessionSummary[];
  recentRuns: RecentRun[];
  recurring: RecurringSearchView[];
  profile: Awaited<ReturnType<typeof readAcquisitionProfile>>;
  analysis: Awaited<ReturnType<typeof getAnalysisProgress>>;
  defaultWebsite: string | null;
  usage: {
    searchesUsed: number;
    searchesLimit: number;
    percent: number;
    resetsAt: string | null;
  };
};

export async function loadDiscoverData(businessId: string): Promise<DiscoverData> {
  const entitlements = await getV4Entitlements(businessId);
  const admin = createAdminClient();

  // Nothing below depends on anything else, so the page never waterfalls.
  const [
    sessions,
    recentRuns,
    profile,
    analysis,
    defaultWebsite,
    searchesUsed,
    prospectsFound,
    verifiedContacts,
    inOutreach,
    converted,
    strategyRows,
    recurringRows,
  ] = await Promise.all([
    listSessions(businessId, { limit: 30 }),
    listRecentRuns(businessId, 6),
    readAcquisitionProfile(businessId),
    getAnalysisProgress(businessId),
    defaultWebsiteUrl(businessId),
    getV4Usage(businessId, "search_run", entitlements.periodStart),
    countProspects(businessId),
    countProspects(businessId, { verified: true }),
    countProspects(businessId, { statuses: ["OUTREACH_ACTIVE", "APPROVED"] }),
    countProspects(businessId, { statuses: ["CONVERTED"] }),
    admin
      .from("search_strategies")
      .select("session_id")
      .eq("business_id", businessId)
      .in("status", ["DRAFT", "APPROVED"])
      .limit(200),
    admin
      .from("recurring_searches")
      .select("id, cadence, target_per_run, status, next_run_at, last_run_at, session_id")
      .eq("business_id", businessId)
      .neq("status", "STOPPED")
      .order("next_run_at", { ascending: true })
      .limit(6),
  ]);

  const searchesLimit = entitlements.allowances.search_run.hardLimit;

  const schedulableIds = new Set(
    (strategyRows.data ?? [])
      .map((row) => row.session_id)
      .filter((id): id is string => Boolean(id)),
  );

  // Recurring rows carry a session id rather than a name, so the label comes
  // from the session the schedule re-runs.
  const sessionTitles = new Map(sessions.map((session) => [session.id, session.title]));

  return {
    kpis: [
      {
        key: "searches",
        label: "Searches this month",
        value: searchesUsed.toLocaleString("en-GB"),
        detail: searchesLimit > 0 ? `${searchesUsed} / ${searchesLimit}` : null,
        tone:
          searchesLimit > 0 && searchesUsed >= searchesLimit
            ? "danger"
            : searchesLimit > 0 && searchesUsed >= entitlements.allowances.search_run.softLimit
              ? "warning"
              : "neutral",
      },
      {
        key: "prospects",
        label: "Prospects found",
        value: prospectsFound.toLocaleString("en-GB"),
        detail: null,
        tone: "success",
      },
      {
        key: "verified",
        label: "Verified contacts",
        value: verifiedContacts.toLocaleString("en-GB"),
        detail: null,
        tone: "success",
      },
      {
        key: "outreach",
        label: "In outreach",
        value: inOutreach.toLocaleString("en-GB"),
        detail: null,
        tone: "neutral",
      },
      {
        key: "converted",
        label: "Converted",
        value: converted.toLocaleString("en-GB"),
        detail: null,
        tone: "success",
      },
    ],
    sessionGroups: groupSessions(sessions),
    sessionCount: sessions.length,
    // A schedule re-runs an approved plan, so a session that never produced
    // one cannot be scheduled. Ordering by recency puts the search the
    // customer just ran at the top of the picker.
    schedulableSessions: sessions.filter(
      (session) => schedulableIds.has(session.id) && session.status === "ACTIVE",
    ),
    recentRuns,
    recurring: (recurringRows.data ?? []).map(
      (row): RecurringSearchView => ({
        id: row.id,
        name: sessionTitles.get(row.session_id ?? "") ?? "Recurring search",
        cadence: row.cadence as RecurringSearchView["cadence"],
        targetPerRun: row.target_per_run,
        status: row.status as RecurringSearchView["status"],
        nextRunAt: row.next_run_at,
        lastRunAt: row.last_run_at,
      }),
    ),
    profile,
    analysis,
    defaultWebsite,
    usage: {
      searchesUsed,
      searchesLimit,
      percent:
        searchesLimit > 0
          ? Math.min(100, Math.round((searchesUsed / searchesLimit) * 100))
          : 0,
      resetsAt: entitlements.periodEnd,
    },
  };
}

/** Counts only; Discover never loads prospect rows. */
async function countProspects(
  businessId: string,
  options: { statuses?: string[]; verified?: boolean } = {},
): Promise<number> {
  const admin = createAdminClient();
  let query = admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .eq("is_test", false);

  if (options.statuses) query = query.in("status", options.statuses);
  if (options.verified) query = query.eq("verification_status", "VALID");

  const { count } = await query;
  return count ?? 0;
}
