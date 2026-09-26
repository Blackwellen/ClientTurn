"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { LeadCapabilities, LeadDetail } from "@/lib/leads/types";
import {
  assignLead,
  humanTakeover,
  markLost,
  markWon,
  resumeAutomation,
  sendBookingLink,
  sendManualMessage,
  setNeedsAttention,
  setQualificationResult,
  updateLeadStatus,
} from "@/lib/leads/actions";
import { LeadConversationSection } from "../lead-conversation-section";
import type { LeadDrawerActions } from "../lead-drawer-actions";

/**
 * The Conversation tab: the drawer's own thread and composer, reused as they
 * are so a message sent from the page and from the drawer is the same action
 * (`sendManualMessage`, with its suppression, entitlement and duplicate-send
 * checks). Arriving with `#composer` puts the caret in the composer.
 */

const ACTIONS: LeadDrawerActions = {
  assignLead,
  updateLeadStatus,
  setQualificationResult,
  setNeedsAttention,
  humanTakeover,
  resumeAutomation,
  sendManualMessage,
  sendBookingLink,
  markWon,
  markLost,
};

export function LeadPageConversation({
  detail,
  capabilities,
  canWrite,
}: {
  detail: LeadDetail;
  capabilities: LeadCapabilities;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [channel, setChannel] = React.useState<"sms" | "whatsapp">(
    capabilities.sms || !capabilities.whatsapp ? "sms" : "whatsapp",
  );
  const composerRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (window.location.hash === "#composer") {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: "center" });
    }
  }, []);

  const run = React.useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
      setPending(key);
      try {
        const result = await fn();
        if (result.ok) {
          toast({ variant: "success", title: success });
          router.refresh();
        } else {
          toast({ variant: "error", title: result.error ?? "That did not work." });
        }
        return result.ok;
      } finally {
        setPending(null);
      }
    },
    [router, toast],
  );

  return (
    <div
      id="composer"
      className="flex h-[min(70vh,720px)] min-h-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xs"
    >
      <LeadConversationSection
        detail={detail}
        actions={ACTIONS}
        capabilities={capabilities}
        canWrite={canWrite}
        pending={pending}
        run={run}
        channel={channel}
        onChannelChange={setChannel}
        composerRef={composerRef}
      />
    </div>
  );
}
