"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { recordWhatsAppOptInAction } from "@/lib/leads/detail-actions";
import {
  isoDate,
  MAX_OPT_IN_DETAIL,
  optInProblem,
  WHATSAPP_OPT_IN_SOURCE_LABELS,
  WHATSAPP_OPT_IN_SOURCES,
  type WhatsAppOptInSource,
} from "@/lib/leads/whatsapp-opt-in";

/**
 * The WhatsApp opt-in line under Contactability. Recording one runs
 * `lead.record_whatsapp_opt_in`, which is audited with the date and source.
 */
export function WhatsAppOptInControl({
  leadId,
  optedIn,
  optedInOn,
  source,
  canWrite,
}: {
  leadId: string;
  optedIn: boolean;
  optedInOn: string | null;
  source: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(() => isoDate(new Date()));
  const [how, setHow] = React.useState<WhatsAppOptInSource>("LEAD_FORM");
  const [detail, setDetail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const problem = optInProblem({ optedInOn: date, source: how, detail });
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    const result = await recordWhatsAppOptInAction({
      leadId,
      optedInOn: date,
      source: how,
      detail: detail.trim() || undefined,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    toast({ variant: "success", title: result.message ?? "WhatsApp opt-in recorded." });
    router.refresh();
  }

  const label = source && source in WHATSAPP_OPT_IN_SOURCE_LABELS
    ? WHATSAPP_OPT_IN_SOURCE_LABELS[source as WhatsAppOptInSource].toLowerCase()
    : null;

  return (
    <div className="mt-2 border-t border-line-subtle pt-2">
      <p className="text-[12px] leading-snug text-content-muted">
        {optedIn
          ? optedInOn
            ? `Opted in to WhatsApp on ${optedInOn}${label ? ` (${label})` : ""}.`
            : "Opted in to WhatsApp."
          : "No WhatsApp opt-in on record. Outside a 24-hour reply window, WhatsApp needs one."}
      </p>
      {canWrite && !optedIn && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => setOpen(true)}>
          Record WhatsApp opt-in
        </Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Record WhatsApp opt-in"
        description="Only record this if the person agreed to be messaged on WhatsApp at this mobile number. It is kept in the audit trail with the date and how they agreed."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" type="submit" form="whatsapp-opt-in-form" loading={saving}>
              Record opt-in
            </Button>
          </>
        }
      >
        <form id="whatsapp-opt-in-form" onSubmit={save} className="space-y-4">
          <FormField label="Date they opted in" htmlFor="optin-date" required>
            <Input
              id="optin-date"
              type="date"
              required
              max={isoDate(new Date())}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          <FormField label="How they opted in" htmlFor="optin-source" required>
            <Select
              id="optin-source"
              value={how}
              onChange={(event) => setHow(event.target.value as WhatsAppOptInSource)}
            >
              {WHATSAPP_OPT_IN_SOURCES.map((value) => (
                <option key={value} value={value}>
                  {WHATSAPP_OPT_IN_SOURCE_LABELS[value]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            label="Detail"
            htmlFor="optin-detail"
            required={how === "OTHER"}
            hint="Optional unless you chose Other, e.g. which form, or who took the call."
            error={error ?? undefined}
          >
            <Textarea
              id="optin-detail"
              rows={2}
              maxLength={MAX_OPT_IN_DETAIL}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
            />
          </FormField>
        </form>
      </Modal>
    </div>
  );
}
