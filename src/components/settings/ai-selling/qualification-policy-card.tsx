"use client";

import * as React from "react";
import Link from "next/link";
import { ListChecks, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Checkbox, FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { PlanLimitState, FormError } from "@/components/ui/feedback";
import { SectionHeader } from "@/components/app/page-header";
import { MOTIONS } from "@/lib/sales-library/motions";
import { SALES_MOTIONS } from "@/lib/sales-library/types";
import {
  DISQUALIFIER_OPS,
  DISQUALIFIER_OP_COPY,
  ESCALATION_CONDITION_COPY,
  POLICY_AUTONOMY_COPY,
  describeDisqualifier,
  disqualifierFromDraft,
  draftFromDisqualifier,
  type DisqualifierDraft,
  type DisqualifierOp,
} from "@/lib/settings/ai-selling";
import { saveQualificationPolicyAction } from "@/lib/settings/ai-selling-actions";
import type { QualificationPolicyView } from "@/lib/settings/ai-selling-queries";
import {
  ENGINE_MODE_COPY,
  INTENT_STATE_COPY,
  dimensionLabel,
  goalLabel,
} from "@/lib/qualification-intelligence/explain";
import {
  ESCALATION_CONDITIONS,
  GOAL_KEYS,
  INTENT_STATES,
  LIBRARY_INTENT_KEY_PATTERN,
  POLICY_AUTONOMY_LEVELS,
  QI_DIMENSION_KEYS,
  QI_ENGINE_MODES,
  WORKSPACE_POLICY_KEY,
  defaultEngineMode,
  qualificationPolicySchema,
  servicePolicyKey,
  type EscalationCondition,
  type OfferDisqualifier,
  type OfferProfile,
  type QiDimensionKey,
  type QualificationPolicy,
} from "@/lib/qualification-intelligence/types";
import { useSettingsSave } from "./use-settings-save";

/**
 * Settings -> AI & selling -> Qualification policy (design §B.18, brief §20).
 *
 * One form per scope: the whole workspace, or one offer (service). Saved as the
 * QUALIFICATION_POLICY override through `qualification.policy_update`, which
 * validates, checks the subscription and audits the before and after. From
 * here the policy may be widened as well as narrowed; Copilot and connected
 * assistants may only narrow it.
 *
 * Depth, preferred methods and AI budgets already live in their own cards and
 * are linked, not repeated. The engine mode is shown to owners and admins only.
 */

const THRESHOLDS = [
  { key: "booking", label: "Offer a meeting when", help: "Booking is offered once intent and completeness reach this." },
  { key: "directSale", label: "Offer checkout or sign-up when", help: "A direct close is offered once these are reached." },
  { key: "handoff", label: "Hand to a person when", help: "A person takes over once these are reached." },
] as const;
type ThresholdKey = (typeof THRESHOLDS)[number]["key"];

type Draft = {
  engineMode: string;
  goal: string;
  motion: string;
  archetypeKey: string;
  requiredDimensions: QiDimensionKey[];
  disqualifiers: DisqualifierDraft[];
  /** Stored disqualifiers the form cannot edit (compound rules); kept as they are. */
  lockedDisqualifiers: OfferDisqualifier[];
  thresholds: Record<ThresholdKey, { state: string; completeness: string }>;
  escalationConditions: EscalationCondition[];
  humanCloserAboveValue: string;
  maxAutonomy: string;
  forbidden: string;
  custom: string;
};

function toDraft(policy: QualificationPolicy): Draft {
  const editable: DisqualifierDraft[] = [];
  const locked: OfferDisqualifier[] = [];
  for (const d of policy.disqualifiers ?? []) {
    const draft = draftFromDisqualifier(d);
    if (draft) editable.push(draft);
    else locked.push(d);
  }
  const threshold = (key: ThresholdKey) => ({
    state: policy.thresholds?.[key]?.minIntentState ?? "",
    completeness:
      policy.thresholds?.[key]?.minCompleteness === undefined ? "" : String(Math.round((policy.thresholds[key]!.minCompleteness ?? 0) * 100)),
  });
  return {
    engineMode: policy.engineMode ?? "",
    goal: policy.goal ?? "",
    motion: policy.motion ?? "",
    archetypeKey: policy.archetypeKey ?? "",
    requiredDimensions: [...(policy.requiredDimensions ?? [])],
    disqualifiers: editable,
    lockedDisqualifiers: locked,
    thresholds: { booking: threshold("booking"), directSale: threshold("directSale"), handoff: threshold("handoff") },
    escalationConditions: [...(policy.escalationConditions ?? [])],
    humanCloserAboveValue: policy.humanCloserAboveValue === undefined ? "" : String(policy.humanCloserAboveValue),
    maxAutonomy: policy.maxAutonomy ?? "",
    forbidden: (policy.forbiddenQuestionIntents ?? []).join("\n"),
    custom: (policy.customQuestionIntents ?? []).join("\n"),
  };
}

function lines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((l) => l.trim().toUpperCase()).filter(Boolean))];
}

