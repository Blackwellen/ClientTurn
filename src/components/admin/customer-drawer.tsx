"use client";

import * as React from "react";
import { Drawer } from "@/components/ui/drawer";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { StepUpDialog } from "./step-up-dialog";
import { SuspendDialog } from "./suspend-dialog";
import {
  formatDate,
  formatDateTime,
  formatMoneyPrecise,
  formatNumber,
  formatRelative,
  providerLabel,
} from "@/lib/admin/format";
import {
  type CustomerDetail,
} from "@/lib/admin/types";
import {
  resendOnboardingEmail,
  suspendWorkspace,
  triggerIntegrationHealthCheck,
  unsuspendWorkspace,
} from "@/lib/admin/actions";
import type { AdminActionResult } from "@/lib/admin/actions";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-content-subtle text-[12px]">{label}</dt>
      <dd className="text-content mt-0.5 text-[13px] break-words">{children}</dd>
    </div>
  );
}

export function CustomerDrawer({
  detail,
  onClose,
}: {
  detail: CustomerDetail;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [tab, setTab] = React.useState("overview");
  const [pending, setPending] = React.useState<string | null>(null);
  const [confirmSuspend, setConfirmSuspend] = React.useState(false);
  const [stepUpFor, setStepUpFor] = React.useState<null | (() => Promise<void>)>(
    null,
  );

  const suspended = detail.status === "suspended";

  /**
   * Every mutating support action funnels through here so a step-up challenge
   * is offered once and the action is retried only after it is satisfied.
   */
  const run = React.useCallback(
    async (key: string, fn: () => Promise<AdminActionResult>, success: string) => {
      setPending(key);
      try {
        const result = await fn();
        if (result.ok) {
          toast({ variant: "success", title: result.message ?? success });
          return;
        }
        if (result.code === "step_up_required") {
          setStepUpFor(() => async () => {
            const retry = await fn();
            if (retry.ok) toast({ variant: "success", title: retry.message ?? success });
            else toast({ variant: "error", title: retry.error });
          });
          return;
        }
        toast({ variant: "error", title: result.error });
      } finally {
        setPending(null);
      }
    },
    [toast],
  );

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "members", label: "Members", count: detail.members.length },
    { value: "integrations", label: "Integrations", count: detail.integrations.length },
    { value: "activity", label: "Activity" },
    { value: "errors", label: "Errors", count: detail.errors.length },
  ];

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        size="xl"
        title={detail.name}
        description={`${detail.plan} · ${detail.subscriptionStatus} · joined ${formatDate(detail.createdAt)}`}
      >
        <div className="-mx-5 -my-4">
          <div className="border-line flex flex-wrap gap-1.5 border-b px-5 py-2.5">
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "onboarding"}
              onClick={() =>
                run(
                  "onboarding",
                  () => resendOnboardingEmail(detail.id),
                  "Onboarding email resent.",
                )
              }
            >
              Resend onboarding email
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={pending === "health"}
              onClick={() =>
                run(
                  "health",
                  () => triggerIntegrationHealthCheck(detail.id),
                  "Health check queued.",
                )
              }
            >
              Run integration health check
            </Button>
            {suspended ? (
              <Button
                variant="secondary"
                size="sm"
                loading={pending === "unsuspend"}
                onClick={() =>
                  run(
                    "unsuspend",
                    () => unsuspendWorkspace(detail.id),
                    "Workspace unsuspended.",
                  )
                }
              >
                Unsuspend workspace
              </Button>
            ) : (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setConfirmSuspend(true)}
              >
                Suspend workspace
              </Button>
            )}
          </div>

          <div className="px-5">
            <Tabs items={tabs} value={tab} onChange={setTab} />
          </div>

          <div className="px-5 py-4">
            <TabPanel value="overview" activeValue={tab}>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5">
                <Field label="Workspace status">{detail.status}</Field>
                <Field label="Onboarding step">{detail.onboardingStep}</Field>
                <Field label="Industry">{detail.industry ?? "—"}</Field>
                <Field label="Website">{detail.website ?? "—"}</Field>
                <Field label="Timezone">{detail.timezone}</Field>
                <Field label="Activated">{formatDateTime(detail.activatedAt)}</Field>
                <Field label="Plan">{detail.plan}</Field>
                <Field label="Subscription">
                  <StatusBadge kind="subscription" value={detail.subscriptionStatus} />
                </Field>
                <Field label="Billing interval">
                  {detail.billingInterval ?? "—"}
                </Field>
                <Field label="Trial ends">{formatDateTime(detail.trialEndsAt)}</Field>
                <Field label="Current period">
                  {formatDate(detail.currentPeriodStart)} –{" "}
                  {formatDate(detail.currentPeriodEnd)}
                </Field>
                <Field label="Cancels at period end">
                  {detail.cancelAtPeriodEnd ? "Yes" : "No"}
                </Field>
                <Field label="Leads this period">
                  {formatNumber(detail.leadsThisPeriod)} of{" "}
                  {formatNumber(detail.leadLimit)}
                </Field>
                <Field label="Leads all time">
                  {formatNumber(detail.leadsTotal)}
                </Field>
                <Field label="Messages this period">
                  {formatNumber(detail.messagesThisPeriod)}
                </Field>
                <Field label="Failed messages">
                  {formatNumber(detail.failedMessagesThisPeriod)}
                </Field>
                <Field label="Bookings this period">
                  {formatNumber(detail.bookingsThisPeriod)}
                </Field>
                <Field label="Seats">
                  {detail.members.length} of {formatNumber(detail.userLimit)}
                </Field>
                <Field label="AI cost (30d)">
                  {formatMoneyPrecise(detail.economics.aiCostUsd30d)} across{" "}
                  {formatNumber(detail.economics.aiCallCount30d)} calls
                </Field>
              </dl>
            </TabPanel>

            <TabPanel value="members" activeValue={tab}>
              <ul className="divide-line divide-y">
                {detail.members.map((member) => (
                  <li
                    key={member.id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-content text-[13px] font-medium">
                        {member.name}
                      </p>
                      <p className="text-content-subtle text-[12px]">
                        {member.email}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-content text-[13px]">{member.role}</p>
                      <p className="text-content-subtle text-[12px]">
                        {member.status} · {formatDate(member.joinedAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </TabPanel>

            <TabPanel value="integrations" activeValue={tab}>
              {detail.integrations.length === 0 ? (
                <p className="text-content-muted py-8 text-center text-[13px]">
                  Nothing connected.
                </p>
              ) : (
                <ul className="divide-line divide-y">
                  {detail.integrations.map((integration) => (
                    <li key={integration.id} className="py-3 first:pt-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-content text-[13px] font-medium">
                            {providerLabel(integration.provider)}
                          </p>
                          <p className="text-content-subtle text-[12px]">
                            {integration.displayName ??
                              integration.accountReference ??
                              "No account reference"}
                          </p>
                          {integration.lastErrorMessage && (
                            <p className="text-danger-600 mt-1 text-[12px]">
                              {integration.lastErrorCode}:{" "}
                              {integration.lastErrorMessage}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <StatusBadge
                            kind="integration"
                            value={integration.status}
                          />
                          <p className="text-content-subtle mt-1 text-[12px]">
                            ok {formatRelative(integration.lastSuccessAt)}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-content-subtle border-line mt-4 border-t pt-3 text-[12px]">
                Tokens and secrets are never read by this view.
              </p>
            </TabPanel>

            <TabPanel value="activity" activeValue={tab}>
              {detail.events.length === 0 ? (
                <p className="text-content-muted py-8 text-center text-[13px]">
                  No recorded activity.
                </p>
              ) : (
                <ul className="divide-line divide-y">
                  {detail.events.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <span className="text-content text-[13px]">
                        {event.action.replace(/[._]/g, " ")}
                      </span>
                      <span className="text-content-subtle shrink-0 text-[12px]">
                        {event.actorType} · {formatRelative(event.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>

            <TabPanel value="errors" activeValue={tab}>
              {detail.errors.length === 0 ? (
                <p className="text-content-muted py-8 text-center text-[13px]">
                  No recent errors.
                </p>
              ) : (
                <ul className="divide-line divide-y">
                  {detail.errors.map((error) => (
                    <li key={error.id} className="py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-content text-[13px] font-medium">
                            {error.area}
                          </p>
                          <p className="text-content-muted text-[13px] break-words">
                            {error.message}
                          </p>
                        </div>
                        <span className="text-content-subtle shrink-0 text-[12px]">
                          {formatRelative(error.occurredAt)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </TabPanel>
          </div>
        </div>
      </Drawer>

      <SuspendDialog
        open={confirmSuspend}
        workspaceName={detail.name}
        memberCount={detail.members.length}
        onClose={() => setConfirmSuspend(false)}
        onConfirm={async (reason) => {
          setConfirmSuspend(false);
          await run(
            "suspend",
            () => suspendWorkspace(detail.id, reason),
            "Workspace suspended.",
          );
        }}
      />

      <StepUpDialog
        open={stepUpFor !== null}
        onClose={() => setStepUpFor(null)}
        onConfirmed={async () => {
          const action = stepUpFor;
          setStepUpFor(null);
          if (action) await action();
        }}
      />
    </>
  );
}
