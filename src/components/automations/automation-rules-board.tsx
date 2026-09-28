"use client";

import * as React from "react";
import { ChevronDown, Pencil, Plus, Trash2, Workflow, Zap } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState, FormError } from "@/components/ui/feedback";
import { ConfirmDialog, Modal } from "@/components/ui/modal";
import { Checkbox, Input, Label, Select, Switch, Textarea } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { cn } from "@/lib/cn";
import {
  ACTION_GROUPS,
  ACTION_META,
  ACTION_TYPES,
  DEFAULT_BOOKING_MESSAGE,
  FREQUENCY_LABEL,
  LEAD_STATUSES_FOR_CONDITIONS,
  MAX_RULE_ACTIONS,
  RULE_FREQUENCIES,
  STAGE_ACTION_SEMANTICS,
  TRIGGER_GROUPS,
  actionFitsTrigger,
  contactsCustomer,
  describeRule,
  ruleInputSchema,
  triggerMeta,
  type ActionType,
  type RuleAction,
  type RuleFrequency,
} from "@/lib/automation/rules";
import { SEMANTIC_META } from "@/lib/opportunities/pipeline-semantics";
import { AI_PERMISSION_LABEL, type AiPermission } from "@/lib/commercial/ai-permissions";
import {
  deleteAutomationRule,
  saveAutomationRule,
  setAutomationRuleEnabled,
} from "@/lib/automation/rule-actions";
import type { RuleView } from "@/lib/services/operations/automation";

export type BuilderContext = {
  catalogueItems: { id: string; name: string }[];
  campaigns: { id: string; name: string; status: string }[];
  checkoutLinks: { id: string; label: string }[];
  aiPermissions: Record<AiPermission, boolean>;
  capabilities: Record<string, boolean>;
};

const CAPABILITY_NOTE: Record<string, string> = {
  voice_enabled: "AI calling is off for this workspace.",
  quote_builder_enabled: "Quotes are not on your plan.",
  quote_approval_enabled: "Approvals are not on your plan.",
  esign_enabled: "E-signature is not on your plan.",
  invoicing_enabled: "Invoicing is not on your plan.",
  direct_close_enabled: "Direct close is not on your plan.",
};

/** Why an action would be skipped right now, before the rule is even saved. */
function actionBlocker(type: ActionType, context: BuilderContext): string | null {
  const meta = ACTION_META[type];
  for (const capability of meta.capabilities ?? []) {
    if (!context.capabilities[capability]) return CAPABILITY_NOTE[capability] ?? "Not on your plan.";
  }
  if (meta.aiPermission && !context.aiPermissions[meta.aiPermission]) {
    return `Needs "${AI_PERMISSION_LABEL[meta.aiPermission]}" on in Settings, AI & selling.`;
  }
  return null;
}

function defaultAction(type: ActionType, context: BuilderContext): RuleAction {
  switch (type) {
    case "place_ai_call":
      return { type, route: "QUALIFICATION" };
    case "schedule_call":
      return { type, route: "QUALIFICATION", delayMinutes: 60 };
    case "send_message":
      return { type, channel: "sms", body: "Hi {{first_name}}, " };
    case "book_meeting":
      return { type, channel: "sms", body: DEFAULT_BOOKING_MESSAGE };
    case "create_quote":
      return { type, itemId: context.catalogueItems[0]?.id ?? "", quantity: 1 };
    case "send_payment_link":
      return { type, checkoutLinkId: context.checkoutLinks[0]?.id ?? "", channel: "sms" };
    case "change_stage":
      return { type, semantic: "QUOTED" };
    case "add_tag":
      return { type, tag: "FOLLOW_UP" };
    case "start_nurture":
      return { type, campaignId: context.campaigns[0]?.id ?? "" };
    case "notify_team":
      return { type, title: "Heads up", body: "" };
    default:
      return { type } as RuleAction;
  }
}

type Draft = {
  id: string | null;
  name: string;
  trigger: string;
  leadStatusIn: string[];
  minValue: string;
  actions: RuleAction[];
  frequency: RuleFrequency;
  enabled: boolean;
  acknowledgeExternal: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  trigger: "",
  leadStatusIn: [],
  minValue: "",
  actions: [],
  frequency: "ONCE_PER_DAY",
  enabled: false,
  acknowledgeExternal: false,
};

