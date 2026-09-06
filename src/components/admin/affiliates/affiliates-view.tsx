"use client";

import * as React from "react";
import {
  BadgeCheck,
  Coins,
  FolderOpen,
  Handshake,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelEmpty } from "@/components/admin/ui";
import { useAdminParams } from "@/components/admin/use-admin-params";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { cn } from "@/lib/cn";
import { formatMoney, formatNumber, formatRelative, titleise } from "@/lib/admin/format";
import {
  AFFILIATE_TABS,
  TAB_LABELS,
  applicationGaps,
  type AdminAffiliateRow,
  type AdminAffiliatesData,
} from "@/lib/admin/affiliates-types";
import {
  approveAffiliate,
  approveCommission,
  markPayoutPaid,
  reinstateAffiliate,
  rejectAffiliate,
  reverseCommission,
  suspendAffiliate,
} from "@/lib/admin/affiliate-actions";

/**
 * Admin -> Affiliates (V4 section 41).
 *
 * Applications first, then the money. The two questions this page answers are
 * "who is waiting on me" and "what do we owe", so those are the two things
 * above the fold on the Overview tab.
 *
 * Amounts here are commission owed to partners — a real liability, not the raw
 * provider cost that section 90 keeps admin-only. Both live behind the admin
 * shell for the same reason: neither belongs on a customer surface.
 */
