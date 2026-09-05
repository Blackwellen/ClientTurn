"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  GitBranch,
  MessageSquare,
  Plus,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FormField, Input, Select, Switch, Textarea } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { EmptyState, PlanLimitState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { findUnknownMergeFields } from "@/lib/automation/scheduler";
import { segmentInfo } from "@/lib/campaigns/types";
import {
  discardAutomationDraft,
  publishAutomation,
  saveAutomationDraft,
  setAutomationEnabled,
} from "@/lib/automations/actions";
import {
  CHANNELS,
  CHANNEL_LABEL,
  DELAY_PRESETS,
  SEQUENCE_SCOPE_NOTE,
  VERSIONING_NOTE,
  formatDelay,
  type AutomationDetail,
  type Channel,
  type StepInput,
} from "@/lib/automations/types";

const MERGE_FIELDS = [
  { token: "{{first_name}}", hint: "The lead first name" },
  { token: "{{business_name}}", hint: "Your business name" },
  { token: "{{service_name}}", hint: "The service the lead asked about" },
  { token: "{{booking_link}}", hint: "Your configured booking destination" },
  { token: "{{business_phone}}", hint: "Your business phone number" },
];

type DraftStep = StepInput & { key: string };

function toDraft(steps: AutomationDetail["steps"]): DraftStep[] {
  return steps.map((step) => ({
    key: step.id,
    delaySeconds: step.delaySeconds,
    channel: step.channel,
    template: step.template,
    enabled: step.enabled,
  }));
}

function toInputs(rows: DraftStep[]): StepInput[] {
  return rows.map((row) => ({
    delaySeconds: row.delaySeconds,
    channel: row.channel,
    template: row.template,
    enabled: row.enabled,
  }));
}

function newKey() {
  return `step-${Math.random().toString(36).slice(2, 10)}`;
}

export function AutomationEditor({
  automation,
  canEdit,
  whatsappEnabled,
}: {
  automation: AutomationDetail;
  canEdit: boolean;
  whatsappEnabled: boolean;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState(automation.name);
  const [steps, setSteps] = React.useState<DraftStep[]>(() =>
    toDraft(automation.steps),
  );
  const [pending, setPending] = React.useState<string | null>(null);
  const [confirm, setConfirm] = React.useState<
    null | "publish" | "discard" | "pause" | "activate"
  >(null);
  const templateRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});

  const baseline = React.useMemo(
    () => JSON.stringify(toInputs(toDraft(automation.steps))),
    [automation.steps],
  );
  const current = JSON.stringify(toInputs(steps));
  const dirty = current !== baseline || name !== automation.name;

  const unknownTokens = React.useMemo(
    () => [...new Set(steps.flatMap((step) => findUnknownMergeFields(step.template)))],
    [steps],
  );
  const emptyTemplates = steps.some((step) => step.template.trim().length === 0);
  const noneEnabled = steps.length > 0 && !steps.some((step) => step.enabled);

  function patch(key: string, next: Partial<StepInput>) {
    setSteps((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...next } : row)),
    );
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((rows) => {
      const target = index + direction;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addStep() {
    setSteps((rows) => [
      ...rows,
      {
        key: newKey(),
        delaySeconds: rows.length === 0 ? 0 : 86400,
        channel: "sms",
        template: "",
        enabled: true,
      },
    ]);
  }

  function insertMergeField(key: string, token: string) {
    const element = templateRefs.current[key];
    setSteps((rows) =>
      rows.map((row) => {
        if (row.key !== key) return row;
        const start = element?.selectionStart ?? row.template.length;
        const end = element?.selectionEnd ?? row.template.length;
        return {
          ...row,
          template:
            row.template.slice(0, start) + token + row.template.slice(end),
        };
      }),
    );
  }

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setPending(key);
    try {
      const result = await fn();
      if (result.ok) {
        toast({ variant: "success", title: success });
        setConfirm(null);
      } else {
        toast({ variant: "error", title: result.error ?? "That did not work." });
      }
    } finally {
      setPending(null);
    }
  }

  const save = () =>
    run(
      "save",
      () =>
        saveAutomationDraft({
          automationId: automation.id,
          name,
          steps: toInputs(steps),
        }),
      automation.editingIsDraft ? "Draft saved" : "New draft version created",
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="text-content-muted size-4" />
              Version {automation.editingVersionNumber}
              {automation.editingIsDraft ? (
                <Badge tone="info">Draft</Badge>
              ) : automation.publishedVersionNumber ? (
                <Badge tone="success" dot>
                  Published
                </Badge>
              ) : (
                <Badge tone="neutral">Not published</Badge>
              )}
            </CardTitle>
            <p className="text-content-muted mt-1 text-[13px]">
              {VERSIONING_NOTE}
            </p>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-content-subtle text-[12px]">
                Published version
              </dt>
              <dd className="text-content lr-tabular text-[13px] font-medium">
                {automation.publishedVersionNumber
                  ? `Version ${automation.publishedVersionNumber}`
                  : "None yet"}
              </dd>
            </div>
            <div>
              <dt className="text-content-subtle text-[12px]">
                Leads in this sequence
              </dt>
              <dd className="text-content lr-tabular text-[13px] font-medium">
                {automation.leadsInSequence.toLocaleString("en-GB")}
              </dd>
            </div>
            <div>
              <dt className="text-content-subtle text-[12px]">
                Finishing on an earlier version
              </dt>
              <dd className="text-content lr-tabular text-[13px] font-medium">
                {automation.leadsOnOlderVersions.toLocaleString("en-GB")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <SectionHeader
            title="Sequence"
            description={SEQUENCE_SCOPE_NOTE}
            action={
              canEdit ? (
                <Button variant="secondary" size="sm" onClick={addStep}>
                  <Plus className="size-3.5" />
                  Add step
                </Button>
              ) : undefined
            }
          />
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {!whatsappEnabled && (
            <PlanLimitState
              title="WhatsApp is not on this plan"
              description="Steps can be sent by SMS on your current plan. Upgrade to Growth or above to add WhatsApp steps."
            />
          )}

          {!canEdit && (
            <p className="border-line bg-surface-sunken text-content-secondary rounded-md border px-3 py-2 text-[12px]">
              You have read-only access to automations. An owner or admin can
              change this sequence.
            </p>
          )}

          <FormField label="Automation name" htmlFor="automation-name">
            <Input
              id="automation-name"
              value={name}
              maxLength={80}
              disabled={!canEdit}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>

          {steps.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No steps yet"
              description="A sequence needs at least one message. The first step usually goes out immediately, while the enquiry is still fresh."
              action={
                canEdit ? (
                  <Button size="sm" onClick={addStep}>
                    <Plus className="size-3.5" />
                    Add the first step
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ol className="space-y-3">
              {steps.map((step, index) => {
                const unknown = findUnknownMergeFields(step.template);
                return (
                  <li
                    key={step.key}
                    className="border-line bg-surface-sunken/40 rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="bg-surface border-line text-content lr-tabular flex size-6 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold">
                          {index + 1}
                        </span>
                        <span className="text-content text-[13px] font-medium">
                          {formatDelay(step.delaySeconds)} ·{" "}
                          {CHANNEL_LABEL[step.channel]}
                        </span>
                        {!step.enabled && <Badge tone="neutral">Off</Badge>}
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          <IconButton
                            variant="ghost"
                            size="xs"
                            label={`Move step ${index + 1} earlier`}
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            <ArrowUp className="size-3.5" />
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            size="xs"
                            label={`Move step ${index + 1} later`}
                            disabled={index === steps.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            <ArrowDown className="size-3.5" />
                          </IconButton>
                          <IconButton
                            variant="ghost"
                            size="xs"
                            label={`Remove step ${index + 1}`}
                            onClick={() =>
                              setSteps((rows) =>
                                rows.filter((row) => row.key !== step.key),
                              )
                            }
                          >
                            <Trash2 className="text-danger-600 size-3.5" />
                          </IconButton>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <FormField
                        label={index === 0 ? "Delay after the trigger" : "Delay after the previous step"}
                        htmlFor={`${step.key}-delay`}
                      >
                        <Select
                          id={`${step.key}-delay`}
                          value={String(step.delaySeconds)}
                          disabled={!canEdit}
                          onChange={(event) =>
                            patch(step.key, {
                              delaySeconds: Number(event.target.value),
                            })
                          }
                        >
                          {DELAY_PRESETS.map((preset) => (
                            <option key={preset.seconds} value={preset.seconds}>
                              {preset.label}
                            </option>
                          ))}
                          {!DELAY_PRESETS.some(
                            (preset) => preset.seconds === step.delaySeconds,
                          ) && (
                            <option value={step.delaySeconds}>
                              {formatDelay(step.delaySeconds)}
                            </option>
                          )}
                        </Select>
                      </FormField>

                      <FormField label="Channel" htmlFor={`${step.key}-channel`}>
                        <Select
                          id={`${step.key}-channel`}
                          value={step.channel}
                          disabled={!canEdit}
                          onChange={(event) =>
                            patch(step.key, {
                              channel: event.target.value as Channel,
                            })
                          }
                        >
                          {CHANNELS.map((channel) => (
                            <option
                              key={channel}
                              value={channel}
                              disabled={channel === "whatsapp" && !whatsappEnabled}
                            >
                              {CHANNEL_LABEL[channel]}
                              {channel === "whatsapp" && !whatsappEnabled
                                ? " (Growth plan)"
                                : ""}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                    </div>

                    <FormField
                      className="mt-3"
                      label="Message"
                      htmlFor={`${step.key}-template`}
                      hint={(() => {
                        const info = segmentInfo(step.template);
                        return info.segments <= 1
                          ? `${info.characters} characters · 1 SMS segment`
                          : `${info.characters} characters · ${info.segments} SMS segments (${info.encoding})`;
                      })()}
                      error={
                        unknown.length > 0
                          ? `Unknown merge ${unknown.length === 1 ? "field" : "fields"}: ${unknown
                              .map((token) => `{{${token}}}`)
                              .join(", ")}`
                          : undefined
                      }
                    >
                      <Textarea
                        id={`${step.key}-template`}
                        rows={3}
                        maxLength={1200}
                        value={step.template}
                        disabled={!canEdit}
                        ref={(element) => {
                          templateRefs.current[step.key] = element;
                        }}
                        onChange={(event) =>
                          patch(step.key, { template: event.target.value })
                        }
                      />
                    </FormField>

                    {canEdit && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-content-subtle text-[12px]">
                          Insert:
                        </span>
                        {MERGE_FIELDS.map((field) => (
                          <button
                            key={field.token}
                            type="button"
                            title={field.hint}
                            onClick={() => insertMergeField(step.key, field.token)}
                            className="border-line bg-surface text-content-secondary hover:bg-surface-hover hover:text-content focus-visible:outline-content-accent rounded-full border px-2 py-0.5 font-mono text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2"
                          >
                            {field.token}
                          </button>
                        ))}
                      </div>
                    )}

                    {canEdit && (
                      <div className="mt-3">
                        <Switch
                          checked={step.enabled}
                          onCheckedChange={(value) =>
                            patch(step.key, { enabled: value })
                          }
                          label="Send this step"
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      {canEdit && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-4">
            <Button
              size="sm"
              onClick={save}
              loading={pending === "save"}
              disabled={!dirty || steps.length === 0 || emptyTemplates}
            >
              Save draft
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirm("publish")}
              disabled={
                dirty ||
                !automation.editingIsDraft ||
                steps.length === 0 ||
                unknownTokens.length > 0 ||
                noneEnabled
              }
            >
              Publish version {automation.editingVersionNumber}
            </Button>
            {automation.editingIsDraft && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirm("discard")}
              >
                Discard draft
              </Button>
            )}
            <div className="ml-auto">
              <Button
                variant={automation.enabled ? "ghost" : "secondary"}
                size="sm"
                onClick={() => setConfirm(automation.enabled ? "pause" : "activate")}
              >
                {automation.enabled ? "Pause automation" : "Activate automation"}
              </Button>
            </div>

            {dirty && (
              <p className="text-content-muted basis-full text-[12px]">
                Save the draft before publishing. Nothing you type here reaches a
                lead until a version is published.
              </p>
            )}
            {unknownTokens.length > 0 && (
              <p className="text-danger-700 basis-full inline-flex items-center gap-1.5 text-[12px]">
                <TriangleAlert className="size-3.5" aria-hidden />
                Publishing is blocked while an unknown merge field is present.
              </p>
            )}
            {noneEnabled && (
              <p className="text-content-muted basis-full text-[12px]">
                Switch at least one step on before publishing.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(
            "publish",
            () => publishAutomation({ automationId: automation.id }),
            "Version published",
          )
        }
        loading={pending === "publish"}
        title={`Publish version ${automation.editingVersionNumber}?`}
        scope={`${automation.name} · ${steps.length} ${steps.length === 1 ? "step" : "steps"}`}
        consequence="New leads start on this version. Leads already part-way through finish on the version they started, so no one gets a half-old, half-new sequence. The previous published version is archived, not deleted."
        confirmLabel="Publish"
      />

      <ConfirmDialog
        open={confirm === "discard"}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(
            "discard",
            () => discardAutomationDraft({ automationId: automation.id }),
            "Draft discarded",
          )
        }
        loading={pending === "discard"}
        variant="danger"
        title="Discard this draft?"
        scope={`${automation.name} · draft version ${automation.editingVersionNumber}`}
        consequence="The unpublished changes are deleted. The published version keeps running exactly as it is. This cannot be undone."
        confirmLabel="Discard draft"
      />

      <ConfirmDialog
        open={confirm === "pause"}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(
            "pause",
            () =>
              setAutomationEnabled({
                automationId: automation.id,
                enabled: false,
              }),
            "Automation paused",
          )
        }
        loading={pending === "pause"}
        variant="warning"
        title="Pause this automation?"
        scope={`${automation.leadsInSequence} ${automation.leadsInSequence === 1 ? "lead is" : "leads are"} currently in this sequence`}
        consequence="No further step is sent. Leads mid-sequence are held at the step they reached, on the version they started, and resume from there if you activate it again."
        confirmLabel="Pause"
      />

      <ConfirmDialog
        open={confirm === "activate"}
        onClose={() => setConfirm(null)}
        onConfirm={() =>
          run(
            "activate",
            () =>
              setAutomationEnabled({
                automationId: automation.id,
                enabled: true,
              }),
            "Automation activated",
          )
        }
        loading={pending === "activate"}
        title="Activate this automation?"
        scope={`${automation.name} · version ${automation.publishedVersionNumber ?? "—"}`}
        consequence="New leads matching the trigger start the published version. Held leads resume from the step they reached, and every stop condition is re-checked immediately before each send."
        confirmLabel="Activate"
      />
    </div>
  );
}
