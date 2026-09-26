"use client";

import * as React from "react";
import { Megaphone, Plus, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { FormField, Textarea } from "@/components/ui/form";
import { SectionHeader } from "@/components/app/page-header";
import {
  BRAND_FIELD_MAX,
  MAX_EXAMPLES,
  MAX_EXAMPLE_CHARS,
  brandVoiceSchema,
  phrasesFromText,
  sellingPreferencesSchema,
  type BrandVoice,
  type SellingPreferences,
} from "@/lib/settings/ai-selling";
import { saveSalesSettingsAction } from "@/lib/settings/ai-selling-actions";
import { useSettingsSave } from "./use-settings-save";

type TextKey = Exclude<keyof BrandVoice, "forbiddenPhrases">;

const FIELDS: { key: TextKey; label: string; hint: string; rows: number }[] = [
  { key: "tone", label: "Tone of voice", hint: "How messages should sound, e.g. plain-spoken and warm, never pushy.", rows: 2 },
  { key: "valueProposition", label: "Value proposition", hint: "What you do for customers, in a sentence or two.", rows: 3 },
  { key: "keyMessages", label: "Key messages", hint: "One per line. Things worth saying when they are relevant.", rows: 3 },
  { key: "proofPoints", label: "Proof points", hint: "One per line. Only claims you can stand behind.", rows: 3 },
  { key: "callToAction", label: "Preferred call to action", hint: "What a good next step looks like, e.g. a 20-minute call.", rows: 2 },
  { key: "claimRestrictions", label: "Claim restrictions", hint: "One per line. Things never to claim or promise.", rows: 3 },
];

/**
 * Brand: the voice fields the offer card reads (`business_profiles.outreach_*`,
 * lib/agent/offer-card.ts), the phrases never to use (checked on every
 * message), and example messages that show the difference between good and
 * bad for this business.
 */
export function BrandCard({
  brand,
  preferences,
  canManage,
}: {
  brand: BrandVoice;
  preferences: SellingPreferences;
  canManage: boolean;
}) {
  const [values, setValues] = React.useState<Record<TextKey, string>>({
    tone: brand.tone,
    valueProposition: brand.valueProposition,
    keyMessages: brand.keyMessages,
    proofPoints: brand.proofPoints,
    callToAction: brand.callToAction,
    claimRestrictions: brand.claimRestrictions,
  });
  const [phrases, setPhrases] = React.useState(brand.forbiddenPhrases.join("\n"));
  const [good, setGood] = React.useState<string[]>(preferences.goodExamples);
  const [bad, setBad] = React.useState<string[]>(preferences.badExamples);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { save, saving } = useSettingsSave();
  const locked = !canManage;

  async function onSave() {
    const brandInput = { ...values, forbiddenPhrases: phrasesFromText(phrases) };
    const examples = {
      goodExamples: good.map((text) => text.trim()).filter(Boolean),
      badExamples: bad.map((text) => text.trim()).filter(Boolean),
    };
    const next: Record<string, string> = {};
    const parsedBrand = brandVoiceSchema.safeParse(brandInput);
    if (!parsedBrand.success) {
      for (const issue of parsedBrand.error.issues) next[String(issue.path[0])] ??= issue.message;
    }
    const parsedExamples = sellingPreferencesSchema.pick({ goodExamples: true, badExamples: true }).safeParse(examples);
    if (!parsedExamples.success) {
      for (const issue of parsedExamples.error.issues) next[String(issue.path[0])] ??= issue.message;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    await save(() => saveSalesSettingsAction({ brand: brandInput, preferences: examples }));
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={Megaphone}
          title="Brand"
          description="How your business sounds. The assistant writes within these, and a draft that uses a forbidden phrase is rejected and rewritten before anything is sent."
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          {FIELDS.map((field) => (
            <FormField
              key={field.key}
              label={field.label}
              htmlFor={`brand-${field.key}`}
              hint={field.hint}
              error={errors[field.key]}
            >
              <Textarea
                id={`brand-${field.key}`}
                rows={field.rows}
                maxLength={BRAND_FIELD_MAX}
                disabled={locked}
                value={values[field.key]}
                onChange={(event) => {
                  const value = event.target.value;
                  setValues((current) => ({ ...current, [field.key]: value }));
                }}
              />
            </FormField>
          ))}
        </div>

        <FormField
          label="Forbidden phrases"
          htmlFor="brand-forbidden"
          hint="One per line, 3 to 60 characters each. Checked on every draft the assistant writes."
          error={errors.forbiddenPhrases}
        >
          <Textarea
            id="brand-forbidden"
            rows={4}
            disabled={locked}
            value={phrases}
            onChange={(event) => setPhrases(event.target.value)}
          />
        </FormField>

        <div className="grid gap-4 md:grid-cols-2">
          <ExampleList
            title="Good example messages"
            hint="Messages that sound like you. The assistant sees them as tone examples only, never as facts to repeat."
            items={good}
            onChange={setGood}
            locked={locked}
            error={errors.goodExamples}
          />
          <ExampleList
            title="Bad example messages"
            hint="Messages that do not sound like you. Shown to the assistant as what not to write; the first to be left out if space runs short."
            items={bad}
            onChange={setBad}
            locked={locked}
            error={errors.badExamples}
          />
        </div>
      </CardContent>
      {canManage && (
        <CardFooter className="justify-end">
          <Button size="sm" loading={saving} onClick={onSave}>
            Save brand
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function ExampleList({
  title,
  hint,
  items,
  onChange,
  locked,
  error,
}: {
  title: string;
  hint: string;
  items: string[];
  onChange: (items: string[]) => void;
  locked: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[13px] font-medium text-content">{title}</p>
        <p className="text-[12px] text-content-muted">{hint}</p>
      </div>
      {items.length === 0 && <p className="text-[12.5px] text-content-subtle">None yet.</p>}
      {items.map((item, index) => (
        <div key={index} className="flex items-start gap-2">
          <Textarea
            aria-label={`${title} ${index + 1}`}
            rows={3}
            maxLength={MAX_EXAMPLE_CHARS}
            disabled={locked}
            value={item}
            onChange={(event) => onChange(items.map((current, i) => (i === index ? event.target.value : current)))}
          />
          {!locked && (
            <IconButton
              label={`Remove example ${index + 1}`}
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              <X className="size-3.5" />
            </IconButton>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-[12px] text-danger-600">
          {error}
        </p>
      )}
      {!locked && items.length < MAX_EXAMPLES && (
        <Button variant="ghost" size="sm" onClick={() => onChange([...items, ""])}>
          <Plus className="size-3.5" />
          Add example
        </Button>
      )}
    </div>
  );
}