/** The draft as the contract's policy, or the first problem with it. */
function toPolicy(
  draft: Draft,
  scope: string,
  engineModeVisible: boolean,
  knownKeys: ReadonlySet<string>,
): { ok: true; policy: QualificationPolicy } | { ok: false; error: string } {
  const policy: QualificationPolicy = {};
  if (scope === WORKSPACE_POLICY_KEY && engineModeVisible && draft.engineMode) {
    policy.engineMode = draft.engineMode as QualificationPolicy["engineMode"];
  }
  if (draft.goal) policy.goal = draft.goal as QualificationPolicy["goal"];
  if (draft.motion) policy.motion = draft.motion as QualificationPolicy["motion"];
  if (draft.archetypeKey) policy.archetypeKey = draft.archetypeKey;
  if (draft.requiredDimensions.length) policy.requiredDimensions = draft.requiredDimensions;
  const disqualifiers: OfferDisqualifier[] = [...draft.lockedDisqualifiers];
  for (const [index, d] of draft.disqualifiers.entries()) {
    if (d.reason.trim().length < 3) return { ok: false, error: `Disqualifier ${index + 1}: say why it disqualifies.` };
    const built = disqualifierFromDraft(d);
    if (typeof built === "string") return { ok: false, error: `Disqualifier ${index + 1}: ${built}` };
    disqualifiers.push(built);
  }
  if (disqualifiers.length) policy.disqualifiers = disqualifiers;
  const thresholds: NonNullable<QualificationPolicy["thresholds"]> = {};
  for (const { key, label } of THRESHOLDS) {
    const t = draft.thresholds[key];
    const entry: { minIntentState?: (typeof INTENT_STATES)[number]; minCompleteness?: number } = {};
    if (t.state) entry.minIntentState = t.state as (typeof INTENT_STATES)[number];
    if (t.completeness.trim()) {
      const n = Number(t.completeness);
      if (!Number.isFinite(n) || n < 0 || n > 100) return { ok: false, error: `${label}: completeness is a percentage from 0 to 100.` };
      entry.minCompleteness = Math.round(n) / 100;
    }
    if (Object.keys(entry).length) thresholds[key] = entry;
  }
  if (Object.keys(thresholds).length) policy.thresholds = thresholds;
  if (draft.escalationConditions.length) policy.escalationConditions = draft.escalationConditions;
  if (draft.humanCloserAboveValue.trim()) {
    const n = Number(draft.humanCloserAboveValue.replace(/[£,]/g, ""));
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: "The human-closer value is an amount in pounds." };
    policy.humanCloserAboveValue = n;
  }
  if (draft.maxAutonomy) policy.maxAutonomy = draft.maxAutonomy as QualificationPolicy["maxAutonomy"];
  for (const [field, text, label] of [
    ["forbiddenQuestionIntents", draft.forbidden, "Forbidden questions"],
    ["customQuestionIntents", draft.custom, "Custom questions"],
  ] as const) {
    const keys = lines(text);
    const bad = keys.find((k) => !LIBRARY_INTENT_KEY_PATTERN.test(k));
    if (bad) return { ok: false, error: `${label}: "${bad}" is not a question key (like BUDGET.RANGE).` };
    const unknown = knownKeys.size > 0 ? keys.find((k) => !knownKeys.has(k)) : undefined;
    if (unknown) return { ok: false, error: `${label}: "${unknown}" is not in the question library.` };
    if (keys.length) policy[field] = keys;
  }
  const parsed = qualificationPolicySchema.safeParse(policy);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the policy." };
  return { ok: true, policy: parsed.data };
}

