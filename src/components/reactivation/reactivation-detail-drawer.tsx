"use client";

import * as React from "react";
import {
  Ban,
  CheckCircle2,
  CircleDashed,
  Clock,
  Copy,
  Info,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Rocket,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerHeader } from "@/components/ui/drawer";
import {
  DropdownItem,
  DropdownMenu,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/ui/modal";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { PlanLimitState } from "@/components/ui/feedback";
import {
  formatDate,
  formatDateTime,
  formatGbp,
  formatPercent,
  formatRelative,
} from "@/lib/dates";
import {
  bookingRate,
  canPerform,
  progressTone,
  qualificationRate,
  replyRate,
  STATUS_BANNER,
  type CampaignAction,
  type ReactivationCampaignDetail,
} from "@/lib/campaigns/reactivation-types";
import { CampaignIcon, CampaignStatusBadge } from "./campaign-icon";
import { CampaignEditDialog } from "./campaign-edit-dialog";
import {
  CAMPAIGN_CONFIRM_COPY,
  useCampaignAction,
} from "./campaign-overflow-menu";

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "audience", label: "Audience" },
  { value: "messages", label: "Messages" },
  { value: "results", label: "Results" },
  { value: "activity", label: "Activity" },
];

const BANNER_STYLES = {
  success: { wrap: "border-success-100 bg-success-50", icon: "text-success-600" },
  info: { wrap: "border-info-100 bg-info-50", icon: "text-info-600" },
  warning: { wrap: "border-warning-100 bg-warning-50", icon: "text-warning-600" },
  danger: { wrap: "border-danger-100 bg-danger-50", icon: "text-danger-600" },
  neutral: { wrap: "border-line bg-surface-sunken", icon: "text-content-muted" },
} as const;

const BANNER_ICONS = {
  success: CheckCircle2,
  info: Clock,
  warning: Pause,
  danger: Ban,
  neutral: CircleDashed,
} as const;

/* -------------------------------------------------------------- bits --- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3 py-1.5">
      <dt className="text-[12.5px] text-content-muted">{label}</dt>
      <dd className="min-w-0 text-[12.5px] text-content">{children}</dd>
    </div>
  );
}

function Panel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-line bg-surface p-3.5 shadow-xs",
        className,
      )}
    >
      <h4 className="text-[13px] font-semibold text-content">{title}</h4>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Rate({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-[12.5px] text-content-secondary">{label}</span>
      <span className="lr-tabular text-[12.5px] font-semibold text-content">
        {formatPercent(value, 1)}
      </span>
    </div>
  );
}

function ResultMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0">
      <p className="lr-tabular truncate text-[15px] font-semibold leading-none text-content">
        {value.toLocaleString("en-GB")}
      </p>
      <p className="mt-1 truncate text-[11px] text-content-muted">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------ drawer --- */