function draftFrom(rule: RuleView): Draft {
  const conditions = (rule.conditions ?? {}) as { leadStatusIn?: string[]; minValue?: number | null };
  return {
    id: rule.id,
    name: rule.name,
    trigger: rule.trigger,
    leadStatusIn: conditions.leadStatusIn ?? [],
    minValue: conditions.minValue == null ? "" : String(conditions.minValue),
    actions: Array.isArray(rule.actions) ? (rule.actions as RuleAction[]) : [],
    frequency: (RULE_FREQUENCIES as readonly string[]).includes(rule.frequency) ? (rule.frequency as RuleFrequency) : "ONCE_PER_DAY",
    enabled: rule.enabled,
    acknowledgeExternal: rule.acknowledgeExternal,
  };
}

function toInput(draft: Draft) {
  return {
    id: draft.id,
    name: draft.name,
    trigger: draft.trigger,
    conditions: {
      leadStatusIn: draft.leadStatusIn,
      minValue: draft.minValue.trim() === "" ? null : Number(draft.minValue),
    },
    actions: draft.actions,
    frequency: draft.frequency,
    enabled: draft.enabled,
    acknowledgeExternal: draft.acknowledgeExternal,
  };
}

const TRIGGER_OPTIONS = TRIGGER_GROUPS.flatMap((group) =>
  group.triggers.map((t) => ({ value: t.type, label: t.label, group: group.label, description: t.description })),
);

/* ================================================================== board */

