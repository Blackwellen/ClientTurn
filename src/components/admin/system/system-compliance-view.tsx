"use client";

import * as React from "react";
import {
  Ban,
  Check,
  FileText,
  Globe2,
  Inbox,
  Radio,
  ScrollText,
  Search,
  ShieldCheck,
  UserRoundX,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/feedback";
import { IconTile, Panel, PanelEmpty } from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { PolicyDetailDrawer } from "./policy-detail-drawer";
import {
  archivePolicyVersion,
  createPolicyVersion,
  publishPolicyVersion,
  removeSuppression,
  updatePrivacyRequest,
} from "@/lib/admin/compliance-actions";
import { NewPolicyVersionDialog } from "./new-policy-version-dialog";
import { formatDate, formatNumber, formatRelative } from "@/lib/admin/format";
import {
  POLICY_CHANNEL_LABEL,
  POLICY_STANCE_LABEL,
  POLICY_STANCE_TONE,
  POLICY_STATUS_LABEL,
  POLICY_STATUS_TONE,
  PRIVACY_REQUEST_STATUS_LABEL,
  PRIVACY_REQUEST_STATUS_TONE,
  PRIVACY_REQUEST_TYPE_LABEL,
  REVIEW_ITEM_TYPE_LABEL,
  SUPPRESSION_REASON_LABEL,
  type ComplianceViewData,
  type PolicyChannel,
  type PolicyStance,
} from "@/lib/admin/compliance-types";

/** The columns of the country matrix, in the order the reference shows them. */
const MATRIX_CHANNELS: PolicyChannel[] = [
  "EMAIL",
  "COLD_EMAIL",
  "SMS",
  "WHATSAPP",
  "SOCIAL",
];

function StanceCell({ stance }: { stance: PolicyStance | undefined }) {
  if (!stance) {
    return <span className="text-[12px] text-content-subtle">—</span>;
  }
  return (
    <Badge tone={POLICY_STANCE_TONE[stance]} className="px-2">
      {POLICY_STANCE_LABEL[stance]}
    </Badge>
  );
}

const SUMMARY_CARDS = [
  { key: "activePolicies", label: "Active policies", icon: ShieldCheck, tone: "success" },
  { key: "countriesCovered", label: "Countries covered", icon: Globe2, tone: "info" },
  { key: "providersConfigured", label: "Providers configured", icon: Radio, tone: "accent" },
  { key: "itemsInReview", label: "Items in review", icon: Inbox, tone: "warning" },
  { key: "suppressedContacts", label: "Suppressed contacts", icon: UserRoundX, tone: "danger" },
  { key: "privacyNotices", label: "Privacy notices (30d)", icon: FileText, tone: "neutral" },
] as const;

export function SystemComplianceView({
  data,
  filters,
}: {
  data: ComplianceViewData;
  filters: { suppressionQuery: string; suppressionType: string };
}) {
  const { setParams } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();

  const onPublish = React.useCallback(
    (policyId: string) =>
      void run(
        `publish:${policyId}`,
        () => publishPolicyVersion({ policyId }),
        "Policy version published.",
      ),
    [run],
  );

  const onArchive = React.useCallback(
    (policyId: string) =>
      void run(
        `archive:${policyId}`,
        () => archivePolicyVersion({ policyId }),
        "Policy version archived.",
      ),
    [run],
  );

  const onCreateVersion = React.useCallback(
    (input: Parameters<typeof createPolicyVersion>[0]) =>
      void run(
        "policy:create",
        () => createPolicyVersion(input),
        "Draft policy version created.",
      ),
    [run],
  );

  const onRemoveSuppression = React.useCallback(
    (entryId: string, reason: string) =>
      void run(
        `suppression:${entryId}`,
        () => removeSuppression({ entryId, reason }),
        "Suppression lifted.",
      ),
    [run],
  );

  const onPrivacyStatus = React.useCallback(
    (requestId: string, status: "IN_PROGRESS" | "COMPLETED", note?: string) =>
      void run(
        `privacy:${requestId}`,
        () => updatePrivacyRequest({ requestId, status, note }),
        "Request updated.",
      ),
    [run],
  );

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {SUMMARY_CARDS.map((card) => (
          <div
            key={card.key}
            className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs"
          >
            <div className="flex items-center gap-2.5">
              <IconTile icon={card.icon} tone={card.tone} />
              <p className="min-w-0 truncate text-[12px] font-medium text-content-muted">
                {card.label}
              </p>
            </div>
            <p className="lr-tabular mt-2.5 text-[26px] leading-none font-semibold tracking-[-0.025em] text-content">
              {formatNumber(data.summary[card.key])}
            </p>
            {card.key === "itemsInReview" && data.summary.highPriorityReviews > 0 && (
              <p className="mt-1.5 text-[11.5px] font-medium text-danger-600">
                {data.summary.highPriorityReviews} high priority
              </p>
            )}
            {card.key === "privacyNotices" && data.summary.pendingPrivacyRequests > 0 && (
              <p className="mt-1.5 text-[11.5px] font-medium text-warning-700">
                {data.summary.pendingPrivacyRequests} requests pending
              </p>
            )}
          </div>
        ))}
      </div>

      {/* ------------------------------------------- versions · country matrix */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
        <Panel
          icon={ScrollText}
          tone="accent"
          title="Policy versions"
          description="Manage and publish policy packs."
          action={
            <NewPolicyVersionDialog
              existing={data.versions}
              onSubmit={onCreateVersion}
              pending={pending === "policy:create"}
            />
          }
        >
          {data.versions.length === 0 ? (
            <PanelEmpty>
              No policy packs yet. Create one to start recording the rules every
              send is checked against.
            </PanelEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-line bg-surface-sunken/60">
                    {["Version", "Name", "Scope", "Status", "Effective from"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.versions.slice(0, 8).map((version) => (
                    <tr
                      key={version.id}
                      className={cn(
                        "cursor-pointer transition-colors",
                        data.detail?.id === version.id
                          ? "bg-accent-50/60"
                          : "hover:bg-surface-hover",
                      )}
                      onClick={() => setParams({ policy: version.id })}
                    >
                      <td className="lr-tabular px-4 py-2.5 text-[12.5px] font-medium text-content">
                        {version.version}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-content-secondary">
                        {version.name}
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-content-muted">
                        {version.scope}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={POLICY_STATUS_TONE[version.status]} dot>
                          {POLICY_STATUS_LABEL[version.status]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] whitespace-nowrap text-content-muted">
                        {version.effectiveFrom ? formatDate(version.effectiveFrom) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel
          icon={Globe2}
          tone="info"
          title="Country policy matrix"
          description="Policy coverage and key requirements by country."
        >
          {data.countryMatrix.length === 0 ? (
            <PanelEmpty>
              No active policy pack names a country, so every jurisdiction currently
              falls back to the restricted default.
            </PanelEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-line bg-surface-sunken/60">
                    <th
                      scope="col"
                      className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      Country
                    </th>
                    {MATRIX_CHANNELS.map((channel) => (
                      <th
                        key={channel}
                        scope="col"
                        className="px-3 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                      >
                        {POLICY_CHANNEL_LABEL[channel]}
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="px-3 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      Pack
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.countryMatrix.map((row) => (
                    <tr key={row.countryCode} className="hover:bg-surface-hover">
                      <td className="px-4 py-2.5 text-[12.5px] font-medium whitespace-nowrap text-content">
                        {row.countryName}
                      </td>
                      {MATRIX_CHANNELS.map((channel) => (
                        <td key={channel} className="px-3 py-2.5">
                          <StanceCell stance={row.stances[channel]} />
                        </td>
                      ))}
                      <td className="lr-tabular px-3 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                        {row.policyVersion}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------- channel matrix · review queue */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel
          icon={Radio}
          tone="accent"
          title="Channel policy matrix"
          description="Rules and provider requirements by channel."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-y border-line bg-surface-sunken/60">
                  {["Channel", "Status", "Key requirements", "Providers"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.channelMatrix.map((row) => (
                  <tr key={row.channel} className="hover:bg-surface-hover">
                    <td className="px-4 py-2.5 text-[12.5px] font-medium whitespace-nowrap text-content">
                      {POLICY_CHANNEL_LABEL[row.channel]}
                    </td>
                    <td className="px-4 py-2.5">
                      <StanceCell stance={row.stance} />
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                      {row.requirements.slice(0, 3).join(", ") || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                      {row.providerCount === 0
                        ? "None configured"
                        : `${row.providerCount} provider${row.providerCount === 1 ? "" : "s"}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          icon={Inbox}
          tone="warning"
          title="Review queue"
          description="Decisions the policy engine escalated or deferred."
          action={
            data.reviewQueue.length > 0 ? (
              <span className="rounded-full bg-warning-50 px-2.5 py-1 text-[11.5px] font-semibold text-warning-700">
                {data.reviewQueue.length} items
              </span>
            ) : null
          }
        >
          {data.reviewQueue.length === 0 ? (
            <PanelEmpty>Nothing is waiting for a compliance decision.</PanelEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-line bg-surface-sunken/60">
                    {["#", "Type", "Item", "Reason", "Priority", "Created"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.reviewQueue.slice(0, 8).map((item) => (
                    <tr key={item.id} className="hover:bg-surface-hover">
                      <td className="lr-tabular px-4 py-2.5 text-[12px] text-content-muted">
                        {item.reference}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone="neutral" className="px-2">
                          {REVIEW_ITEM_TYPE_LABEL[item.type]}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-[12.5px] text-content">
                        {item.businessName ?? item.item}
                      </td>
                      <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                        {item.reason}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge
                          tone={item.priority === "HIGH" ? "danger" : "warning"}
                          className="px-2"
                        >
                          {item.priority === "HIGH" ? "High" : "Medium"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                        {formatRelative(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      {/* ------------------------------- suppression search · privacy requests */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel
          icon={Search}
          tone="danger"
          title="Suppression search"
          description="Search the global suppression list."
        >
          <div className="space-y-3 px-4 pb-4 sm:px-5">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                defaultValue={filters.suppressionQuery}
                placeholder="Search email, phone or domain…"
                aria-label="Search suppression list"
                className="h-9 min-w-[200px] flex-1 text-[12.5px]"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  setParams({
                    sq: (event.target as HTMLInputElement).value || null,
                  });
                }}
              />
              <Select
                value={filters.suppressionType}
                aria-label="Suppression type"
                className="h-9 w-[130px] text-[12.5px]"
                onChange={(event) =>
                  setParams({
                    stype: event.target.value === "all" ? null : event.target.value,
                  })
                }
              >
                <option value="all">All types</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="domain">Domain</option>
              </Select>
            </div>

            <p className="text-[11.5px] text-content-muted">
              Values are masked. An operator confirms a match here; the address itself
              is never re-displayed.
            </p>

            {data.suppressions.length === 0 ? (
              <EmptyState
                icon={Ban}
                title="No suppression entries match"
                description="Search an address, or clear the term to see the most recent entries."
              />
            ) : (
              <ul className="divide-y divide-line-subtle">
                {data.suppressions.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="lr-tabular truncate text-[12.5px] font-medium text-content">
                        {entry.value}
                      </p>
                      <p className="truncate text-[11.5px] text-content-subtle">
                        {SUPPRESSION_REASON_LABEL[entry.reason]} · {entry.channel} ·{" "}
                        {formatDate(entry.createdAt)}
                        {entry.businessName ? ` · ${entry.businessName}` : ""}
                      </p>
                    </div>
                    {entry.removable ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending === `suppression:${entry.id}`}
                        onClick={() => {
                          const reason = window.prompt(
                            "Why is this suppression being lifted? This is recorded against your account.",
                          );
                          if (reason && reason.trim().length >= 8) {
                            onRemoveSuppression(entry.id, reason.trim());
                          }
                        }}
                      >
                        Lift
                      </Button>
                    ) : (
                      <span
                        title={entry.removalBlockedReason ?? undefined}
                        className="shrink-0 rounded-md bg-surface-sunken px-2 py-1 text-[11px] font-medium text-content-muted"
                      >
                        Permanent
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>

        <Panel
          icon={FileText}
          tone="info"
          title="Privacy request queue"
          description="Data subject requests and privacy actions."
          action={
            data.summary.pendingPrivacyRequests > 0 ? (
              <span className="rounded-full bg-warning-50 px-2.5 py-1 text-[11.5px] font-semibold text-warning-700">
                {data.summary.pendingPrivacyRequests} pending
              </span>
            ) : null
          }
        >
          {data.privacyRequests.length === 0 ? (
            <PanelEmpty>No data subject requests have been received.</PanelEmpty>
          ) : (
            <ul className="divide-y divide-line">
              {data.privacyRequests.slice(0, 8).map((request) => (
                <li
                  key={request.id}
                  className="flex items-center gap-3 px-4 py-2.5 sm:px-5"
                >
                  <span className="lr-tabular w-16 shrink-0 text-[12px] text-content-muted">
                    {request.reference}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] text-content">
                      {PRIVACY_REQUEST_TYPE_LABEL[request.type]} · {request.subject}
                    </span>
                    <span className="block truncate text-[11.5px] text-content-subtle">
                      Received {formatRelative(request.receivedAt)}
                      {request.overdue ? " · overdue" : ""}
                    </span>
                  </span>
                  <Badge tone={PRIVACY_REQUEST_STATUS_TONE[request.status]} dot>
                    {PRIVACY_REQUEST_STATUS_LABEL[request.status]}
                  </Badge>
                  {request.status === "PENDING" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending === `privacy:${request.id}`}
                      onClick={() => onPrivacyStatus(request.id, "IN_PROGRESS")}
                    >
                      Start
                    </Button>
                  )}
                  {request.status === "IN_PROGRESS" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending === `privacy:${request.id}`}
                      onClick={() => {
                        const note = window.prompt(
                          "How was this request resolved? Recorded against your account.",
                        );
                        if (note && note.trim().length > 0) {
                          onPrivacyStatus(request.id, "COMPLETED", note.trim());
                        }
                      }}
                    >
                      <Check className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ---------------------------------------------------------- audit */}
      <Panel
        icon={ScrollText}
        tone="neutral"
        title="Compliance audit"
        description="Policy changes, suppression events and data processing actions."
      >
        {data.auditRows.length === 0 ? (
          <PanelEmpty>No compliance events have been recorded yet.</PanelEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="border-y border-line bg-surface-sunken/60">
                  {["Time", "Event", "Entity", "Actor", "Details"].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="px-4 py-2 text-[11px] font-semibold tracking-wide text-content-muted uppercase"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.auditRows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="px-4 py-2.5 text-[12px] whitespace-nowrap text-content-muted">
                      {formatRelative(row.at)}
                    </td>
                    <td className="px-4 py-2.5 text-[12.5px] text-content">{row.event}</td>
                    <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                      {row.entity}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-content-muted">
                      {row.actor}
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-content-secondary">
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {data.detail && (
        <PolicyDetailDrawer
          key={data.detail.id}
          policy={data.detail}
          pending={pending}
          onClose={() => setParams({ policy: null })}
          onPublish={onPublish}
          onArchive={onArchive}
        />
      )}

      {stepUpDialog}
    </div>
  );
}
