"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { allowAiCallsAction, saveAgentVoiceCalls } from "@/lib/agents/actions";
import {
  AGENT_VOICE_DEFAULT_DAILY_CAP,
  AGENT_VOICE_MAX_DAILY_CAP,
  AI_PERMISSIONS_HREF,
  agentCallingScope,
  agentVoiceOption,
  type AgentVoiceAvailability,
} from "@/lib/agents/voice-calls";

/**
 * "Phone leads with AI" (0176), in the new-agent wizard and on the agent's
 * Settings tab. Off by default.
 *
 * Offered only when the workspace can place a call; otherwise it is shown
 * disabled with the reason and, for admins, the link to fix it. Turning it on
 * never turns on the workspace's "Phone leads" permission: when that is off
 * the field says the agent won't call yet and offers the separate, explicit
 * (and audited) "Allow the AI to phone leads".
 */

export type AgentVoiceValue = { enabled: boolean; dailyCallCap: number };

export const DEFAULT_AGENT_VOICE_VALUE: AgentVoiceValue = { enabled: false, dailyCallCap: AGENT_VOICE_DEFAULT_DAILY_CAP };

function whoItCalls(type: string): string {
  const scope = agentCallingScope(type);
  if (!scope.applies) return "";
  return scope.work.includes("QUALIFICATION")
    ? "On each run it asks the AI to phone new leads to qualify them, and qualified leads that have gone quiet, toward their goal."
    : "On each run it asks the AI to phone qualified leads that have gone quiet, toward their goal: a meeting booked, or a sale or sign-up.";
}

export function AgentVoiceCallsField({
  agentType,
  availability,
  value,
  onChange,
}: {
  agentType: string;
  availability: AgentVoiceAvailability;
  value: AgentVoiceValue;
  onChange: (next: AgentVoiceValue) => void;
}) {
  const [aiMayCall, setAiMayCall] = React.useState(availability.aiMayCall);
  const option = agentVoiceOption(agentType, { ...availability, aiMayCall });
  const checkboxId = React.useId();
  const reasonId = React.useId();
  const capId = React.useId();
  // An option already on stays switchable off even when it can no longer be
  // switched on (voice lapsed); the server refuses switching it on regardless.
  const enabled = value.enabled;

  return (
    <div className="rounded-lg border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <input
          id={checkboxId}
          type="checkbox"
          checked={enabled}
          disabled={!option.selectable && !value.enabled}
          aria-describedby={option.reason ? reasonId : undefined}
          onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent-600)] disabled:cursor-not-allowed"
        />
        <div className="min-w-0 flex-1">
          <label htmlFor={checkboxId} className="flex items-center gap-1.5 text-[13px] font-medium text-content">
            <Phone className="size-3.5 text-content-muted" aria-hidden />
            Phone leads with AI
          </label>
          <p className="mt-0.5 text-[12px] text-content-muted">
            {whoItCalls(agentType) || "This agent doesn't phone leads."}{" "}
            {agentCallingScope(agentType).applies &&
              "Only leads who gave you their number and agreed to be called. Calling hours, TPS, attempt limits, opt-outs and your minutes are checked before every call. Unless the agent is set to Run automatically, each call waits in its Queue for a person to approve. A lead it calls gets no text follow-up from the same run."}
          </p>

          {option.reason && (
            <p id={reasonId} className="mt-1.5 text-[12px] text-content-secondary">
              {option.reason}{" "}
              {option.fixHref && option.fixLabel && (
                <Link href={option.fixHref} className="font-medium text-content-accent underline-offset-4 hover:underline">
                  {option.fixLabel}
                </Link>
              )}
            </p>
          )}

          {enabled && (
            <div className="mt-3 max-w-[200px]">
              <label htmlFor={capId} className="mb-1 block text-[12px] font-medium text-content-secondary">
                Calls per day, at most
              </label>
              <input
                id={capId}
                type="number"
                min={1}
                max={AGENT_VOICE_MAX_DAILY_CAP}
                value={value.dailyCallCap}
                onChange={(event) => onChange({ ...value, dailyCallCap: Number(event.target.value) })}
                className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] text-content focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-content-accent"
              />
            </div>
          )}

          {enabled && option.needsCallPermission && (
            <CallPermissionNotice canManage={availability.canManage} onAllowed={() => setAiMayCall(true)} />
          )}
        </div>
      </div>
    </div>
  );
}

