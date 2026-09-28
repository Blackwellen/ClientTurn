"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import type { VoiceSettingsView } from "@/lib/services/operations/voice";
import type { VoiceSettingsSection } from "@/lib/voice/settings-model";
import { formatDate, formatDateTime } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { FormField, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Stepper } from "@/components/ui/progress";
import { useToast } from "@/components/ui/toast";
import { releaseVoiceNumberAction, requestVoiceNumberAction } from "@/lib/voice/actions";
import { Fact, Notice, PanelCard } from "./voice-shared";

/**
 * The dedicated number: where it is in Twilio's review and set-up, the
 * request, and (owner only) the release behind a typed confirmation.
 */

const STEPS = [
  { label: "Business details", description: "Checked by ClientTurn" },
  { label: "Twilio review", description: "Usually one to three working days" },
  { label: "Setting up", description: "Buying and connecting the number" },
  { label: "Active", description: "Ready to call" },
];

const STEP_INDEX: Record<string, number> = {
  NOT_STARTED: 0,
  DETAILS_NEEDED: 0,
  ACTION_NEEDED: 1,
  IN_REVIEW: 1,
  SETTING_UP: 2,
  ACTIVE: 4,
  RELEASING: 4,
  RELEASED: 0,
};

function eventLabel(event: string, to: string): string {
  const words = (event || to).replace(/[_.]+/g, " ").toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function NumberPanel({ view, onNavigate }: { view: VoiceSettingsView; onNavigate: (p: VoiceSettingsSection) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [requesting, setRequesting] = React.useState(false);
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = React.useState(false);
  const n = view.number;
  const canRequest = view.canEdit && (n.stage === "NOT_STARTED" || n.stage === "RELEASED");
  const canRelease = view.canReleaseNumber && Boolean(n.e164) && n.stage !== "RELEASING" && n.stage !== "RELEASED";

  async function request() {
    setRequesting(true);
    setRequestError(null);
    try {
      const result = await requestVoiceNumberAction();
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        router.refresh();
      } else {
        setRequestError(result.error);
      }
    } catch {
      setRequestError("The request could not be sent. Try again.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <>
      <PanelCard
        title="Your dedicated number"
        description="A UK business number in your company's name. Calls and texts to leads come from it."
        aside={<StatusBadge kind="number_provisioning" value={n.stage} />}
      >
        {n.stage === "NOT_STARTED" || n.stage === "RELEASED" ? (
          <EmptyState
            icon={Phone}
            className="py-8"
            title={n.stage === "RELEASED" ? "Your number was released" : "No number yet"}
            description={
              view.regulatory.ready
                ? "Your business details are ready. Request the number and we will submit them to Twilio for review."
                : "Request the number now; we will ask for any business details Twilio still needs before submitting."
            }
            action={
              canRequest ? (
                <Button size="sm" loading={requesting} onClick={request}>
                  Request number
                </Button>
              ) : !view.canEdit ? (
                <p className="text-[12.5px] text-content-muted">An owner or admin can request the number.</p>
              ) : undefined
            }
          />
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Fact label="Number">{n.e164 ? <span className="tabular-nums">{n.e164}</span> : "Not issued yet"}</Fact>
              <Fact label="Stage">{n.stageLabel}</Fact>
              {n.activatedAt && <Fact label="Active since">{formatDate(n.activatedAt)}</Fact>}
              {n.releaseAfter && <Fact label="Released after">{formatDate(n.releaseAfter)}</Fact>}
            </dl>
            {n.stage !== "RELEASING" && (
              <Stepper steps={STEPS} current={STEP_INDEX[n.stage] ?? 0} className="flex-col sm:flex-row" />
            )}
          </>
        )}

        {requestError && (
          <Notice tone="warning" role="alert">
            {requestError}
          </Notice>
        )}

        {n.stage === "DETAILS_NEEDED" && (
          <Notice tone="warning" role="status">
            Twilio needs your business details before it can review the number.{" "}
            <button type="button" className="font-medium underline underline-offset-2" onClick={() => onNavigate("identity")}>
              Complete business details
            </button>
          </Notice>
        )}
        {n.needsAttention || n.rejectionReason ? (
          <Notice tone="danger" role="alert">
            <span className="font-semibold">Action needed.</span>{" "}
            {n.rejectionReason ? `Twilio's reason: ${n.rejectionReason}` : "Something in the set-up needs your attention."}{" "}
            {view.canEdit && (
              <button type="button" className="font-medium underline underline-offset-2" onClick={() => onNavigate("identity")}>
                Fix your business details
              </button>
            )}
          </Notice>
        ) : null}
        {n.stage === "RELEASING" && (
          <Notice tone="warning" role="status">
            The release is scheduled{n.releaseAfter ? ` for ${formatDate(n.releaseAfter)}` : ""}. The number is then held in quarantine for 90 days so nobody else receives your leads&apos; replies.
          </Notice>
        )}
      </PanelCard>

      <PanelCard title="Timeline" description="Each step of the set-up, newest first.">
        {n.timeline.length === 0 ? (
          <p className="text-[13px] text-content-muted">Nothing has happened yet. Steps appear here once the number is requested.</p>
        ) : (
          <ol className="space-y-2.5">
            {n.timeline.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-[13px]">
                <span className="text-content">{eventLabel(e.event, e.to)}</span>
                <time dateTime={e.at} className="text-[12px] text-content-muted" suppressHydrationWarning>
                  {formatDateTime(e.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </PanelCard>

      {canRelease && (
        <PanelCard title="Release the number" description="For when you stop using voice. This can't be undone.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-content-secondary">
              AI calls stop and texts go from the shared ClientTurn sender. Only the workspace owner can do this.
            </p>
            <Button size="sm" variant="danger" onClick={() => setReleaseOpen(true)}>
              Release number
            </Button>
          </div>
        </PanelCard>
      )}

      {canRelease && n.e164 && <ReleaseDialog open={releaseOpen} onClose={() => setReleaseOpen(false)} e164={n.e164} />}
    </>
  );
}

function ReleaseDialog({ open, onClose, e164 }: { open: boolean; onClose: () => void; e164: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [typed, setTyped] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const matches = typed.replace(/\s+/g, "") === e164.replace(/\s+/g, "");

  async function release() {
    setBusy(true);
    setError(null);
    try {
      const result = await releaseVoiceNumberAction(typed);
      if (result.ok) {
        toast({ variant: "success", title: result.message });
        onClose();
        router.refresh();
      } else {
        setError(result.error);
      }
    } catch {
      setError("The release could not be scheduled. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Release your number?"
      size="sm"
      footer={
        <>
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Keep number
          </Button>
          <Button size="sm" variant="danger" onClick={release} loading={busy} disabled={!matches}>
            Release number
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-content">
          Your dedicated number is released and can&apos;t be got back. AI calls stop, queued calls are cancelled, and texts go from the shared ClientTurn sender.
        </p>
        <p className="text-content-muted">The number is held in quarantine for 90 days so nobody else receives your leads&apos; replies.</p>
        <FormField label={`Type ${e164} to confirm`} htmlFor="voice-release-confirm" error={error ?? undefined}>
          <Input
            id="voice-release-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            inputMode="tel"
            className="tabular-nums"
          />
        </FormField>
      </div>
    </Modal>
  );
}