function OfferProfileSummary({ profile, valid }: { profile: OfferProfile; valid: boolean }) {
  const facts = [
    profile.pricingModel && `Pricing: ${profile.pricingModel.toLowerCase().replace(/_/g, " ")}`,
    profile.customerType && `Sells to ${profile.customerType === "BOTH" ? "businesses and consumers" : profile.customerType === "B2B" ? "businesses" : "consumers"}`,
    profile.goal && `Goal: ${goalLabel(profile.goal)}`,
    profile.motion && `Motion: ${MOTIONS[profile.motion]?.name ?? profile.motion}`,
    profile.requiredDimensions?.length && `Requires ${profile.requiredDimensions.map(dimensionLabel).join(", ").toLowerCase()}`,
    profile.disqualifiers?.length && `${profile.disqualifiers.length} disqualifier${profile.disqualifiers.length === 1 ? "" : "s"}`,
  ].filter(Boolean) as string[];
  return (
    <div className="rounded-lg border border-line-subtle bg-surface-sunken/50 px-3 py-2.5 text-[12.5px]">
      <p className="font-medium text-content">Offer profile</p>
      {!valid ? (
        <p className="mt-0.5 text-warning-700">
          This offer&apos;s profile could not be read, so the library defaults for your business type apply to it.
        </p>
      ) : facts.length === 0 ? (
        <p className="mt-0.5 text-content-muted">No offer-specific profile yet: the library defaults for your business type apply.</p>
      ) : (
        <p className="mt-0.5 text-content-secondary">{facts.join(" · ")}</p>
      )}
      <p className="mt-1 text-content-subtle">The rules below apply on top of the offer profile for leads about this offer.</p>
    </div>
  );
}