export function ReactivationDetailDrawer({
  campaign,
  canManage,
  tab,
  onTabChange,
  onClose,
}: {
  campaign: ReactivationCampaignDetail;
  canManage: boolean;
  tab: string;
  onTabChange: (tab: string) => void;
  onClose: () => void;
}) {
  const { run, busy } = useCampaignAction(campaign.id);
  const [pending, setPending] = React.useState<CampaignAction | null>(null);
  const [editing, setEditing] = React.useState(false);

  const banner = STATUS_BANNER[campaign.status];
  const BannerIcon = BANNER_ICONS[banner.tone];
  const styles = BANNER_STYLES[banner.tone];

  const allow = (action: CampaignAction) =>
    canManage && canPerform(campaign.status, action);

  /** The single primary lifecycle action the current status permits. */
  const primary = allow("pause")
    ? { action: "pause" as const, label: "Pause", icon: Pause }
    : allow("resume")
      ? { action: "resume" as const, label: "Resume", icon: Play }
      : allow("launch")
        ? { action: "launch" as const, label: "Launch", icon: Rocket }
        : null;

  const totals = campaign.totals;
  const confirmCopy =
    pending && pending in CAMPAIGN_CONFIRM_COPY
      ? CAMPAIGN_CONFIRM_COPY[pending as keyof typeof CAMPAIGN_CONFIRM_COPY]
      : null;

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        size="panel"
        anchor="content"
        title={campaign.name}
        bodyClassName="px-4 py-4"
        header={
          <div className="shrink-0 border-b border-line">
            <DrawerHeader className="items-center border-b-0 px-4 pb-3 pt-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <CampaignIcon icon={campaign.icon} />
                <h2 className="min-w-0 truncate text-[17px] font-semibold text-content">
                  {campaign.name}
                </h2>
                <CampaignStatusBadge status={campaign.status} />
              </div>
              <IconButton size="sm" label="Close campaign" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </DrawerHeader>
            <Tabs
              items={TABS}
              value={tab}
              onChange={onTabChange}
              className="px-2"
            />
          </div>
        }
      >
        {/* ------------------------------------------------- overview --- */}
        <TabPanel value="overview" activeValue={tab} className="space-y-4">
          <div
            className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl border px-3.5 py-3",
              styles.wrap,
            )}
          >
            <BannerIcon
              className={cn("size-5 shrink-0", styles.icon)}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-content">
                {banner.title}
              </p>
              <p className="mt-0.5 text-[12px] text-content-secondary">
                {banner.description}
              </p>
            </div>

            {canManage && (
              <div className="flex shrink-0 items-center gap-1.5">
                {primary && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => setPending(primary.action)}
                  >
                    <primary.icon className="size-3.5" aria-hidden />
                    {primary.label}
                  </Button>
                )}
                {allow("edit") && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                )}
                <DropdownMenu
                  trigger={
                    <button
                      type="button"
                      aria-label="More campaign actions"
                      className="inline-flex h-8 items-center rounded-md border border-line-strong bg-surface px-2 text-content-secondary shadow-xs transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
                    >
                      <MoreHorizontal className="size-4" aria-hidden />
                    </button>
                  }
                >
                  <DropdownItem icon={Copy} onSelect={() => void run("duplicate")}>
                    Duplicate
                  </DropdownItem>
                  {(allow("cancel") || allow("delete")) && <DropdownSeparator />}
                  {allow("cancel") && (
                    <DropdownItem
                      icon={Ban}
                      destructive
                      onSelect={() => setPending("cancel")}
                    >
                      Cancel campaign
                    </DropdownItem>
                  )}
                  {allow("delete") && (
                    <DropdownItem
                      icon={Ban}
                      destructive
                      onSelect={() => setPending("delete")}
                    >
                      Delete draft
                    </DropdownItem>
                  )}
                </DropdownMenu>
              </div>
            )}
          </div>

          {!campaign.providerConnected && (
            <PlanLimitState
              title="Messaging provider is not connected"
              description="This campaign cannot send until a messaging provider is connected. Results below reflect what has already been sent."
              action={
                <a
                  href="/app/settings/connections"
                  className="text-content-accent text-[13px] font-medium"
                >
                  Open connections
                </a>
              }
            />
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <dl className="min-w-0 divide-y divide-line-subtle">
              <Field label="Name">{campaign.name}</Field>
              <Field label="Description">
                {campaign.description ?? (
                  <span className="text-content-subtle">Not set</span>
                )}
              </Field>
              <Field label="Status">
                <CampaignStatusBadge status={campaign.status} />
              </Field>
              <Field label="Created">
                {formatDateTime(campaign.createdAt)}
                {campaign.createdByName ? " by " + campaign.createdByName : ""}
              </Field>
              <Field label="Last updated">
                {formatDateTime(campaign.updatedAt)}
                {campaign.updatedByName ? " by " + campaign.updatedByName : ""}
              </Field>
              <Field label="Send window">{campaign.sendWindow}</Field>
              <Field label="Audience">{campaign.audienceLabel}</Field>
              <Field label="Estimated size">
                {campaign.estimatedAudienceSize.toLocaleString("en-GB")} leads
              </Field>
              <Field label="Tags">
                {campaign.tags.length === 0 ? (
                  <span className="text-content-subtle">None</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    {campaign.tags.map((tag) => (
                      <Badge key={tag} tone="info">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                )}
              </Field>
            </dl>

            <div className="space-y-3">
              <Panel title="Results">
                <div className="grid grid-cols-4 gap-2">
                  <ResultMetric label="Sent" value={totals.sent} />
                  <ResultMetric label="Replies" value={totals.replies} />
                  <ResultMetric label="Qualified" value={totals.qualified} />
                  <ResultMetric label="Booked" value={totals.booked} />
                </div>
                <Progress
                  className="mt-3 h-2"
                  value={campaign.progress}
                  tone={progressTone(campaign.status)}
                  label={campaign.name + " progress"}
                />
                <p className="lr-tabular mt-1.5 text-right text-[11px] text-content-secondary">
                  {campaign.progress}% complete
                </p>
              </Panel>

              <Panel title="Conversion rates">
                <div className="divide-y divide-line-subtle">
                  <Rate
                    label="Reply rate"
                    value={replyRate(totals.sent, totals.replies)}
                  />
                  <Rate
                    label="Qualification rate"
                    value={qualificationRate(totals.replies, totals.qualified)}
                  />
                  <Rate
                    label="Booking rate"
                    value={bookingRate(totals.sent, totals.booked)}
                  />
                </div>
              </Panel>
            </div>
          </div>

          {canManage && (
            <div className="border-t border-line-subtle pt-4">
              <h4 className="text-[13px] font-semibold text-content">
                Quick actions
              </h4>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!allow("edit")}
                  onClick={() => setEditing(true)}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Edit campaign
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={busy}
                  onClick={() => void run("duplicate")}
                >
                  <Copy className="size-3.5" aria-hidden />
                  Duplicate
                </Button>
                {allow("cancel") && (
                  <Button
                    variant="secondary"
                    size="md"
                    disabled={busy}
                    onClick={() => setPending("cancel")}
                    className="border-danger-200 text-danger-600 hover:bg-danger-50"
                  >
                    <Ban className="size-3.5" aria-hidden />
                    Cancel campaign
                  </Button>
                )}
              </div>
            </div>
          )}
        </TabPanel>

        {/* ------------------------------------------------- audience --- */}
        <TabPanel value="audience" activeValue={tab} className="space-y-4">
          <dl className="divide-y divide-line-subtle">
            <Field label="Audience">{campaign.audienceLabel}</Field>
            <Field label="Estimated size">
              {campaign.estimatedAudienceSize.toLocaleString("en-GB")} leads
            </Field>
            <Field label="In campaign">
              {totals.audience.toLocaleString("en-GB")} contacts
            </Field>
          </dl>

          <Panel title="Eligibility rules">
            <ul className="space-y-2.5">
              {campaign.eligibilityRules.map((rule) => (
                <li key={rule.label} className="flex items-start gap-2.5">
                  <CheckCircle2
                    className="mt-px size-4 shrink-0 text-success-600"
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-content">
                      {rule.label}
                    </p>
                    <p className="mt-0.5 text-[12px] text-content-muted">
                      {rule.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-start gap-2 rounded-lg bg-surface-sunken px-2.5 py-2 text-[12px] text-content-secondary">
              <Info className="mt-px size-3.5 shrink-0" aria-hidden />
              Every rule is re-checked immediately before each individual send,
              not just when the audience was built.
            </p>
          </Panel>

          <Panel title="Audience preview">
            {campaign.audienceSample.length === 0 ? (
              <p className="text-[12.5px] text-content-muted">
                No contacts have been added to this campaign yet. The audience
                is resolved when the campaign launches.
              </p>
            ) : (
              <>
                <ul className="divide-y divide-line-subtle">
                  {campaign.audienceSample.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12.5px] font-medium text-content">
                          {row.name}
                        </p>
                        <p className="truncate text-[11.5px] text-content-muted">
                          {[row.service, row.contact].filter(Boolean).join(" · ") ||
                            "No service recorded"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge
                          tone={
                            row.eligibility === "converted"
                              ? "success"
                              : row.eligibility === "excluded"
                                ? "neutral"
                                : row.eligibility === "contacted"
                                  ? "info"
                                  : "accent"
                          }
                        >
                          {row.eligibilityLabel}
                        </Badge>
                        <p className="mt-0.5 text-[11px] text-content-subtle">
                          {row.lastActivityAt
                            ? formatRelative(row.lastActivityAt)
                            : "No activity"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                {campaign.audienceSampleTotal > campaign.audienceSample.length && (
                  <p className="mt-3 text-[12px] text-content-muted">
                    Showing {campaign.audienceSample.length} of{" "}
                    {campaign.audienceSampleTotal.toLocaleString("en-GB")}{" "}
                    contacts.{" "}
                    <a
                      href={"/app/leads?campaign=" + campaign.id}
                      className="font-medium text-content-accent"
                    >
                      View audience in Leads
                    </a>
                  </p>
                )}
              </>
            )}
          </Panel>
        </TabPanel>

        {/* ------------------------------------------------- messages --- */}
        <TabPanel value="messages" activeValue={tab} className="space-y-3">
          <p className="text-[12.5px] text-content-muted">
            Reactivation sends a short, fixed sequence — an opening message and
            at most one follow-up. Every send re-checks opt-outs, suppressions
            and the send window.
          </p>

          {campaign.messages.map((message) => (
            <Panel
              key={message.position}
              title={"Message " + message.position + " — " + message.label}
            >
              <dl className="divide-y divide-line-subtle">
                <Field label="Channel">
                  <span className="uppercase">{message.channel}</span>
                </Field>
                <Field label="Timing">{message.timing}</Field>
                <Field label="Status">
                  <Badge tone={message.enabled ? "success" : "neutral"}>
                    {message.enabled ? "Active" : "Off"}
                  </Badge>
                </Field>
                <Field label="Sent">
                  {message.sent.toLocaleString("en-GB")}
                </Field>
              </dl>
              <div className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
                <p className="text-[11px] font-medium text-content-subtle">
                  Template
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-content">
                  {message.body ?? "No template saved."}
                </p>
              </div>
            </Panel>
          ))}
        </TabPanel>

        {/* -------------------------------------------------- results --- */}
        <TabPanel value="results" activeValue={tab} className="space-y-4">
          <Panel title="Funnel">
            <ul className="space-y-2">
              {[
                { label: "Eligible audience", value: campaign.estimatedAudienceSize },
                { label: "Sent", value: totals.sent },
                { label: "Delivered", value: totals.delivered },
                { label: "Replies", value: totals.replies },
                { label: "Qualified", value: totals.qualified },
                { label: "Booked", value: totals.booked },
              ].map((step) => {
                const base = Math.max(campaign.estimatedAudienceSize, 1);
                const share = Math.min(100, (step.value / base) * 100);
                return (
                  <li key={step.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12.5px] text-content-secondary">
                        {step.label}
                      </span>
                      <span className="lr-tabular text-[12.5px] font-semibold text-content">
                        {step.value.toLocaleString("en-GB")}
                      </span>
                    </div>
                    <Progress
                      className="mt-1 h-1.5"
                      value={share}
                      tone="success"
                      label={step.label}
                    />
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="Conversion rates">
              <div className="divide-y divide-line-subtle">
                <Rate
                  label="Reply rate"
                  value={replyRate(totals.sent, totals.replies)}
                />
                <Rate
                  label="Qualification rate"
                  value={qualificationRate(totals.replies, totals.qualified)}
                />
                <Rate
                  label="Booking rate"
                  value={bookingRate(totals.sent, totals.booked)}
                />
              </div>
            </Panel>

            <Panel title="Outcome">
              <dl className="divide-y divide-line-subtle">
                <Field label="Revenue">{formatGbp(totals.revenue)}</Field>
                <Field label="Still waiting">
                  {totals.pending.toLocaleString("en-GB")}
                </Field>
                <Field label="Failed">
                  {totals.failed.toLocaleString("en-GB")}
                </Field>
                <Field label="Stopped">
                  {totals.stopped.toLocaleString("en-GB")}
                </Field>
              </dl>
              <p className="mt-2 text-[11px] text-content-subtle">
                Revenue is the average job value of the services booked by
                leads this campaign re-contacted — not invoiced revenue.
              </p>
            </Panel>
          </div>
        </TabPanel>

        {/* ------------------------------------------------- activity --- */}
        <TabPanel value="activity" activeValue={tab}>
          {campaign.activity.length === 0 ? (
            <p className="text-[12.5px] text-content-muted">
              Nothing has been recorded for this campaign yet.
            </p>
          ) : (
            <ol className="space-y-3">
              {campaign.activity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-sunken text-content-muted"
                  >
                    {entry.action === "campaign.cancelled" ? (
                      <Ban className="size-3.5" />
                    ) : entry.action === "campaign.paused" ? (
                      <Pause className="size-3.5" />
                    ) : entry.action === "campaign.launched" ||
                      entry.action === "campaign.resumed" ? (
                      <Play className="size-3.5" />
                    ) : entry.action === "campaign.updated" ? (
                      <Pencil className="size-3.5" />
                    ) : (
                      <Clock className="size-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium text-content">
                      {entry.label}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-content-muted">
                      {entry.actor} · {formatDate(entry.at)},{" "}
                      {formatRelative(entry.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </TabPanel>
      </Drawer>

      {confirmCopy && (
        <ConfirmDialog
          open
          onClose={() => setPending(null)}
          onConfirm={async () => {
            const done = await run(pending as CampaignAction);
            setPending(null);
            // A deleted draft no longer exists, so the drawer must not stay open.
            if (done && pending === "delete") onClose();
          }}
          title={confirmCopy.title}
          scope={confirmCopy.scope}
          consequence={confirmCopy.consequence}
          confirmLabel={confirmCopy.confirm}
          variant={
            "danger" in confirmCopy && confirmCopy.danger ? "danger" : "default"
          }
          loading={busy}
        />
      )}

      <CampaignEditDialog
        campaign={campaign}
        open={editing}
        onClose={() => setEditing(false)}
      />
    </>
  );
}
