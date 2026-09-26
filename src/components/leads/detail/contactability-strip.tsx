import "server-only";
import * as React from "react";
import { randomUUID } from "node:crypto";
import { ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/feedback";
import { runOperation } from "@/lib/services";
import { hasRole, type ActiveWorkspace } from "@/lib/auth/session";
import { loadWhatsAppOptIn } from "@/lib/leads/detail-queries";
import { WhatsAppOptInControl } from "./whatsapp-opt-in";

/**
 * Whether this lead may be contacted on each channel, and why, from the
 * policy engine. Runs `lead.contactability`, which evaluates permission only
 * (no quiet hours, no caps) and records nothing: looking at a lead is not a
 * send, and must not leave compliance evidence as if it were.
 */

const CHANNEL_LABELS: Record<string, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  SOCIAL: "Social",
};

type ChannelVerdict = { channel: string; decision: string; reason: string; state: string };

export async function ContactabilityStrip({
  workspace,
  leadId,
}: {
  workspace: ActiveWorkspace;
  leadId: string;
}) {
  const [result, optIn] = await Promise.all([
    runOperation<{ channels: ChannelVerdict[] }>(
      "lead.contactability",
      { leadId },
      {
        businessId: workspace.businessId,
        userId: workspace.userId,
        role: workspace.role,
        caller: "UI",
        correlationId: randomUUID(),
      },
    ),
    // A failed read hides the control rather than claiming there is no opt-in.
    loadWhatsAppOptIn(workspace.businessId, leadId).catch(() => null),
  ]);

  if (!result.success) {
    return (
      <RailCard>
        <p className="px-5 py-4 text-[12.5px] text-content-muted" role="status">
          Contactability could not be checked right now. Every send is still checked at the moment it goes.
        </p>
      </RailCard>
    );
  }

  return (
    <RailCard>
      <ul className="divide-y divide-line-subtle">
        {result.data.channels.map((channel) => (
          <li key={channel.channel} className="min-w-0 px-5 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-content">
                {CHANNEL_LABELS[channel.channel] ?? channel.channel}
              </span>
              <StatusBadge kind="contact_decision" value={channel.decision} dense />
            </div>
            <p className="mt-1 text-[12px] leading-snug text-content-muted">{channel.reason}</p>
            {channel.channel === "WHATSAPP" && optIn?.hasMobile && (
              <WhatsAppOptInControl
                leadId={leadId}
                optedIn={optIn.optedIn}
                optedInOn={optIn.optedInOn}
                source={optIn.source}
                canWrite={hasRole(workspace.role, "member")}
              />
            )}
          </li>
        ))}
      </ul>
    </RailCard>
  );
}

/** The right-rail card the strip renders in, shared with its skeleton. */
function RailCard({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="lead-contactability-title"
      className="rounded-xl border border-line bg-surface shadow-xs"
    >
      <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-4">
        <ShieldCheck className="size-4 text-content-subtle" aria-hidden />
        <h2 id="lead-contactability-title" className="text-[15px] font-semibold text-content">
          Contactability
        </h2>
      </div>
      {children}
    </section>
  );
}

export function ContactabilitySkeleton() {
  return (
    <RailCard>
      <div aria-busy="true" aria-label="Checking contactability" className="space-y-3 px-5 py-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-10 rounded-lg" />
        ))}
      </div>
    </RailCard>
  );
}
