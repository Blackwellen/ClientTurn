import * as React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { getLeadCapabilities } from "@/lib/leads/queries";
import { loadLeadPageHeader } from "@/lib/leads/detail-queries";
import {
  isLeadId,
  LEAD_PAGE_TABS,
  leadActionAvailability,
  leadPageHref,
  parseLeadPageTab,
} from "@/lib/leads/detail-page";
import { leadDisplayName } from "@/lib/leads/types";
import { TabLink, TabLinkBar } from "@/components/ui/tabs";
import {
  LeadKeyFacts,
  LeadPageHeader,
  LeadScoreBreakdown,
} from "@/components/leads/detail/lead-page-header";
import { LeadPageActions } from "@/components/leads/detail/lead-page-actions";
import {
  ContactabilitySkeleton,
  ContactabilityStrip,
} from "@/components/leads/detail/contactability-strip";
import {
  ActivityTab,
  AiTab,
  AttributionTab,
  ConversationTab,
  DataRightsTab,
  QualificationTab,
  ScoreHistoryTab,
  TabSkeleton,
} from "@/components/leads/detail/lead-page-tabs";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  if (!isLeadId(id)) return { title: "Lead · Client Turn" };
  const workspace = await requireWorkspace();
  const header = await loadLeadPageHeader(workspace.businessId, id).catch(
    () => null,
  );
  return {
    title: header
      ? `${leadDisplayName(header.lead)} · Client Turn`
      : "Lead · Client Turn",
  };
}

/**
 * `/app/leads/[id]` — the full lead record, inside the Leads destination (V3:
 * not a navigation item of its own). The drawer at `/app/leads?lead=` stays
 * for quick views and links here.
 *
 * Tabs are URL state (`?tab=`), so each is linkable and Back moves between
 * them. Only the header and the active tab are loaded; contactability streams
 * in separately because it runs the policy engine once per channel.
 *
 * A lead in another workspace and a lead that never existed are the same 404:
 * the difference would be a way to probe whether an id is real.
 */
export default async function LeadDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, workspace] = await Promise.all([
    params,
    searchParams,
    requireWorkspace(),
  ]);
  if (!isLeadId(id)) notFound();

  const tab = parseLeadPageTab(query.tab);
  const [header, capabilities] = await Promise.all([
    loadLeadPageHeader(workspace.businessId, id),
    getLeadCapabilities(workspace.businessId),
  ]);
  if (!header) notFound();

  const { lead, opportunity } = header;
  const canWrite = hasRole(workspace.role, "member");
  const availability = leadActionAvailability(workspace.role, {
    status: lead.status,
    archived: Boolean(lead.archived_at),
    anonymised: Boolean(lead.anonymised_at),
    optedOut: lead.opted_out,
    humanTakeover: lead.human_takeover,
    opportunityOutcome: opportunity?.outcome ?? null,
  });
  const tabProps = { businessId: workspace.businessId, leadId: lead.id };

  const actions = (
    <LeadPageActions
      leadId={lead.id}
      members={header.members}
      assignedUserId={lead.assigned_user_id}
      opportunity={
        opportunity
          ? {
              id: opportunity.id,
              stage: opportunity.stage,
              outcome: opportunity.outcome,
              stagesAvailable: opportunity.stagesAvailable,
            }
          : null
      }
      availability={availability}
      bookingConfigured={capabilities.booking}
      readOnly={!canWrite}
    />
  );

  // Identity and the four key facts across the top; below, the record (score
  // explanation, then tabs) beside a right rail holding what a person acts
  // on: actions, owner, deal stage, contactability.
  return (
    <div className="space-y-5">
      <nav aria-label="Breadcrumb">
        <Link
          href="/app/leads"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-content-accent underline-offset-4 hover:underline"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to Leads
        </Link>
      </nav>

      <LeadPageHeader header={header} />
      <LeadKeyFacts header={header} />

      {/* Three grid items in reading order: actions, record, contactability.
          At xl the actions and contactability cards stack in a 340px right
          rail beside the record; below it they fall into document order, so
          the action card sits above the record on a phone. Contactability is
          rendered once (it runs the policy engine), placed by grid position. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr] xl:items-start">
        <div className="min-w-0 xl:col-start-2 xl:row-start-1">{actions}</div>

        <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <LeadScoreBreakdown header={header} />

          <div className="min-w-0">
            <TabLinkBar aria-label="Lead record">
              {LEAD_PAGE_TABS.map((item) => (
                <TabLink
                  key={item.value}
                  href={leadPageHref(lead.id, item.value)}
                  active={tab === item.value}
                >
                  {item.label}
                </TabLink>
              ))}
            </TabLinkBar>

            <div className="mt-4">
              <React.Suspense
                key={tab}
                fallback={<TabSkeleton rows={tab === "conversation" ? 4 : 6} />}
              >
                {tab === "conversation" && (
                  <ConversationTab {...tabProps} canWrite={canWrite} />
                )}
                {tab === "qualification" && <QualificationTab {...tabProps} />}
                {tab === "scores" && <ScoreHistoryTab {...tabProps} />}
                {tab === "attribution" && <AttributionTab {...tabProps} />}
                {tab === "activity" && <ActivityTab {...tabProps} />}
                {tab === "ai" && <AiTab {...tabProps} />}
                {tab === "data-rights" && (
                  <DataRightsTab {...tabProps} availability={availability} />
                )}
              </React.Suspense>
            </div>
          </div>
        </div>

        <div className="min-w-0 xl:col-start-2 xl:row-start-2">
          <React.Suspense fallback={<ContactabilitySkeleton />}>
            <ContactabilityStrip workspace={workspace} leadId={lead.id} />
          </React.Suspense>
        </div>
      </div>
    </div>
  );
}
