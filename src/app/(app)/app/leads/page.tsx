import * as React from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import {
  getFilterOptions,
  getLeadCapabilities,
  getLeadDetail,
  getLeadQuickCounts,
  listLeads,
} from "@/lib/leads/queries";
import { parseLeadFilters, type LeadView } from "@/lib/leads/filters";
import { LeadQuickFilters } from "@/components/leads/lead-quick-filters";
import { LeadsToolbar } from "@/components/leads/leads-toolbar";
import { LeadsContent } from "@/components/leads/leads-content";
import { LeadDrawerHost } from "@/components/leads/lead-drawer-host";

export const metadata: Metadata = { title: "Leads · Client Turn" };
export const dynamic = "force-dynamic";

const VIEW_COOKIE = "clientturn.leads.view";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, cookieStore, workspace] = await Promise.all([
    searchParams,
    cookies(),
    requireWorkspace(),
  ]);

  // The stored view preference is read server-side so a table-view user never
  // sees a flash of card view before their choice loads. An explicit `?view=`
  // in the URL always wins — a shared link should show what the sender saw.
  const stored = cookieStore.get(VIEW_COOKIE)?.value;
  const defaultView: LeadView = stored === "table" ? "table" : "cards";
  const filters = parseLeadFilters(params, defaultView);

  const [{ rows, total }, counts, options, capabilities, detail] = await Promise.all([
    listLeads(workspace.businessId, filters),
    getLeadQuickCounts(workspace.businessId, filters),
    getFilterOptions(workspace.businessId),
    getLeadCapabilities(workspace.businessId),
    filters.lead
      ? getLeadDetail(workspace.businessId, filters.lead)
      : Promise.resolve(null),
  ]);

  const canWrite = hasRole(workspace.role, "member");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.03em] text-content sm:text-[36px]">
          Leads
        </h1>
        <p className="mt-1 text-[15px] text-content-muted sm:text-[16px]">
          Manage and follow up with your incoming leads.
        </p>
      </header>

      <LeadQuickFilters
        value={filters.quick}
        counts={counts}
        view={filters.view}
      />

      <LeadsToolbar filters={filters} options={options} />

      <LeadsContent
        rows={rows}
        total={total}
        filters={filters}
        members={options.members}
      />

      {/* A lead id that no longer resolves (deleted, or another workspace's)
          simply renders no drawer — the list stays usable rather than erroring. */}
      {detail && (
        <LeadDrawerHost
          detail={detail}
          capabilities={capabilities}
          canWrite={canWrite}
          initialTab={first(params.leadTab)}
          focus={first(params.leadFocus)}
        />
      )}
    </div>
  );
}
