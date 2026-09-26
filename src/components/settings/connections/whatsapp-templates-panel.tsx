"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField, Select } from "@/components/ui/form";
import { EmptyState } from "@/components/ui/feedback";
import { useToast } from "@/components/ui/toast";
import { SectionHeader } from "@/components/app/page-header";
import { mapWhatsAppStepAction, syncWhatsAppTemplatesAction } from "@/lib/settings/channel-actions";
import { TEMPLATE_VARIABLE_SOURCES } from "@/lib/messaging/whatsapp-templates";
import type { WhatsAppStepView } from "@/lib/services/operations/channels";

export type TemplateView = {
  id: string;
  provider: "twilio" | "meta";
  name: string;
  language: string;
  category: string;
  status: string;
  body: string | null;
  variables: string[];
  platform: boolean;
};

const CATEGORY_LABEL: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utility",
  AUTHENTICATION: "Authentication",
};

function StepMapping({
  step,
  approved,
  canManage,
}: {
  step: WhatsAppStepView;
  approved: TemplateView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [templateId, setTemplateId] = React.useState(step.mapping?.templateId ?? "");
  const [variableMap, setVariableMap] = React.useState<Record<string, string>>(
    step.mapping?.variableMap ?? {},
  );
  const [saving, setSaving] = React.useState(false);
  const template = approved.find((candidate) => candidate.id === templateId) ?? null;
  const mappedButGone = Boolean(step.mapping && !approved.some((t) => t.id === step.mapping?.templateId));

  async function save(nextTemplateId: string | null) {
    setSaving(true);
    const result = await mapWhatsAppStepAction({
      automationId: step.automationId,
      stepPosition: step.position,
      templateId: nextTemplateId,
      variableMap: nextTemplateId ? variableMap : undefined,
    });
    setSaving(false);
    if (result.ok) {
      toast({ variant: "success", title: result.message });
      if (!nextTemplateId) {
        setTemplateId("");
        setVariableMap({});
      }
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  const id = `${step.automationId}-${step.position}`;

  return (
    <div className="border-line space-y-3 rounded-lg border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-content text-[13px] font-medium">
            {step.automationName} · step {step.position}
          </p>
          <p className="text-content-muted line-clamp-2 text-[12px]">{step.template}</p>
        </div>
        {step.mapping && !mappedButGone ? (
          <Badge tone="success" dot>
            Template set
          </Badge>
        ) : mappedButGone ? (
          <Badge tone="danger" dot>
            Template no longer approved
          </Badge>
        ) : (
          <Badge tone="warning" dot>
            No template
          </Badge>
        )}
      </div>

      <FormField
        label="Template when the 24-hour window has closed"
        htmlFor={`tpl-${id}`}
        hint="Inside the window the step's own text is sent. Outside it, only this approved template can be."
      >
        <Select
          id={`tpl-${id}`}
          value={templateId}
          disabled={!canManage || saving}
          onChange={(event) => {
            setTemplateId(event.target.value);
            setVariableMap({});
          }}
        >
          <option value="">No template (the step is held for a person)</option>
          {approved.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} · {option.language} · {CATEGORY_LABEL[option.category] ?? option.category}
            </option>
          ))}
        </Select>
      </FormField>

      {template?.body && (
        <p className="bg-surface-sunken text-content-secondary rounded-md px-3 py-2 text-[12px] whitespace-pre-wrap">
          {template.body}
        </p>
      )}

      {template && template.variables.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {template.variables.map((variable) => (
            <FormField key={variable} label={`Fill {{${variable}}} with`} htmlFor={`var-${id}-${variable}`}>
              <Select
                id={`var-${id}-${variable}`}
                value={variableMap[variable] ?? ""}
                disabled={!canManage || saving}
                onChange={(event) =>
                  setVariableMap((current) => ({ ...current, [variable]: event.target.value }))
                }
              >
                <option value="">Choose a field</option>
                {TEMPLATE_VARIABLE_SOURCES.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.label}
                  </option>
                ))}
              </Select>
            </FormField>
          ))}
        </div>
      )}

      {canManage && (
        <div className="flex justify-end gap-2">
          {step.mapping && (
            <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => void save(null)}>
              Remove template
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            loading={saving}
            disabled={!template || template.variables.some((variable) => !variableMap[variable])}
            onClick={() => void save(templateId)}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The WhatsApp approved-template registry (brief §45): what is synced from the
 * provider, and which template each WhatsApp follow-up step sends once the
 * 24-hour service window has closed. Without one, such a step is held for a
 * person -- free text is never sent outside the window.
 */
export function WhatsAppTemplatesPanel({
  transport,
  templates,
  steps,
  canManage,
  whatsappEnabled,
}: {
  transport: "twilio" | "meta";
  templates: TemplateView[];
  steps: WhatsAppStepView[];
  canManage: boolean;
  whatsappEnabled: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [syncing, setSyncing] = React.useState(false);
  const approved = templates.filter((template) => template.status === "APPROVED");

  if (!whatsappEnabled) return null;

  async function sync() {
    setSyncing(true);
    const result = await syncWhatsAppTemplatesAction();
    setSyncing(false);
    if (result.ok) {
      toast({ variant: "success", title: result.message });
      router.refresh();
    } else {
      toast({ variant: "error", title: result.error });
    }
  }

  return (
    <Card>
      <CardHeader>
        <SectionHeader
          icon={MessageSquareText}
          title="WhatsApp templates"
          description={
            transport === "meta"
              ? "Approved templates from your own WhatsApp Business Account."
              : "Approved templates on ClientTurn's WhatsApp sender (Twilio)."
          }
          action={
            canManage ? (
              <Button type="button" size="sm" variant="secondary" loading={syncing} onClick={() => void sync()}>
                <RefreshCw className="size-3.5" aria-hidden />
                Sync
              </Button>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="space-y-5">
        {templates.length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title="No templates synced yet"
            description="Templates are synced once a day. Sync now to fetch them, then choose one for each WhatsApp follow-up step."
          />
        ) : (
          <ul className="divide-line divide-y">
            {templates.map((template) => (
              <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-content text-[13px] font-medium">{template.name}</p>
                  <p className="text-content-muted text-[12px]">
                    {template.language} · {CATEGORY_LABEL[template.category] ?? template.category}
                    {template.variables.length
                      ? ` · ${template.variables.length} variable${template.variables.length === 1 ? "" : "s"}`
                      : ""}
                  </p>
                </div>
                <StatusBadge kind="whatsapp_template" value={template.status} dense />
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <h3 className="text-content text-[13px] font-semibold">Follow-up steps on WhatsApp</h3>
          {steps.length === 0 ? (
            <p className="text-content-muted text-[13px]">
              None of your follow-up sequences has a WhatsApp step.
            </p>
          ) : (
            steps.map((step) => (
              <StepMapping
                key={`${step.automationId}-${step.position}`}
                step={step}
                approved={approved}
                canManage={canManage}
              />
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