export function AffiliatesView({ data }: { data: AdminAffiliatesData }) {
  const { setParams, pending: navPending } = useAdminParams();
  const { run, pending, stepUpDialog } = useAdminAction();

  const applications = data.affiliates.filter((row) => row.status === "APPLIED");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Active partners"
          value={formatNumber(data.totals.activeAffiliates)}
          icon={Users}
        />
        <Kpi
          label="Waiting for review"
          value={formatNumber(data.totals.pendingApplications)}
          icon={Handshake}
          tone={data.totals.pendingApplications > 0 ? "warning" : undefined}
        />
        <Kpi
          label="Owed to partners"
          value={formatMoney(data.totals.payableMinor / 100)}
          icon={Wallet}
          hint={`${formatMoney(data.totals.pendingMinor / 100)} still on hold`}
        />
        <Kpi
          label="Paid to date"
          value={formatMoney(data.totals.paidMinor / 100)}
          icon={Coins}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {AFFILIATE_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setParams({ tab })}
            aria-current={data.tab === tab ? "page" : undefined}
            className={cn(
              "rounded-md border px-3 py-1.5 text-[13px] font-medium transition-colors",
              data.tab === tab
                ? "border-line-strong bg-surface text-content shadow-xs"
                : "border-transparent text-content-secondary hover:bg-surface-hover hover:text-content",
            )}
          >
            {TAB_LABELS[tab]}
            {tab === "affiliates" && applications.length > 0 && (
              <span className="ml-2 rounded-full bg-warning-50 px-1.5 py-0.5 text-[11px] text-warning-700">
                {applications.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={cn(navPending && "opacity-60 transition-opacity")}>
        {data.tab === "overview" && (
          <ApplicationQueue
            applications={applications}
            pending={pending}
            onApprove={(id) =>
              run(`approve:${id}`, () => approveAffiliate({ affiliateId: id }), "Approved.")
            }
            onReject={(id, reason) =>
              run(
                `reject:${id}`,
                () => rejectAffiliate({ affiliateId: id, reason }),
                "Declined.",
              )
            }
          />
        )}

        {data.tab === "affiliates" && (
          <Panel icon={Users} title="Partners" description="Every affiliate account.">
            {data.affiliates.length === 0 ? (
              <PanelEmpty>No affiliate accounts yet.</PanelEmpty>
            ) : (
              <Grid
                headers={[
                  "Partner",
                  "Status",
                  "Plan",
                  "Clicks",
                  "Referrals",
                  "Paying",
                  "Owed",
                  "",
                ]}
              >
                {data.affiliates.map((row) => (
                  <tr key={row.id}>
                    <Td>
                      <span className="font-medium">{row.displayName}</span>
                      <span className="block text-[11.5px] text-content-subtle">
                        {row.code} · {row.contactEmail}
                      </span>
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} dense>
                        {titleise(row.status)}
                      </Badge>
                    </Td>
                    <Td>{row.planName ?? "—"}</Td>
                    <Td numeric>{formatNumber(row.clicks)}</Td>
                    <Td numeric>{formatNumber(row.referrals)}</Td>
                    <Td numeric>{formatNumber(row.paying)}</Td>
                    <Td numeric>{formatMoney(row.payableMinor / 100)}</Td>
                    <Td className="text-right">
                      <StatusActions
                        row={row}
                        pending={pending}
                        onApprove={() =>
                          run(
                            `approve:${row.id}`,
                            () => approveAffiliate({ affiliateId: row.id }),
                            "Approved.",
                          )
                        }
                        onSuspend={(reason) =>
                          run(
                            `suspend:${row.id}`,
                            () => suspendAffiliate({ affiliateId: row.id, reason }),
                            "Suspended.",
                          )
                        }
                        onReinstate={() =>
                          run(
                            `reinstate:${row.id}`,
                            () => reinstateAffiliate({ affiliateId: row.id }),
                            "Reinstated.",
                          )
                        }
                      />
                    </Td>
                  </tr>
                ))}
              </Grid>
            )}
          </Panel>
        )}

        {data.tab === "referrals" && (
          <Panel
            icon={Handshake}
            title="Referrals"
            description="Businesses credited to a partner."
          >
            {data.referrals.length === 0 ? (
              <PanelEmpty>No referrals recorded yet.</PanelEmpty>
            ) : (
              <Grid
                headers={["Partner", "Business", "Status", "Plan", "Signed up", "Revenue"]}
              >
                {data.referrals.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.affiliateName}</Td>
                    <Td>{row.businessName ?? "Deleted workspace"}</Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} dense>
                        {titleise(row.status)}
                      </Badge>
                    </Td>
                    <Td>{row.planKey ?? "—"}</Td>
                    <Td>{formatRelative(row.signupAt)}</Td>
                    <Td numeric>{formatMoney(row.lifetimeRevenueMinor / 100)}</Td>
                  </tr>
                ))}
              </Grid>
            )}
          </Panel>
        )}

        {data.tab === "commissions" && (
          <Panel
            icon={Coins}
            title="Commissions"
            description="Pending first — those are the ones you can still act on."
          >
            {data.commissions.length === 0 ? (
              <PanelEmpty>No commission has accrued yet.</PanelEmpty>
            ) : (
              <Grid
                headers={[
                  "Partner",
                  "Business",
                  "Period",
                  "Customer paid",
                  "Commission",
                  "Status",
                  "",
                ]}
              >
                {data.commissions.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.affiliateName}</Td>
                    <Td>{row.businessName ?? "—"}</Td>
                    <Td>
                      {row.periodMonth
                        ? new Date(row.periodMonth).toLocaleDateString("en-GB", {
                            month: "short",
                            year: "numeric",
                          })
                        : formatRelative(row.createdAt)}
                    </Td>
                    <Td numeric>{formatMoney(row.baseAmountMinor / 100)}</Td>
                    <Td numeric className="font-medium">
                      {formatMoney(row.commissionAmountMinor / 100)}
                    </Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} dense>
                        {titleise(row.status)}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      {row.status === "PENDING" && (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="xs"
                            variant="secondary"
                            loading={pending === `commission:${row.id}`}
                            onClick={() =>
                              run(
                                `commission:${row.id}`,
                                () => approveCommission({ commissionId: row.id }),
                                "Approved.",
                              )
                            }
                          >
                            Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            loading={pending === `reverse:${row.id}`}
                            onClick={() => {
                              const reason = window.prompt(
                                "Why is this commission being reversed? The partner will see this.",
                              );
                              if (!reason) return;
                              run(
                                `reverse:${row.id}`,
                                () =>
                                  reverseCommission({
                                    commissionId: row.id,
                                    reason,
                                  }),
                                "Reversed.",
                              );
                            }}
                          >
                            Reverse
                          </Button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </Grid>
            )}
          </Panel>
        )}

        {data.tab === "payouts" && (
          <Panel
            icon={Wallet}
            title="Payouts"
            description="Marking a payout paid records a transfer someone has already made. It does not send money."
          >
            {data.payouts.length === 0 ? (
              <PanelEmpty>No payouts have been raised yet.</PanelEmpty>
            ) : (
              <Grid
                headers={[
                  "Partner",
                  "Reference",
                  "Amount",
                  "Commissions",
                  "Status",
                  "Paid",
                  "",
                ]}
              >
                {data.payouts.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.affiliateName}</Td>
                    <Td>{row.batchReference ?? row.id.slice(0, 8)}</Td>
                    <Td numeric className="font-medium">
                      {formatMoney(row.amountMinor / 100)}
                    </Td>
                    <Td numeric>{row.commissionCount}</Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} dense>
                        {titleise(row.status)}
                      </Badge>
                    </Td>
                    <Td>{row.paidAt ? formatRelative(row.paidAt) : "—"}</Td>
                    <Td className="text-right">
                      {(row.status === "APPROVED" || row.status === "PROCESSING") && (
                        <Button
                          size="xs"
                          variant="secondary"
                          loading={pending === `payout:${row.id}`}
                          onClick={() => {
                            const reference = window.prompt(
                              "Enter the payment reference from your bank.",
                            );
                            if (!reference) return;
                            run(
                              `payout:${row.id}`,
                              () =>
                                markPayoutPaid({
                                  payoutId: row.id,
                                  externalReference: reference,
                                }),
                              "Marked as paid.",
                            );
                          }}
                        >
                          Mark paid
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </Grid>
            )}
          </Panel>
        )}

        {data.tab === "resources" && (
          <Panel
            icon={FolderOpen}
            title="Resources"
            description="What partners can download. Published rows are visible to every active partner."
          >
            {data.resources.length === 0 ? (
              <PanelEmpty>
                Nothing published yet. Partners see an empty resource hub until
                an asset is published.
              </PanelEmpty>
            ) : (
              <Grid
                headers={["Title", "Category", "Version", "Status", "Downloads", "Updated"]}
              >
                {data.resources.map((row) => (
                  <tr key={row.id}>
                    <Td>{row.title}</Td>
                    <Td>{titleise(row.category)}</Td>
                    <Td>{row.version}</Td>
                    <Td>
                      <Badge tone={statusTone(row.status)} dense>
                        {titleise(row.status)}
                      </Badge>
                    </Td>
                    <Td numeric>{formatNumber(row.downloadCount)}</Td>
                    <Td>{formatRelative(row.updatedAt)}</Td>
                  </tr>
                ))}
              </Grid>
            )}
          </Panel>
        )}
      </div>

      {stepUpDialog}
    </div>
  );
}