/** The explicit, audited step: never taken for the admin. */
function CallPermissionNotice({ canManage, onAllowed }: { canManage: boolean; onAllowed: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);

  async function allow() {
    const result = await allowAiCallsAction();
    setOpen(false);
    if (result.ok) {
      onAllowed();
      toast({ variant: "success", title: "The AI may now phone leads." });
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  return (
    <div role="status" className="mt-3 rounded-md border border-warning-100 bg-warning-50 px-3 py-2.5 text-[12px] text-warning-700">
      <p>
        The agent won&rsquo;t call yet: <strong>Phone leads</strong> is off in What the AI may do. Switching this agent on doesn&rsquo;t
        change that.
      </p>
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            Allow the AI to phone leads
          </Button>
          <Link href={AI_PERMISSIONS_HREF} className="font-medium text-content-accent underline-offset-4 hover:underline">
            Review What the AI may do
          </Link>
        </div>
      )}
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={allow}
        title="Allow the AI to phone leads?"
        scope="This turns on Phone leads in What the AI may do for the whole workspace: agents with Phone leads with AI on, and the conversation assistant when a lead asks for a call, may then ask the AI to phone a lead."
        consequence="Every call still needs the lead's consent to be called, their calling hours, TPS screening, your attempt limits and minutes. The change is recorded in your audit log, and you can turn it off again in Settings, AI & selling."
        confirmLabel="Allow AI calls"
      />
    </div>
  );
}

/**
 * The agent's Settings tab panel: the field plus its own save, with a
 * confirmation before switching calls on (they are real calls and use minutes).
 */
export function AgentVoiceCallsForm({
  agentId,
  agentType,
  availability,
  initial,
}: {
  agentId: string;
  agentType: string;
  availability: AgentVoiceAvailability;
  initial: AgentVoiceValue;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = React.useState<AgentVoiceValue>(initial);
  const [confirming, setConfirming] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [error, setError] = React.useState("");
  const option = agentVoiceOption(agentType, availability);
  const changed = value.enabled !== initial.enabled || value.dailyCallCap !== initial.dailyCallCap;

  function persist() {
    setError("");
    startTransition(async () => {
      const result = await saveAgentVoiceCalls({ id: agentId, enabled: value.enabled, dailyCallCap: value.dailyCallCap });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ variant: "success", title: result.warnings[0] ?? (value.enabled ? "AI phone calls are on for this agent." : "AI phone calls are off for this agent.") });
      router.refresh();
    });
  }

  function save() {
    if (!Number.isInteger(value.dailyCallCap) || value.dailyCallCap < 1 || value.dailyCallCap > AGENT_VOICE_MAX_DAILY_CAP) {
      setError(`Set a daily call limit between 1 and ${AGENT_VOICE_MAX_DAILY_CAP}.`);
      return;
    }
    if (value.enabled && !initial.enabled) setConfirming(true);
    else persist();
  }

  return (
    <div className="space-y-3">
      <AgentVoiceCallsField agentType={agentType} availability={availability} value={value} onChange={setValue} />
      <FormError message={error} />
      {(option.selectable || initial.enabled) && availability.canManage && (
        <Button size="sm" loading={pending} disabled={!changed} onClick={save}>
          Save call settings
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          persist();
        }}
        title="Let this agent phone leads with AI?"
        scope={`On each run the agent asks the AI to phone up to ${value.dailyCallCap} leads a day from your dedicated number. They are real calls and use voice minutes.`}
        consequence="Only leads who gave their number and agreed to be called, within their calling hours. Each lead gets one call per purpose from the agent; retries follow your Voice attempt settings."
        confirmLabel="Switch on AI calls"
      />
    </div>
  );
}
