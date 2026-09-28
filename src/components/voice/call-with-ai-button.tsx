"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/modal";
import { Checkbox, FormField, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { requestVoiceCallAction } from "@/lib/voice/actions";

/**
 * "Call with AI" on the lead page. It places a real call, so it always goes
 * through a confirmation dialog (voice.request_call is EXTERNAL). When the
 * workspace or the lead is not eligible the button is disabled and the reason
 * is shown under it; the server re-checks everything and its refusal (plan,
 * policy, calling hours) is shown in the same place.
 */
export function CallWithAiButton({
  leadId,
  leadName,
  disabledReason,
  numberE164,
}: {
  leadId: string;
  leadName: string;
  /** Why a call can't be placed now; null when it can. */
  disabledReason: string | null;
  numberE164: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [requested, setRequested] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [refusal, setRefusal] = React.useState<string | null>(null);
  const [attempted, setAttempted] = React.useState(false);
  const noteId = React.useId();

  const noteInvalid = requested && note.trim().length < 3;

  async function confirm() {
    if (noteInvalid) {
      setAttempted(true);
      return;
    }
    const result = await requestVoiceCallAction({
      leadId,
      recordCallRequest: requested ? { note: note.trim() } : undefined,
    });
    if (result.ok) {
      setOpen(false);
      setRefusal(null);
      setRequested(false);
      setNote("");
      toast({ variant: "success", title: result.message });
      router.refresh();
    } else {
      setOpen(false);
      setRefusal(result.error);
      toast({ variant: "error", title: result.error });
    }
  }

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        fullWidth
        disabled={Boolean(disabledReason)}
        aria-describedby={disabledReason || refusal ? `${noteId}-reason` : undefined}
        onClick={() => {
          setRefusal(null);
          setAttempted(false);
          setOpen(true);
        }}
      >
        <Phone className="size-3.5" aria-hidden />
        Call with AI
      </Button>
      {(disabledReason || refusal) && (
        <p id={`${noteId}-reason`} role={refusal ? "alert" : undefined} className="text-[12px] text-content-muted">
          {refusal ?? disabledReason}
        </p>
      )}

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={confirm}
        title={`Call ${leadName} with AI?`}
        scope={`The AI assistant will phone ${leadName} from your workspace number${numberE164 ? ` (${numberE164})` : ""}. It is a real call and uses voice minutes.`}
        consequence="It says it is an AI calling from your business at the start of the call, and only calls within the lead's calling hours. If it is outside those hours, the call is booked for when they open."
        confirmLabel="Place the call"
      >
        <div className="space-y-2.5">
          <label className="flex items-start gap-2 text-[13px] text-content">
            <Checkbox checked={requested} onChange={(e) => setRequested(e.target.checked)} className="mt-0.5" />
            <span>The lead asked us to call them</span>
          </label>
          {requested && (
            <FormField
              label="How did they ask?"
              htmlFor={noteId}
              hint="Saved as the record of their request, for example: asked for a call back on the enquiry form."
              error={noteInvalid && (attempted || note.length > 0) ? "Add a few words about how they asked." : undefined}
            >
              <Textarea id={noteId} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} rows={2} />
            </FormField>
          )}
        </div>
      </ConfirmDialog>
    </div>
  );
}