/* ----------------------------------------------------------------- pieces */

function ApplicationQueue({
  applications,
  pending,
  onApprove,
  onReject,
}: {
  applications: AdminAffiliateRow[];
  pending: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  return (
    <Panel
      icon={BadgeCheck}
      tone={applications.length > 0 ? "warning" : undefined}
      title="Applications"
      description="Partners waiting on a decision."
    >
      {applications.length === 0 ? (
        <PanelEmpty>No applications are waiting. The queue is clear.</PanelEmpty>
      ) : (
        <ul className="divide-y divide-line-subtle">
          {applications.map((row) => {
            const gaps = applicationGaps(row);
            return (
              <li key={row.id} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-content">
                      {row.displayName}
                      {row.companyName && (
                        <span className="ml-2 font-normal text-content-muted">
                          {row.companyName}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[12px] text-content-muted">
                      {row.contactEmail}
                      {row.country && ` · ${row.country}`}
                      {` · applied ${formatRelative(row.createdAt)}`}
                    </p>
                    {row.websiteUrl && (
                      <a
                        href={row.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="mt-0.5 inline-block text-[12px] text-content-accent underline-offset-4 hover:underline"
                      >
                        {row.websiteUrl}
                      </a>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="xs"
                      loading={pending === `approve:${row.id}`}
                      onClick={() => onApprove(row.id)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      loading={pending === `reject:${row.id}`}
                      onClick={() => {
                        const reason = window.prompt(
                          "Why is this application being declined? The applicant will see this.",
                        );
                        if (!reason) return;
                        onReject(row.id, reason);
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                </div>

                {row.promotionMethods.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.promotionMethods.map((method) => (
                      <Badge key={method} tone="neutral" dense>
                        {method}
                      </Badge>
                    ))}
                  </div>
                )}

                {row.audienceDescription && (
                  <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-content-secondary">
                    {row.audienceDescription}
                  </p>
                )}

                {gaps.length > 0 && (
                  // Not a blocker — an operator may approve anyone. It saves
                  // opening each application to find out what is missing.
                  <p className="mt-2 text-[11.5px] text-warning-700">
                    {gaps.join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function StatusActions({
  row,
  pending,
  onApprove,
  onSuspend,
  onReinstate,
}: {
  row: AdminAffiliateRow;
  pending: string | null;
  onApprove: () => void;
  onSuspend: (reason: string) => void;
  onReinstate: () => void;
}) {
  if (row.status === "APPLIED") {
    return (
      <Button size="xs" loading={pending === `approve:${row.id}`} onClick={onApprove}>
        Approve
      </Button>
    );
  }

  if (row.status === "ACTIVE") {
    return (
      <Button
        size="xs"
        variant="ghost"
        loading={pending === `suspend:${row.id}`}
        onClick={() => {
          const reason = window.prompt(
            "Why is this partner being suspended? They will see this.",
          );
          if (!reason) return;
          onSuspend(reason);
        }}
      >
        Suspend
      </Button>
    );
  }

  if (row.status === "SUSPENDED") {
    return (
      <Button
        size="xs"
        variant="secondary"
        loading={pending === `reinstate:${row.id}`}
        onClick={onReinstate}
      >
        Reinstate
      </Button>
    );
  }

  return null;
}

function Kpi({
  label,
  value,
  icon: Icon,
  hint,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  tone?: "warning" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
      <div className="flex items-center gap-2 text-content-muted">
        <Icon className="size-3.5" aria-hidden />
        <span className="text-[12px]">{label}</span>
      </div>
      <p
        className={cn(
          "mt-1 text-[22px] font-semibold tabular-nums",
          tone === "warning" && "text-warning-700",
          tone === "danger" && "text-danger-600",
          !tone && "text-content",
        )}
      >
        {value}
      </p>
      {hint && <p className="text-[11.5px] text-content-subtle">{hint}</p>}
    </div>
  );
}

function Grid({
  headers,
  children,
}: {
  headers: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[820px] border-collapse text-left">
        <thead>
          <tr className="border-y border-line-subtle bg-surface-sunken/60">
            {headers.map((header, index) => (
              <th
                key={`${header}-${index}`}
                scope="col"
                className="px-4 py-2 text-[11.5px] font-medium uppercase tracking-wide text-content-subtle sm:px-5"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  className,
  numeric,
}: {
  children?: React.ReactNode;
  className?: string;
  numeric?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 text-[13px] text-content sm:px-5",
        numeric && "tabular-nums",
        className,
      )}
    >
      {children}
    </td>
  );
}

function statusTone(
  status: string,
): "neutral" | "accent" | "success" | "warning" | "danger" | "info" {
  switch (status) {
    case "ACTIVE":
    case "PAID":
    case "PUBLISHED":
      return "success";
    case "APPLIED":
    case "PENDING":
    case "DRAFT":
      return "warning";
    case "APPROVED":
    case "PAYABLE":
    case "SIGNED_UP":
    case "TRIALING":
      return "info";
    case "SUSPENDED":
    case "REVERSED":
    case "FAILED":
    case "REFUNDED":
      return "danger";
    default:
      return "neutral";
  }
}
