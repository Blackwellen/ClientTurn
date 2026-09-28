import "server-only";
import * as React from "react";
import Link from "next/link";
import { Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/feedback";
import { StatusBadge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import { hasRole, type BusinessRole } from "@/lib/auth/session";
import { leadPageHref } from "@/lib/leads/detail-page";
import { loadLeadCalls, loadVoiceSettingsView } from "@/lib/voice/ui-queries";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { CallCard as CallCardView } from "@/lib/voice/call-view";
import { CallCard } from "./call-card";
import { CallWithAiButton } from "./call-with-ai-button";

/**
 * The lead page's voice panel (P2): "Call with AI", the latest call's summary,
 * the callback the lead asked for, and a short call history. Full call cards
 * (transcript, recording) live in the Conversation tab's timeline.
 *
 * States: loading (skeleton), error, empty (no calls yet), plan-limit (voice
 * locked on a trial or unpaid plan: the button is disabled and links to
 * billing, and nothing here can place a call), integration-required (calling
 * not connected), permission (viewers cannot call).
 */

type LeadFacts = { id: string; name: string; phone: string | null; optedOut: boolean; anonymised: boolean; archived: boolean };

function Shell({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section aria-labelledby="lead-voice-title" className="rounded-xl border border-line bg-surface shadow-xs">
      <header className="flex items-center justify-between gap-3 border-b border-line-subtle px-5 py-3.5">
        <h2 id="lead-voice-title" className="flex items-center gap-2 text-[14px] font-semibold text-content">
          <Phone className="size-4 text-content-muted" aria-hidden />
          AI calls
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Why "Call with AI" is unavailable, most fundamental first. Null = it may be offered. */
export function callDisabledReason(input: {
  role: BusinessRole;
  lead: Pick<LeadFacts, "phone" | "optedOut" | "anonymised" | "archived">;
  view: VoiceSettingsView;
  latest: CallCardView | null;
}): string | null {
  const { view, lead } = input;
  if (view.entitlement.locked) return "Voice is a paid feature and isn't on this plan.";
  if (view.settings.adminKillSwitch) return "AI calling is paused for this workspace by ClientTurn.";
  if (!view.integration.ready) return "Calling isn't connected on this environment yet.";
  if (!hasRole(input.role, "member")) return "Viewers can't place calls.";
  if (lead.anonymised) return "This lead's personal data has been erased.";
  if (lead.archived) return "This lead is archived.";
  if (lead.optedOut) return "This lead has opted out of contact.";
  if (!lead.phone) return "This lead has no phone number to call.";
  if (!view.entitlement.allowed) return view.entitlement.message ?? "Voice isn't ready on this workspace yet. Check Settings, Voice.";
  if (input.latest?.inProgress) return "A call to this lead is already in progress.";
  return null;
}

export async function LeadVoiceCard({
  businessId,
  userId,
  role,
  lead,
}: {
  businessId: string;
  userId: string;
  role: BusinessRole;
  lead: LeadFacts;
}) {
  const [view, calls] = await Promise.all([
    loadVoiceSettingsView(businessId, userId, role),
    loadLeadCalls(businessId, userId, role, lead.id),
  ]);

  if (!view.ok || !calls.ok) {
    return (
      <Shell>
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="alert">
          Calls could not be loaded right now. Nothing has changed; try again shortly.
        </p>
      </Shell>
    );
  }

  const cards = calls.data;
  const latest = cards[0] ?? null;
  const reason = callDisabledReason({ role, lead, view: view.data, latest });
  const latestWithSummary = cards.find((c) => c.summary) ?? null;
  const callback = cards.find((c) => c.callbackRequestedFor || c.nextAction) ?? null;
  const canCancel = hasRole(role, "member");

  return (
    <Shell>
      <div className="space-y-4 px-5 py-4">
        <CallWithAiButton leadId={lead.id} leadName={lead.name} disabledReason={reason} numberE164={view.data.number.e164} />
        {view.data.entitlement.locked && (
          <p className="text-[12px] text-content-muted">
            <Link href="/app/settings?section=billing" className="font-medium text-content-accent underline-offset-4 hover:underline">
              See plans with AI calling
            </Link>
          </p>
        )}
        {!view.data.entitlement.locked && !view.data.entitlement.allowed && hasRole(role, "admin") && (
          <p className="text-[12px] text-content-muted">
            <Link href="/app/settings?section=voice&panel=overview" className="font-medium text-content-accent underline-offset-4 hover:underline">
              Open voice settings
            </Link>
          </p>
        )}

        {cards.length === 0 ? (
          <p className="text-[12.5px] text-content-muted">No AI calls with this lead yet.</p>
        ) : (
          <>
            {latestWithSummary?.summary && (
              <div>
                <p className="text-[12px] font-medium text-content-muted">Latest summary</p>
                <p className="mt-1 text-[13px] text-content-secondary">{latestWithSummary.summary}</p>
              </div>
            )}
            {callback && (
              <div>
                <p className="text-[12px] font-medium text-content-muted">Callback preference</p>
                <p className="mt-1 text-[13px] text-content">
                  {callback.callbackRequestedFor ?? callback.nextAction}
                </p>
                {callback.callbackRequestedFor && callback.nextAction && (
                  <p className="mt-0.5 text-[12px] text-content-muted">{callback.nextAction}</p>
                )}
              </div>
            )}
            {latest && latest.inProgress && <CallCard card={latest} leadId={lead.id} canCancel={canCancel} compact />}
            <div>
              <p className="text-[12px] font-medium text-content-muted">History</p>
              <ul className="mt-1.5 divide-y divide-line-subtle">
                {cards.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12.5px]">
                    <span className="text-content-secondary">
                      <time dateTime={c.at}>{formatDateTime(c.at)}</time>
                      {c.durationLabel && <span className="text-content-muted"> · {c.durationLabel}</span>}
                    </span>
                    <StatusBadge kind={c.disposition ? "voice_disposition" : "voice_call"} value={c.disposition ?? c.state} dense />
                  </li>
                ))}
              </ul>
              <Link
                href={leadPageHref(lead.id, "conversation")}
                className="mt-1 inline-block text-[12.5px] font-medium text-content-accent underline-offset-4 hover:underline"
              >
                Transcripts and recordings in Conversation
              </Link>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}

export function LeadVoiceSkeleton() {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs" aria-busy="true" aria-label="Loading AI calls">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-8 w-full" />
      <Skeleton className="mt-3 h-3 w-3/4" />
    </section>
  );
}

/**
 * The calls block in the lead's Conversation tab: every AI call as a full
 * card (summary, transcript, recording, disposition), newest first. Rendered
 * beside the message thread, which has its own composer and ordering.
 */
export async function LeadCallsTimeline({
  businessId,
  userId,
  role,
  leadId,
}: {
  businessId: string;
  userId: string;
  role: BusinessRole;
  leadId: string;
}) {
  const calls = await loadLeadCalls(businessId, userId, role, leadId);
  if (!calls.ok) {
    return (
      <p className="rounded-lg border border-line bg-surface-sunken px-3 py-2.5 text-[12.5px] text-content-muted" role="alert">
        AI calls could not be loaded right now. Messages are unaffected.
      </p>
    );
  }
  if (calls.data.length === 0) return null;
  const canCancel = hasRole(role, "member");
  return (
    <section aria-labelledby="lead-calls-title" className="space-y-2.5">
      <h3 id="lead-calls-title" className="flex items-center gap-2 text-[13px] font-semibold text-content">
        <Phone className="size-3.5 text-content-muted" aria-hidden />
        Calls
        <span className="font-normal text-content-muted">({calls.data.length})</span>
      </h3>
      {calls.data.map((card) => (
        <CallCard key={card.id} card={card} leadId={leadId} canCancel={canCancel} />
      ))}
    </section>
  );
}