export function AutomationRulesBoard({
  rules,
  pendingMigration,
  context,
  canEdit,
}: {
  rules: RuleView[];
  pendingMigration: boolean;
  context: BuilderContext;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [deleting, setDeleting] = React.useState<RuleView | null>(null);
  const [pending, startTransition] = React.useTransition();

  function toggle(rule: RuleView, enabled: boolean) {
    startTransition(async () => {
      const result = await setAutomationRuleEnabled({ ruleId: rule.id, enabled });
      if (result.ok) toast({ variant: "success", title: enabled ? "Automation on" : "Automation off" });
      else if (enabled && result.code === "INVALID_INPUT") {
        // Needs the customer-contact acknowledgement: open the rule to give it.
        setEditing({ ...draftFrom(rule), enabled: true });
      } else toast({ variant: "error", title: result.error });
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="border-b-0 px-5 pt-5 pb-0">
          <SectionHeader
            icon={Workflow}
            tone="info"
            title="Automations"
            description="When something happens to a lead, a quote or a call, do something about it. Every action runs with the same checks as if a person pressed the button, and anything that may not run is recorded with the reason."
            action={
              canEdit && !pendingMigration ? (
                <Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                  <Plus className="size-4" aria-hidden />
                  New automation
                </Button>
              ) : undefined
            }
          />
        </CardHeader>
        <CardContent className="px-5 pt-4 pb-5">
          {pendingMigration ? (
            <div className="border-line bg-surface-sunken rounded-lg border px-4 py-3">
              <p className="text-content text-[13px] font-medium">Not available yet</p>
              <p className="text-content-muted mt-0.5 text-[13px]">
                Automations need a database update that has not been applied to this workspace yet. Nothing runs until it is.
              </p>
            </div>
          ) : rules.length === 0 ? (
            <EmptyState
              icon={Zap}
              title="No automations yet"
              description="Start with one: call a lead who asks to be called, send a quote once it is approved, or raise the invoices when a quote is signed."
              action={
                canEdit ? (
                  <Button size="sm" onClick={() => setEditing({ ...EMPTY_DRAFT })}>
                    <Plus className="size-4" aria-hidden />
                    New automation
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-3">
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  canEdit={canEdit}
                  busy={pending}
                  onToggle={(enabled) => toggle(rule, enabled)}
                  onEdit={() => setEditing(draftFrom(rule))}
                  onDelete={() => setDeleting(rule)}
                />
              ))}
            </ul>
          )}
          {!canEdit && (
            <p className="text-content-muted mt-3 text-[12.5px]">Only an owner or admin can create or change automations.</p>
          )}
        </CardContent>
      </Card>

      {editing && (
        <RuleEditor
          draft={editing}
          context={context}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        variant="danger"
        title="Delete this automation?"
        scope={deleting ? `"${deleting.name}"` : ""}
        consequence="It stops at once. What it already did is kept in the audit log."
        confirmLabel="Delete"
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            if (!deleting) return;
            const result = await deleteAutomationRule(deleting.id);
            if (result.ok) toast({ variant: "success", title: "Automation deleted" });
            else toast({ variant: "error", title: result.error });
            setDeleting(null);
          })
        }
      />
    </div>
  );
}

/* ================================================================ one rule */

function RuleRow({
  rule,
  canEdit,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: RuleView;
  canEdit: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const actions = Array.isArray(rule.actions) ? (rule.actions as RuleAction[]) : [];
  return (
    <li className="border-line rounded-lg border px-4 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-content text-[14px] font-semibold">{rule.name}</p>
            <StatusBadge kind="automation_rule" value={rule.enabled ? "ON" : "OFF"} dot />
          </div>
          <p className="text-content-muted mt-1 text-[13px]">{describeRule({ trigger: rule.trigger, actions })}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            checked={rule.enabled}
            onCheckedChange={onToggle}
            disabled={!canEdit || busy}
            label={rule.enabled ? `Turn off ${rule.name}` : `Turn on ${rule.name}`}
            tone="success"
          />
          {canEdit && (
            <>
              <Button variant="ghost" size="xs" onClick={onEdit} aria-label={`Edit ${rule.name}`}>
                <Pencil className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="xs" onClick={onDelete} aria-label={`Delete ${rule.name}`}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>
      {rule.recentRuns.length > 0 && (
        <details className="group mt-3">
          <summary className="text-content-secondary flex cursor-pointer list-none items-center gap-1 text-[12.5px] font-medium">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
            Recent runs ({rule.recentRuns.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {rule.recentRuns.map((run) => (
              <li key={run.id} className="flex flex-wrap items-start gap-2 text-[12.5px]">
                <StatusBadge kind="automation_run" value={run.status} dense />
                <span className="text-content-secondary">
                  {run.actionType ? ACTION_META[run.actionType as ActionType]?.label ?? run.actionType : "Rule"}
                </span>
                {run.reason && <span className="text-content-muted min-w-0 flex-1 break-words">{run.reason}</span>}
                <time className="text-content-subtle ml-auto shrink-0" dateTime={run.createdAt}>
                  {new Date(run.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}
                </time>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

/* ================================================================= editor */

function RuleEditor({
  draft: initial,
  context,
  onClose,
  onSaved,
}: {
  draft: Draft;
  context: BuilderContext;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState<Draft>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, startSaving] = React.useTransition();
  const [showConditions, setShowConditions] = React.useState(initial.leadStatusIn.length > 0 || initial.minValue !== "");
  const trigger = triggerMeta(draft.trigger);
  const contacts = draft.actions.some((a) => contactsCustomer(a.type));

  const actionOptions = ACTION_GROUPS.flatMap((group) =>
    ACTION_TYPES.filter((type) => ACTION_META[type].group === group.key)
      .filter((type) => !trigger || actionFitsTrigger(type, trigger))
      .map((type) => {
        const blocker = actionBlocker(type, context);
        return {
          value: type,
          label: ACTION_META[type].label,
          group: group.label,
          description: blocker ? `Will be skipped: ${blocker}` : ACTION_META[type].description,
        };
      }),
  );

  function update(patch: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...patch }));
  }
  function updateAction(index: number, next: RuleAction) {
    setDraft((d) => ({ ...d, actions: d.actions.map((a, i) => (i === index ? next : a)) }));
  }

  function save() {
    setError(null);
    const input = toInput(draft);
    const parsed = ruleInputSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the automation and try again.");
      return;
    }
    startSaving(async () => {
      const result = await saveAutomationRule(input);
      if (result.ok) {
        toast({ variant: "success", title: draft.id ? "Automation saved" : "Automation created" });
        onSaved();
      } else setError(result.error);
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={draft.id ? "Edit automation" : "New automation"}
      description="When this happens, do that. Each step runs with the checks a person would meet, and anything that may not run is recorded with the reason."
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving} disabled={!draft.trigger || draft.actions.length === 0}>
            {draft.id ? "Save" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="rule-name" required>
            Name
          </Label>
          <Input id="rule-name" value={draft.name} maxLength={80} placeholder="e.g. Call leads who ask for a call" onChange={(e) => update({ name: e.target.value })} />
        </div>

        {/* ---- 1. When ---- */}
        <fieldset className="space-y-2">
          <legend className="text-content text-[13px] font-semibold">1. When</legend>
          <Select
            aria-label="Trigger"
            value={draft.trigger}
            placeholder="Choose what starts it"
            options={TRIGGER_OPTIONS}
            searchable
            onValueChange={(value) => {
              const next = triggerMeta(value);
              update({
                trigger: value,
                actions: next ? draft.actions.filter((a) => actionFitsTrigger(a.type, next)) : draft.actions,
                minValue: next?.threshold ? String(next.threshold.defaultValue) : "",
              });
              if (next?.threshold) setShowConditions(true);
            }}
          />
          {trigger && <p className="text-content-muted text-[12.5px]">{trigger.description}</p>}

          {trigger && (
            <div>
              <button
                type="button"
                className="text-content-accent text-[12.5px] font-medium"
                aria-expanded={showConditions}
                onClick={() => setShowConditions((v) => !v)}
              >
                {showConditions ? "Hide conditions" : "Only when… (optional)"}
              </button>
              {showConditions && (
                <div className="border-line mt-2 space-y-3 rounded-lg border px-3 py-3">
                  {trigger.threshold && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor="rule-min">{trigger.threshold.label}</Label>
                      <Input
                        id="rule-min"
                        type="number"
                        className="w-24"
                        min={trigger.threshold.min}
                        max={trigger.threshold.max}
                        value={draft.minValue}
                        onChange={(e) => update({ minValue: e.target.value })}
                      />
                      {trigger.threshold.unit && <span className="text-content-muted text-[13px]">{trigger.threshold.unit}</span>}
                    </div>
                  )}
                  {trigger.subject !== "workspace" && (
                    <div>
                      <p className="text-content text-[13px] font-medium">Lead status is one of</p>
                      <p className="text-content-muted text-[12px]">None ticked means any status.</p>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
                        {LEAD_STATUSES_FOR_CONDITIONS.map((status) => (
                          <label key={status} className="text-content-secondary flex items-center gap-1.5 text-[13px]">
                            <Checkbox
                              checked={draft.leadStatusIn.includes(status)}
                              onChange={(e) =>
                                update({
                                  leadStatusIn: e.target.checked
                                    ? [...draft.leadStatusIn, status]
                                    : draft.leadStatusIn.filter((s) => s !== status),
                                })
                              }
                            />
                            {status.charAt(0) + status.slice(1).toLowerCase()}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </fieldset>

        {/* ---- 2. Then ---- */}
        <fieldset className="space-y-2" disabled={!trigger}>
          <legend className="text-content text-[13px] font-semibold">2. Then</legend>
          {!trigger && <p className="text-content-muted text-[12.5px]">Choose a trigger first.</p>}
          <ol className="space-y-2">
            {draft.actions.map((action, index) => (
              <li key={index} className="border-line rounded-lg border px-3 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-content text-[13px] font-medium">
                      {index + 1}. {ACTION_META[action.type].label}
                    </p>
                    <p className="text-content-muted text-[12px]">{ACTION_META[action.type].description}</p>
                    {actionBlocker(action.type, context) && (
                      <p className="text-warning-700 mt-1 text-[12px]">Will be skipped: {actionBlocker(action.type, context)}</p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={`Remove ${ACTION_META[action.type].label}`}
                    onClick={() => update({ actions: draft.actions.filter((_, i) => i !== index) })}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
                <ActionParams action={action} context={context} onChange={(next) => updateAction(index, next)} />
              </li>
            ))}
          </ol>
          {trigger && draft.actions.length < MAX_RULE_ACTIONS && (
            <Select
              aria-label="Add a step"
              value=""
              placeholder={draft.actions.length === 0 ? "Choose what to do" : "Add another step"}
              options={actionOptions}
              searchable
              onValueChange={(value) => update({ actions: [...draft.actions, defaultAction(value as ActionType, context)] })}
            />
          )}
        </fieldset>

        {/* ---- 3. How often ---- */}
        <fieldset className="space-y-3">
          <legend className="text-content text-[13px] font-semibold">3. How often, and on or off</legend>
          <Select
            aria-label="How often"
            value={draft.frequency}
            options={RULE_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
            onValueChange={(value) => update({ frequency: value as RuleFrequency })}
          />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-content text-[13px] font-medium">Turn it on</p>
              <p className="text-content-muted text-[12px]">It acts on your authority, re-checked every time it runs.</p>
            </div>
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => update({ enabled })} label="Turn this automation on" tone="success" />
          </div>
          {contacts && (
            <label className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]", draft.acknowledgeExternal ? "border-line" : "border-warning-100 bg-warning-50")}>
              <Checkbox checked={draft.acknowledgeExternal} onChange={(e) => update({ acknowledgeExternal: e.target.checked })} className="mt-0.5" />
              <span className="text-content-secondary">
                This automation may contact customers (a call, a message, a quote or an invoice) without asking me each time. Opt-outs, suppression,
                quiet hours, calling hours and consent still apply.
              </span>
            </label>
          )}
        </fieldset>

        <FormError message={error} />
      </div>
    </Modal>
  );
}

/* ===================================================== per-action params */

function ActionParams({
  action,
  context,
  onChange,
}: {
  action: RuleAction;
  context: BuilderContext;
  onChange: (next: RuleAction) => void;
}) {
  const channelSelect = (value: "sms" | "whatsapp", set: (v: "sms" | "whatsapp") => void) => (
    <Select
      aria-label="Channel"
      value={value}
      options={[
        { value: "sms", label: "SMS" },
        { value: "whatsapp", label: "WhatsApp" },
      ]}
      onValueChange={(v) => set(v as "sms" | "whatsapp")}
    />
  );

  switch (action.type) {
    case "schedule_call":
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Label htmlFor="delay">Wait</Label>
          <Input
            id="delay"
            type="number"
            className="w-24"
            min={5}
            max={10080}
            value={action.delayMinutes}
            onChange={(e) => onChange({ ...action, delayMinutes: Number(e.target.value) })}
          />
          <span className="text-content-muted text-[13px]">minutes, then call (within calling hours)</span>
        </div>
      );
    case "send_message":
    case "book_meeting":
      return (
        <div className="mt-2 grid gap-2 sm:grid-cols-[140px_minmax(0,1fr)]">
          {channelSelect(action.channel, (channel) => onChange({ ...action, channel }))}
          <Textarea
            aria-label="Message"
            rows={3}
            maxLength={1200}
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
          />
        </div>
      );
    case "create_quote":
      return context.catalogueItems.length === 0 ? (
        <p className="text-warning-700 mt-2 text-[12px]">Add an item to your catalogue first (Settings, Quotes).</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px]">
          <Select
            aria-label="Catalogue item"
            value={action.itemId}
            options={context.catalogueItems.map((i) => ({ value: i.id, label: i.name }))}
            onValueChange={(itemId) => onChange({ ...action, itemId })}
          />
          <Input
            aria-label="Quantity"
            type="number"
            min={1}
            value={action.quantity}
            onChange={(e) => onChange({ ...action, quantity: Number(e.target.value) })}
          />
        </div>
      );
    case "send_payment_link":
      return context.checkoutLinks.length === 0 ? (
        <p className="text-warning-700 mt-2 text-[12px]">Add an approved checkout link first (Settings, AI & selling).</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
          <Select
            aria-label="Checkout link"
            value={action.checkoutLinkId}
            options={context.checkoutLinks.map((l) => ({ value: l.id, label: l.label }))}
            onValueChange={(checkoutLinkId) => onChange({ ...action, checkoutLinkId })}
          />
          {channelSelect(action.channel, (channel) => onChange({ ...action, channel }))}
        </div>
      );
    case "change_stage":
      return (
        <div className="mt-2">
          <Select
            aria-label="Deal step"
            value={action.semantic}
            options={STAGE_ACTION_SEMANTICS.map((s) => ({ value: s, label: SEMANTIC_META[s].label, description: SEMANTIC_META[s].description }))}
            onValueChange={(semantic) => onChange({ ...action, semantic: semantic as (typeof STAGE_ACTION_SEMANTICS)[number] })}
          />
          <p className="text-content-muted mt-1 text-[12px]">The stage comes from your pipeline mapping in Settings, AI & selling.</p>
        </div>
      );
    case "add_tag":
      return (
        <Input
          aria-label="Tag"
          className="mt-2"
          value={action.tag}
          maxLength={50}
          onChange={(e) => onChange({ ...action, tag: e.target.value.toUpperCase().replace(/[^A-Z_]/g, "_") })}
        />
      );
    case "start_nurture":
      return context.campaigns.length === 0 ? (
        <p className="text-warning-700 mt-2 text-[12px]">Create a draft or paused reactivation campaign first.</p>
      ) : (
        <Select
          aria-label="Campaign"
          className="mt-2"
          value={action.campaignId}
          options={context.campaigns.map((c) => ({ value: c.id, label: c.name, description: c.status.toLowerCase() }))}
          onValueChange={(campaignId) => onChange({ ...action, campaignId })}
        />
      );
    case "notify_team":
      return (
        <div className="mt-2 space-y-2">
          <Input aria-label="Title" value={action.title} maxLength={120} onChange={(e) => onChange({ ...action, title: e.target.value })} />
          <Textarea aria-label="Details" rows={2} maxLength={500} value={action.body} onChange={(e) => onChange({ ...action, body: e.target.value })} />
        </div>
      );
    default:
      return null;
  }
}