export function QualificationPolicyCard({
  view,
  canManage,
  subscriptionActive,
  agentMode,
}: {
  view: QualificationPolicyView;
  canManage: boolean;
  subscriptionActive: boolean;
  agentMode: string | null;
}) {
  const initial = React.useMemo(() => {
    const map: Record<string, Draft> = { [WORKSPACE_POLICY_KEY]: toDraft(view.workspace) };
    for (const offer of view.offers) map[servicePolicyKey(offer.id)] = toDraft(offer.policy);
    return map;
  }, [view]);
  const [scope, setScope] = React.useState<string>(WORKSPACE_POLICY_KEY);
  const [drafts, setDrafts] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const { save, saving } = useSettingsSave();
  const draft = drafts[scope] ?? toDraft({});
  const offer = scope === WORKSPACE_POLICY_KEY ? null : view.offers.find((o) => servicePolicyKey(o.id) === scope) ?? null;
  const engineVisible = view.engineMode !== null;
  const locked = !canManage || saving || !subscriptionActive;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial[scope] ?? toDraft({}));
  const id = (name: string) => `qp-${name}`;

  const patch = (next: Partial<Draft>) => {
    setError(null);
    setDrafts((all) => ({ ...all, [scope]: { ...draft, ...next } }));
  };
  const toggleIn = <T extends string>(list: T[], value: T) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const submit = async () => {
    const built = toPolicy(draft, scope, engineVisible, new Set(view.intentOptions.map((o) => o.key)));
    if (!built.ok) {
      setError(built.error);
      return;
    }
    await save(() => saveQualificationPolicyAction({ scope, policy: built.policy, mode: "replace" }));
  };

  const inherit = scope === WORKSPACE_POLICY_KEY ? "Library default" : "Same as the workspace";
  const intentGroups = React.useMemo(() => {
    const groups = new Map<string, QualificationPolicyView["intentOptions"]>();
    for (const option of view.intentOptions) groups.set(option.dimension, [...(groups.get(option.dimension) ?? []), option]);
    return [...groups.entries()];
  }, [view.intentOptions]);

  return (
    <Card id="qualification-policy">
      <CardHeader>
        <SectionHeader
          icon={ListChecks}
          title="Qualification policy"
          description="What the assistant must know before each next step, what it must never ask, and when a person takes over. Set it for the whole workspace, then tighten it per offer."
        />
        {view.engineMode && <StatusBadge kind="engine_mode" value={view.engineMode.mode} />}
      </CardHeader>

      <CardContent className="space-y-5">
        {!subscriptionActive && (
          <PlanLimitState
            title="Subscription inactive"
            description="The policy is shown as saved, but it cannot be changed while the subscription is inactive."
            action={
              <Link href="/app/settings?section=billing" className="text-[13px] font-medium text-content-accent">
                Review billing
              </Link>
            }
          />
        )}
        {view.invalidScopes.length > 0 && (
          <p className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-[12.5px] text-warning-700">
            {view.invalidScopes.length === 1 ? "One saved policy" : `${view.invalidScopes.length} saved policies`} could not be read, so
            the defaults apply there. Saving again replaces it.
          </p>
        )}

        <FormField label="Applies to" htmlFor={id("scope")} hint="Offer rules are added to the workspace policy for leads about that offer.">
          <Select id={id("scope")} value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value={WORKSPACE_POLICY_KEY}>The whole workspace</option>
            {view.offers.map((o) => (
              <option key={o.id} value={servicePolicyKey(o.id)}>
                {o.name}
                {o.active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </FormField>

        {offer && <OfferProfileSummary profile={offer.offerProfile} valid={offer.offerProfileValid} />}

        {scope === WORKSPACE_POLICY_KEY && view.engineMode && (
          <fieldset className="space-y-2 rounded-lg border border-line p-3">
            <legend className="px-1 text-[13px] font-medium text-content">Engine mode</legend>
            <p className="text-[12.5px] text-content-muted">
              Only owners and admins see this. Without a choice, the workspace runs{" "}
              {ENGINE_MODE_COPY[defaultEngineMode()].label.toLowerCase()}.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["", ...QI_ENGINE_MODES] as const).map((mode) => (
                <label
                  key={mode || "default"}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-line-subtle px-2.5 py-2 text-[12.5px] has-[:checked]:border-accent-300 has-[:checked]:bg-accent-50"
                >
                  <input
                    type="radio"
                    name={id("engine-mode")}
                    className="mt-0.5 accent-[var(--lr-accent-600)]"
                    checked={draft.engineMode === mode}
                    disabled={locked}
                    onChange={() => patch({ engineMode: mode })}
                  />
                  <span>
                    <span className="block font-medium text-content">{mode ? ENGINE_MODE_COPY[mode].label : "Default"}</span>
                    <span className="text-content-muted">
                      {mode ? ENGINE_MODE_COPY[mode].description : "Follows the release: shadow until the release checks pass, then live."}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <FormField label="Sales goal" htmlFor={id("goal")} hint="What a qualified lead is moved toward.">
            <Select id={id("goal")} value={draft.goal} disabled={locked} onChange={(event) => patch({ goal: event.target.value })}>
              <option value="">{inherit}</option>
              {GOAL_KEYS.map((goal) => (
                <option key={goal} value={goal}>
                  {goalLabel(goal)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Framework" htmlFor={id("motion")} hint="The sales motion this scope follows.">
            <Select id={id("motion")} value={draft.motion} disabled={locked} onChange={(event) => patch({ motion: event.target.value })}>
              <option value="">{inherit}</option>
              {SALES_MOTIONS.map((motion) => (
                <option key={motion} value={motion}>
                  {MOTIONS[motion].name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Industry profile" htmlFor={id("archetype")} hint="Override the business type's question plan.">
            <Select
              id={id("archetype")}
              value={draft.archetypeKey}
              disabled={locked}
              onChange={(event) => patch({ archetypeKey: event.target.value })}
            >
              <option value="">{scope === WORKSPACE_POLICY_KEY ? "Your business type" : "Same as the workspace"}</option>
              {view.archetypes.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <p className="text-[12.5px] text-content-muted">
          How many questions are asked (depth) is set in Sales behaviour, and how much AI may spend in{" "}
          <Link href="/app/settings?section=ai-selling" className="font-medium text-content-accent underline-offset-4 hover:underline">
            AI budget
          </Link>
          . Both apply here too.
        </p>

        <fieldset>
          <legend className="text-[13px] font-medium text-content">Required before the next step</legend>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            These must be known (confirmed, or inferred and not material) before booking, checkout or a hand-over.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {QI_DIMENSION_KEYS.map((dimension) => {
              const on = draft.requiredDimensions.includes(dimension);
              return (
                <label
                  key={dimension}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] ${
                    on ? "border-accent-300 bg-accent-50 text-content" : "border-line text-content-secondary"
                  }`}
                >
                  <Checkbox
                    checked={on}
                    disabled={locked}
                    onChange={() => patch({ requiredDimensions: toggleIn(draft.requiredDimensions, dimension) })}
                  />
                  {dimensionLabel(dimension)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-medium text-content">Disqualification criteria</legend>
          <p className="mt-0.5 text-[12.5px] text-content-muted">
            A lead is disqualified only on a confirmed answer. An inferred match goes to a person to review.
          </p>
          <div className="mt-2 space-y-2">
            {draft.lockedDisqualifiers.map((d, index) => (
              <p key={`locked-${index}`} className="rounded-md border border-line-subtle px-3 py-2 text-[12.5px] text-content-secondary">
                {describeDisqualifier(d, dimensionLabel)} <Badge dense>Kept as saved</Badge>
              </p>
            ))}
            {draft.disqualifiers.map((d, index) => {
              const set = (next: Partial<DisqualifierDraft>) =>
                patch({ disqualifiers: draft.disqualifiers.map((row, i) => (i === index ? { ...row, ...next } : row)) });
              return (
                <div key={index} className="grid gap-2 rounded-lg border border-line p-2.5 md:grid-cols-[10rem_8rem_minmax(0,1fr)_auto]">
                  <Select aria-label="Detail" value={d.dimension} disabled={locked} onChange={(e) => set({ dimension: e.target.value as QiDimensionKey })}>
                    {QI_DIMENSION_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {dimensionLabel(key)}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label="Condition" value={d.op} disabled={locked} onChange={(e) => set({ op: e.target.value as DisqualifierOp })}>
                    {DISQUALIFIER_OPS.map((op) => (
                      <option key={op} value={op}>
                        {DISQUALIFIER_OP_COPY[op]}
                      </option>
                    ))}
                  </Select>
                  <Input aria-label="Value" value={d.value} disabled={locked} placeholder={d.op === "in" ? "a, b, c" : "Value"} onChange={(e) => set({ value: e.target.value })} />
                  <IconButton
                    label={`Remove disqualifier ${index + 1}`}
                    variant="ghost"
                    size="sm"
                    disabled={locked}
                    onClick={() => patch({ disqualifiers: draft.disqualifiers.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="size-4" />
                  </IconButton>
                  <Input
                    aria-label="Reason"
                    className="md:col-span-3"
                    value={d.reason}
                    disabled={locked}
                    maxLength={200}
                    placeholder="Why this disqualifies, e.g. We only work with companies of 10 or more"
                    onChange={(e) => set({ reason: e.target.value })}
                  />
                  <div className="flex flex-wrap items-center gap-4 md:col-span-4">
                    <span className="flex items-center gap-2 text-[12.5px] text-content-secondary">
                      <Switch checked={d.reviewInstead} disabled={locked} onCheckedChange={(v) => set({ reviewInstead: v })} label="Send for review instead" />
                      Send for review instead of disqualifying
                    </span>
                    <span className="flex items-center gap-2 text-[12.5px] text-content-secondary">
                      <Switch checked={d.suppress} disabled={locked || d.reviewInstead} onCheckedChange={(v) => set({ suppress: v })} label="Also stop contact" />
                      Also stop contact
                    </span>
                  </div>
                </div>
              );
            })}
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                disabled={locked || draft.disqualifiers.length + draft.lockedDisqualifiers.length >= 20}
                onClick={() =>
                  patch({
                    disqualifiers: [
                      ...draft.disqualifiers,
                      { dimension: "COMPANY_SIZE", op: "lt", value: "", reason: "", reviewInstead: true, suppress: false },
                    ],
                  })
                }
              >
                <Plus className="size-3.5" aria-hidden />
                Add a disqualifier
              </Button>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-[13px] font-medium text-content">Thresholds</legend>
          <div className="mt-2 grid gap-3 md:grid-cols-3">
            {THRESHOLDS.map(({ key, label, help }) => (
              <div key={key} className="space-y-2 rounded-lg border border-line p-3">
                <p className="text-[12.5px] font-medium text-content">{label}</p>
                <Select
                  aria-label={`${label}: minimum intent`}
                  value={draft.thresholds[key].state}
                  disabled={locked}
                  onChange={(e) => patch({ thresholds: { ...draft.thresholds, [key]: { ...draft.thresholds[key], state: e.target.value } } })}
                >
                  <option value="">Any intent (default)</option>
                  {INTENT_STATES.filter((s) => s !== "NEGATIVE" && s !== "NOT_NOW").map((s) => (
                    <option key={s} value={s}>
                      Intent at least: {INTENT_STATE_COPY[s].label.toLowerCase()}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`${label}: minimum completeness percent`}
                    inputMode="numeric"
                    className="w-20"
                    value={draft.thresholds[key].completeness}
                    disabled={locked}
                    placeholder="—"
                    onChange={(e) => patch({ thresholds: { ...draft.thresholds, [key]: { ...draft.thresholds[key], completeness: e.target.value } } })}
                  />
                  <span className="text-[12px] text-content-muted">% of required details known</span>
                </div>
                <p className="text-[11.5px] text-content-subtle">{help}</p>
              </div>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label="Autonomy"
            htmlFor={id("autonomy")}
            hint={`The assistant's mode is ${agentMode ? agentMode.toLowerCase().replace(/_/g, " ") : "set in Workspace, AI assistant"}. The policy can only lower it here, never raise it.`}
          >
            <Select id={id("autonomy")} value={draft.maxAutonomy} disabled={locked} onChange={(e) => patch({ maxAutonomy: e.target.value })}>
              <option value="">No cap (the assistant&apos;s own mode)</option>
              {POLICY_AUTONOMY_LEVELS.map((level) => (
                <option key={level} value={level}>
                  At most: {POLICY_AUTONOMY_COPY[level]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Hand to a closer above" htmlFor={id("closer")} hint="Deals worth more than this (in pounds) go to a person to close.">
            <Input
              id={id("closer")}
              inputMode="decimal"
              value={draft.humanCloserAboveValue}
              disabled={locked}
              placeholder="No limit"
              onChange={(e) => patch({ humanCloserAboveValue: e.target.value })}
            />
          </FormField>
        </div>

        <fieldset>
          <legend className="text-[13px] font-medium text-content">Escalate to a person when</legend>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {ESCALATION_CONDITIONS.map((condition) => (
              <label key={condition} className="flex cursor-pointer items-start gap-2 text-[12.5px] text-content-secondary">
                <Checkbox
                  className="mt-0.5"
                  checked={draft.escalationConditions.includes(condition)}
                  disabled={locked}
                  onChange={() => patch({ escalationConditions: toggleIn(draft.escalationConditions, condition) })}
                />
                {ESCALATION_CONDITION_COPY[condition]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          {(
            [
              ["forbidden", "Never ask", "The assistant will not ask these, even when they would be useful."],
              ["custom", "Also ask", "Library questions this scope should consider."],
            ] as const
          ).map(([field, label, hint]) => (
            <FormField key={field} label={label} htmlFor={id(field)} hint={`One question key per line. ${hint}`}>
              <Textarea
                id={id(field)}
                rows={3}
                value={draft[field]}
                disabled={locked}
                className="font-mono text-[12.5px]"
                onChange={(e) => patch({ [field]: e.target.value })}
              />
              <Select
                aria-label={`${label}: add a question from the library`}
                value=""
                disabled={locked || view.intentOptions.length === 0}
                onChange={(e) => {
                  const key = e.target.value;
                  if (!key || lines(draft[field]).includes(key)) return;
                  patch({ [field]: [...lines(draft[field]), key].join("\n") });
                }}
              >
                <option value="">Add a question from the library</option>
                {intentGroups.map(([dimension, options]) => (
                  <optgroup key={dimension} label={dimensionLabel(dimension)}>
                    {options.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.key}: {o.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </FormField>
          ))}
        </div>
        <p className="text-[12.5px] text-content-muted">
          Your own questions, and which detail each one answers, are edited in{" "}
          <Link href="/app/follow-up?view=qualification" className="font-medium text-content-accent underline-offset-4 hover:underline">
            Follow-Up, Qualification
          </Link>
          .
        </p>

        <FormError message={error} />
        {!canManage && (
          <p className="text-[12.5px] text-content-muted">Only an owner or admin can change the qualification policy.</p>
        )}
      </CardContent>

      {canManage && (
        <CardFooter className="justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={locked || !dirty}
            onClick={() => setDrafts((all) => ({ ...all, [scope]: initial[scope] ?? toDraft({}) }))}
          >
            Discard changes
          </Button>
          <Button size="sm" disabled={locked || !dirty} loading={saving} onClick={submit}>
            Save policy
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
