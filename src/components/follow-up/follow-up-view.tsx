import Link from "next/link";
import {
  getAutomation,
  getQuietHours,
  listAutomations,
  missingAutomationTypes,
} from "@/lib/automations/queries";
import { getFollowUpStatus, getTestSendContext } from "@/lib/follow-up/queries";
import { getFollowUpChannelContext } from "@/lib/follow-up/channel-context";
import { getFollowUpPerformance } from "@/lib/follow-up/performance";
import type { Entitlements } from "@/lib/billing/entitlements";
import { PlanLimitState } from "@/components/ui/feedback";
import { TabLink, TabLinkBar } from "@/components/ui/tabs";
import { FollowUpStatusCard } from "@/components/follow-up/status-card";
import { FollowUpWorkspace } from "@/components/follow-up/follow-up-workspace";
import { QuietHoursCard } from "@/components/follow-up/quiet-hours-card";
import { BookingReminderCard } from "@/components/follow-up/booking-reminder-card";
import { TestFollowUpPanel } from "@/components/follow-up/test-follow-up-panel";
import { FollowUpPerformancePanel } from "@/components/follow-up/performance-panel";
import { EnrolmentRulesPanel } from "@/components/follow-up/enrolment-rules-panel";
import { StopConditionsPanel } from "@/components/automations/stop-conditions";
import { AUTOMATION_TYPE_META } from "@/lib/automations/types";
import {
  FOLLOW_UP_TABS,
  followUpHref,
  type FollowUpFilters,
} from "@/lib/follow-up/types";

/**
 * `FollowUpView` — everything that keeps a lead being chased.
 *
 * Four sub-views (V4 §19.4): the sequence itself, the settings that bound
 * every send, the rules that decide who is enrolled, and how it is actually
 * performing. Cold Outreach is deliberately not a fifth tab — a cold sequence
 * belongs to the acquisition campaign that owns its audience, budget and
 * sender (§20.1).
 *
 * Reads are issued in parallel; the sequence detail depends on which sequence
 * is selected, so it forms a deliberate second wave rather than a waterfall
 * per card.
 */
export async function FollowUpView({
  businessId,
  timezone,
  canEdit,
  entitlements,
  filters,
  currentParams,
}: {
  businessId: string;
  timezone: string;
  canEdit: boolean;
  entitlements: Entitlements;
  filters: FollowUpFilters;
  currentParams: Record<string, string | string[] | undefined>;
}) {
  const [automations, quietHours, sendContext, channelContext] =
    await Promise.all([
      listAutomations(businessId),
      getQuietHours(businessId, timezone),
      getTestSendContext(businessId),
      getFollowUpChannelContext(businessId),
    ]);

  const sequences = automations.filter((item) => item.type !== "booking_reminder");
  const bookingItem = automations.find((item) => item.type === "booking_reminder") ?? null;

  const selectedId =
    (filters.sequence && sequences.some((item) => item.id === filters.sequence)
      ? filters.sequence
      : sequences[0]?.id) ?? null;

  const [selected, bookingDetail] = await Promise.all([
    selectedId ? getAutomation(businessId, selectedId) : Promise.resolve(null),
    bookingItem ? getAutomation(businessId, bookingItem.id) : Promise.resolve(null),
  ]);

  const status = await getFollowUpStatus(businessId, sequences, selected);
  const selectedItem = sequences.find((item) => item.id === selectedId) ?? null;
  const bookingCreatable = missingAutomationTypes(automations).includes(
    "booking_reminder",
  );

  return (
    <div className="space-y-4">
      {!entitlements.active && (
        <PlanLimitState
          title="Subscription inactive"
          description="Follow-up sequences are paused while the subscription is inactive. No automated message is sent until billing is up to date."
          action={
            <Link
              href="/app/settings?section=billing"
              className="text-content-accent text-[13px] font-medium"
            >
              Review billing
            </Link>
          }
        />
      )}

      {!canEdit && (
        <div className="border-line bg-surface-sunken rounded-lg border px-4 py-3">
          <p className="text-content text-[13px] font-medium">Read-only access</p>
          <p className="text-content-muted mt-0.5 text-[13px]">
            You can see the sequence, quiet hours and reminders exactly as they
            run. Only an owner or admin can change them.
          </p>
        </div>
      )}

      <FollowUpStatusCard
        status={status}
        canEdit={canEdit}
        automation={
          selectedItem
            ? {
                id: selectedItem.id,
                enabled: selectedItem.enabled,
                leadsInSequence: selectedItem.leadsInSequence,
              }
            : null
        }
      />

      <TabLinkBar aria-label="Follow-up views">
        {FOLLOW_UP_TABS.map((tab) => (
          <TabLink
            key={tab.id}
            href={followUpHref(currentParams, { tab: tab.id })}
            active={filters.tab === tab.id}
          >
            {tab.label}
          </TabLink>
        ))}
      </TabLinkBar>

      {sequences.length > 1 && filters.tab === "sequence" && (
        <TabLinkBar aria-label="Sequence">
          {sequences.map((item) => (
            <TabLink
              key={item.id}
              href={followUpHref(currentParams, { sequence: item.id })}
              active={selectedId === item.id}
            >
              {AUTOMATION_TYPE_META[item.type].label}
            </TabLink>
          ))}
        </TabLinkBar>
      )}

      {filters.tab === "sequence" && (
        <FollowUpWorkspace
          automation={selected}
          canEdit={canEdit}
          context={{
            available: channelContext.available,
            fallbackEnabled: channelContext.fallbackEnabled,
            senderAvailable: channelContext.senderAvailable,
            senderIssue: channelContext.senderIssue,
            policyAllows: channelContext.policyAllows,
            smsConnected: channelContext.smsConnected,
            whatsappEnabled: channelContext.whatsappEnabled,
            whatsappTemplateReady: channelContext.whatsappTemplateReady,
            policyName: channelContext.policyName,
            senders: channelContext.senders,
            defaultSenderId: channelContext.defaultSenderId,
          }}
          previewValues={{
            first_name: null,
            business_name: sendContext.businessName,
            service_name: null,
            booking_link: sendContext.bookingLink,
            business_phone: sendContext.businessPhone,
          }}
        />
      )}

      {filters.tab === "settings" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <QuietHoursCard quietHours={quietHours} canEdit={canEdit} />
            <StopConditionsPanel
              quietHoursLabel={
                quietHours.enabled
                  ? `${quietHours.start}–${quietHours.end} ${quietHours.timezone}`
                  : "Off"
              }
            />
          </div>
          <div className="space-y-4">
            <BookingReminderCard
              item={bookingItem}
              detail={bookingDetail}
              canEdit={canEdit}
              creatable={bookingCreatable}
            />
            <TestFollowUpPanel
              canEdit={canEdit}
              whatsappEnabled={entitlements.whatsappEnabled}
              defaultTo={sendContext.businessPhone}
            />
          </div>
        </div>
      )}

      {filters.tab === "enrolment" && (
        <EnrolmentRulesPanel sequences={sequences} canEdit={canEdit} />
      )}

      {filters.tab === "performance" && (
        <FollowUpPerformancePanel
          performance={await getFollowUpPerformance(businessId)}
        />
      )}
    </div>
  );
}
