"use client";

import * as React from "react";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Label, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { saveOutreachGuidance } from "@/lib/business-profile/actions";
import type { BusinessProfileData } from "@/lib/business-profile/types";

type Guidance = NonNullable<BusinessProfileData["outreachGuidance"]>;

const EMPTY: Guidance = {
  tone: "",
  keyMessages: "",
  valueProposition: "",
  proofPoints: "",
  avoid: "",
  callToAction: "",
  claimRestrictions: "",
  updatedAt: null,
};

/**
 * Outreach guidance (V4 §26.19).
 *
 * This is the customer telling ClientTurn how to represent them — tone, what to
 * lead with, what to prove it with, and crucially what *not* to say. It is
 * authored, never inferred: campaign and message generation reads it, and
 * nothing writes it except the person on this screen.
 *
 * "Avoid" and "Claims we cannot make" matter more than they look. They are how
 * a business stops generated copy from promising something it cannot deliver,
 * which is the failure mode that turns AI-assisted outreach into a liability.
 */
export function OutreachGuidanceEditor({
  guidance,
  canEdit,
}: {
  guidance: Guidance | null;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const initial = React.useMemo<Guidance>(
    () => ({ ...EMPTY, ...(guidance ?? {}) }),
    [guidance],
  );
  const [draft, setDraft] = React.useState<Guidance>(initial);
  const [saving, setSaving] = React.useState(false);

  // Re-seed when the server sends a newer version.
  const signature = JSON.stringify(initial);
  const [seeded, setSeeded] = React.useState(signature);
  if (seeded !== signature) {
    setSeeded(signature);
    setDraft(initial);
  }

  const dirty = JSON.stringify(draft) !== signature;

  function set(key: keyof Guidance, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const result = await saveOutreachGuidance({
        tone: draft.tone,
        keyMessages: draft.keyMessages,
        valueProposition: draft.valueProposition,
        proofPoints: draft.proofPoints,
        avoid: draft.avoid,
        callToAction: draft.callToAction,
        claimRestrictions: draft.claimRestrictions,
      });
      toast(
        result.ok
          ? { variant: "success", title: "Outreach guidance saved" }
          : { variant: "error", title: result.error },
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader className="items-center border-b-0 px-5 pt-5 pb-0">
        <SectionHeader
          icon={Megaphone}
          tone="info"
          title="Outreach guidance"
          description="Set how ClientTurn should represent your business in outreach."
        />
        {guidance?.updatedAt && (
          <p className="shrink-0 text-[11.5px] text-content-subtle">
            Updated{" "}
            {new Intl.DateTimeFormat("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date(guidance.updatedAt))}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-3.5 px-5 pt-4 pb-5">
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field
            id="guidance-tone"
            label="Tone"
            hint="How your messages should sound."
            placeholder="Professional, friendly and helpful"
            value={draft.tone ?? ""}
            disabled={!canEdit}
            onChange={(value) => set("tone", value)}
          />
          <Field
            id="guidance-cta"
            label="Call to action"
            hint="What you want the reader to do next."
            placeholder="Invite to book a site visit or request a quote"
            value={draft.callToAction ?? ""}
            disabled={!canEdit}
            onChange={(value) => set("callToAction", value)}
          />
        </div>

        <AreaField
          id="guidance-value"
          label="Value proposition"
          hint="The one sentence that explains why someone should care."
          placeholder="We reduce roofing costs for property managers and keep sites compliant."
          value={draft.valueProposition ?? ""}
          disabled={!canEdit}
          onChange={(value) => set("valueProposition", value)}
        />

        <AreaField
          id="guidance-messages"
          label="Key messages"
          hint="The points worth making, in your own words."
          placeholder="Highlight experience, reliability and quality workmanship"
          value={draft.keyMessages ?? ""}
          disabled={!canEdit}
          onChange={(value) => set("keyMessages", value)}
        />

        <AreaField
          id="guidance-proof"
          label="Proof points"
          hint="Facts you can actually stand behind if challenged."
          placeholder="20+ years trading, fully insured, 400+ commercial roofs maintained"
          value={draft.proofPoints ?? ""}
          disabled={!canEdit}
          onChange={(value) => set("proofPoints", value)}
        />

        <AreaField
          id="guidance-avoid"
          label="Avoid"
          hint="Anything that should never appear in a message."
          placeholder="Hard selling, unrealistic claims, competitor bashing"
          value={draft.avoid ?? ""}
          disabled={!canEdit}
          onChange={(value) => set("avoid", value)}
        />

        <AreaField
          id="guidance-claims"
          label="Claims we cannot make"
          hint="Guarantees, prices or timescales you are not able to promise. Generated copy will not use these."
          placeholder="No guaranteed timescales, no fixed prices before survey, no warranty claims"
          value={draft.claimRestrictions ?? ""}
          disabled={!canEdit}
          onChange={(value) => set("claimRestrictions", value)}
        />

        {canEdit && (
          <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-3.5">
            <p className="text-[12px] text-content-muted">
              Campaign and message generation reads this. It is never inferred.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!dirty}
                onClick={() => setDraft(initial)}
              >
                Discard
              </Button>
              <Button size="sm" loading={saving} disabled={!dirty} onClick={save}>
                Save guidance
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  id,
  label,
  hint,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={400}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="text-[11.5px] text-content-muted">
        {hint}
      </p>
    </div>
  );
}

function AreaField({
  id,
  label,
  hint,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        rows={2}
        value={value}
        disabled={disabled}
        maxLength={1200}
        placeholder={placeholder}
        aria-describedby={`${id}-hint`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="text-[11.5px] text-content-muted">
        {hint}
      </p>
    </div>
  );
}
