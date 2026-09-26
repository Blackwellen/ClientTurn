import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  CRM_PULL_LABELS,
  CRM_PULL_PROVIDERS,
  initialCrmCursor,
  isCrmPullProvider,
  serialiseCrmCursor,
} from "@/lib/integrations/crm-pull/plan";
import {
  isTemplateVariableSource,
  type WhatsAppTemplateRecord,
} from "@/lib/messaging/whatsapp-templates";
import {
  listStepTemplates,
  listWorkspaceTemplates,
  loadTemplate,
  syncMetaTemplates,
  syncTwilioTemplates,
  whatsAppTransportFor,
} from "@/lib/messaging/template-registry";
import {
  cleanSpecialisms,
  meetingTypeFromRow,
  meetingTypeInputSchema,
  type MeetingType,
  type MeetingTypeInput,
} from "@/lib/bookings/meeting-types";
import { listMeetingTypes } from "@/lib/bookings/meeting-type-store";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * Channel and booking configuration (brief §29, §43, §45, §57): the CRM pull
 * toggle, the WhatsApp template registry and step mapping, and meeting types.
 * Every query is scoped to `context.businessId`; nothing here sends a message.
 */

// crm_pull_settings, whatsapp_*, meeting_types (0127) post-date the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

/* ================================================================ CRM pull */

export type CrmPullView = {
  integrationId: string;
  provider: string;
  label: string;
  connectionStatus: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  lastRunIngested: number;
  lastRunSkipped: number;
};

type PullSettingRow = {
  integration_id: string;
  enabled: boolean;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_error: string | null;
  last_run_ingested: number;
  last_run_skipped: number;
};

export async function crmPullViews(businessId: string): Promise<CrmPullView[]> {
  const { data: integrations, error } = await createAdminClient()
    .from("integrations")
    .select("id, provider_type, status")
    .eq("business_id", businessId)
    .in("provider_type", [...CRM_PULL_PROVIDERS])
    .neq("status", "DISCONNECTED");
  if (error) throw new ServiceError("UNAVAILABLE", "Connected CRMs could not be read.");
  if (!integrations?.length) return [];

  const { data: settings, error: settingsError } = await db()
    .from("crm_pull_settings")
    .select("integration_id, enabled, last_run_at, last_run_status, last_run_error, last_run_ingested, last_run_skipped")
    .eq("business_id", businessId);
  if (settingsError) throw new ServiceError("UNAVAILABLE", "CRM pull settings could not be read.");
  const byId = new Map(((settings ?? []) as PullSettingRow[]).map((row) => [row.integration_id, row]));

  return integrations
    .filter((row) => isCrmPullProvider(row.provider_type))
    .map((row) => {
      const setting = byId.get(row.id);
      return {
        integrationId: row.id,
        provider: row.provider_type,
        label: CRM_PULL_LABELS[row.provider_type as keyof typeof CRM_PULL_LABELS],
        connectionStatus: row.status,
        enabled: setting?.enabled ?? false,
        lastRunAt: setting?.last_run_at ?? null,
        lastRunStatus: setting?.last_run_status ?? null,
        lastRunError: setting?.last_run_error ?? null,
        lastRunIngested: setting?.last_run_ingested ?? 0,
        lastRunSkipped: setting?.last_run_skipped ?? 0,
      };
    });
}

defineOperation("crm_pull.list", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const views = await crmPullViews(context.businessId);
    return { data: { crms: views } };
  },
});

defineOperation("crm_pull.set", {
  schema: z.object({ integrationId: z.uuid(), enabled: z.boolean() }),
  async run({ args, context }: HandlerInput<{ integrationId: string; enabled: boolean }>) {
    const admin = createAdminClient();
    const { data: integration } = await admin
      .from("integrations")
      .select("id, provider_type, status")
      .eq("business_id", context.businessId)
      .eq("id", args.integrationId)
      .maybeSingle();
    if (!integration || !isCrmPullProvider(integration.provider_type)) {
      throw new ServiceError("NOT_FOUND", "That CRM connection could not be found.");
    }
    if (args.enabled && integration.status === "DISCONNECTED") {
      throw new ServiceError("CONFLICT", "Reconnect this CRM before switching the import on.");
    }

    const { data: existing } = await db()
      .from("crm_pull_settings")
      .select("enabled")
      .eq("integration_id", integration.id)
      .maybeSingle();
    const wasEnabled = Boolean((existing as { enabled?: boolean } | null)?.enabled);

    const { error } = await db()
      .from("crm_pull_settings")
      .upsert(
        {
          integration_id: integration.id,
          business_id: context.businessId,
          provider_type: integration.provider_type,
          enabled: args.enabled,
          updated_by: context.userId,
        },
        { onConflict: "integration_id" },
      );
    if (error) throw new ServiceError("UNAVAILABLE", "The CRM import setting could not be saved.");

    // Switching on starts from now: records changed while it was off, and the
    // CRM's history, are not imported. History is a CSV import, deliberately.
    if (args.enabled && !wasEnabled) {
      const { error: cursorError } = await admin.from("lead_source_cursors").upsert(
        {
          integration_id: integration.id,
          business_id: context.businessId,
          external_object_id: `crm:${integration.provider_type}`,
          cursor_value: serialiseCrmCursor(initialCrmCursor()),
          last_polled_at: null,
        },
        { onConflict: "integration_id" },
      );
      if (cursorError) throw new ServiceError("UNAVAILABLE", "The CRM import could not be started.");
    }

    return {
      data: { integrationId: integration.id, enabled: args.enabled },
      entityId: integration.id,
      before: { enabled: wasEnabled },
      after: { enabled: args.enabled },
    };
  },
});

/* ======================================================== WhatsApp templates */

export type WhatsAppStepView = {
  automationId: string;
  automationName: string;
  automationType: string;
  position: number;
  template: string;
  mapping: { templateId: string; variableMap: Record<string, string> } | null;
};

/** WhatsApp steps of each sequence's live (else draft) version. */
export async function whatsAppSteps(businessId: string): Promise<WhatsAppStepView[]> {
  const admin = createAdminClient();
  const { data: definitions, error } = await admin
    .from("automation_definitions")
    .select("id, name, type")
    .eq("business_id", businessId);
  if (error) throw new ServiceError("UNAVAILABLE", "Follow-up sequences could not be read.");
  if (!definitions?.length) return [];

  const { data: versions, error: versionError } = await admin
    .from("automation_versions")
    .select("id, automation_id, status")
    .eq("business_id", businessId)
    .in("automation_id", definitions.map((d) => d.id))
    .in("status", ["PUBLISHED", "DRAFT"]);
  if (versionError) throw new ServiceError("UNAVAILABLE", "Follow-up versions could not be read.");

  const versionFor = new Map<string, string>();
  for (const status of ["DRAFT", "PUBLISHED"]) {
    // PUBLISHED written last so it wins: the live sequence is what sends.
    for (const version of versions ?? []) {
      if (version.status === status) versionFor.set(version.automation_id, version.id);
    }
  }
  const versionIds = [...versionFor.values()];
  if (versionIds.length === 0) return [];

  const [{ data: steps, error: stepError }, mappings] = await Promise.all([
    admin
      .from("automation_steps")
      .select("version_id, position, channel, template")
      .eq("business_id", businessId)
      .in("version_id", versionIds)
      .eq("channel", "whatsapp")
      .order("position", { ascending: true }),
    listStepTemplates(businessId),
  ]);
  if (stepError) throw new ServiceError("UNAVAILABLE", "Follow-up steps could not be read.");

  const automationByVersion = new Map([...versionFor.entries()].map(([automationId, versionId]) => [versionId, automationId]));
  const definitionById = new Map(definitions.map((d) => [d.id, d]));
  const mappingKey = (automationId: string, position: number) => `${automationId}:${position}`;
  const mappingBy = new Map(mappings.map((m) => [mappingKey(m.automationId, m.stepPosition), m]));

  return (steps ?? []).flatMap((step) => {
    const automationId = automationByVersion.get(step.version_id);
    const definition = automationId ? definitionById.get(automationId) : undefined;
    if (!automationId || !definition) return [];
    const mapping = mappingBy.get(mappingKey(automationId, step.position));
    return [
      {
        automationId,
        automationName: definition.name,
        automationType: definition.type,
        position: step.position,
        template: step.template,
        mapping: mapping ? { templateId: mapping.templateId, variableMap: mapping.variableMap } : null,
      },
    ];
  });
}

function presentTemplate(template: WhatsAppTemplateRecord) {
  return {
    id: template.id,
    provider: template.provider,
    name: template.name,
    language: template.language,
    category: template.category,
    status: template.status,
    body: template.body,
    variables: template.variables,
    platform: template.businessId === null,
  };
}

defineOperation("whatsapp_template.list", {
  schema: z.object({}),
  async run({ context }: HandlerInput<Record<string, never>>) {
    const [templates, transport, steps] = await Promise.all([
      listWorkspaceTemplates(context.businessId),
      whatsAppTransportFor(context.businessId),
      whatsAppSteps(context.businessId),
    ]);
    return {
      data: {
        transport,
        // Only templates this workspace's transport can send are offered.
        templates: templates.filter((t) => t.provider === transport).map(presentTemplate),
        steps,
      },
    };
  },
});

defineOperation("whatsapp_template.sync", {
  schema: z.object({}),
  async run({
    context,
  }: HandlerInput<Record<string, never>>): Promise<{ data: { transport: string; result: unknown } }> {
    const transport = await whatsAppTransportFor(context.businessId);
    try {
      if (transport === "meta") {
        const meta = await syncMetaTemplates(context.businessId);
        return { data: { transport, result: meta } };
      }
      const twilio = await syncTwilioTemplates();
      return { data: { transport, result: twilio } };
    } catch {
      throw new ServiceError("PROVIDER_FAILED", "The WhatsApp provider could not be reached. Try again shortly.");
    }
  },
});

defineOperation("whatsapp_template.map_step", {
  schema: z.object({
    automationId: z.uuid(),
    stepPosition: z.number().int().min(1).max(100),
    templateId: z.uuid().nullable(),
    variableMap: z.record(z.string().min(1).max(40), z.string().min(1).max(60)).optional(),
  }),
  async run({
    args,
    context,
  }: HandlerInput<{
    automationId: string;
    stepPosition: number;
    templateId: string | null;
    variableMap?: Record<string, string>;
  }>): Promise<{
    data: { mapped: boolean; templateId?: string; category?: string };
    entityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }> {
    const { data: definition } = await createAdminClient()
      .from("automation_definitions")
      .select("id")
      .eq("business_id", context.businessId)
      .eq("id", args.automationId)
      .maybeSingle();
    if (!definition) throw new ServiceError("NOT_FOUND", "That follow-up sequence could not be found.");

    const { data: previous } = await db()
      .from("whatsapp_step_templates")
      .select("template_id, variable_map")
      .eq("business_id", context.businessId)
      .eq("automation_id", args.automationId)
      .eq("step_position", args.stepPosition)
      .maybeSingle();

    if (!args.templateId) {
      const { error } = await db()
        .from("whatsapp_step_templates")
        .delete()
        .eq("business_id", context.businessId)
        .eq("automation_id", args.automationId)
        .eq("step_position", args.stepPosition);
      if (error) throw new ServiceError("UNAVAILABLE", "The template could not be removed from the step.");
      return {
        data: { mapped: false },
        entityId: args.automationId,
        before: (previous as Record<string, unknown> | null) ?? null,
        after: null,
      };
    }

    const template = await loadTemplate(args.templateId);
    if (!template || (template.businessId !== null && template.businessId !== context.businessId)) {
      throw new ServiceError("NOT_FOUND", "That template could not be found.");
    }
    if (template.status !== "APPROVED") {
      throw new ServiceError("INVALID_INPUT", `"${template.name}" is not approved, so it cannot be sent.`);
    }
    if (template.provider !== (await whatsAppTransportFor(context.businessId))) {
      throw new ServiceError("INVALID_INPUT", "That template belongs to a different WhatsApp connection.");
    }

    const variableMap: Record<string, string> = {};
    for (const key of template.variables) {
      const source = args.variableMap?.[key];
      if (!source || !isTemplateVariableSource(source)) {
        throw new ServiceError("INVALID_INPUT", `Choose what fills {{${key}}}.`);
      }
      variableMap[key] = source;
    }

    const { error } = await db()
      .from("whatsapp_step_templates")
      .upsert(
        {
          business_id: context.businessId,
          automation_id: args.automationId,
          step_position: args.stepPosition,
          template_id: template.id,
          variable_map: variableMap,
          updated_by: context.userId,
        },
        { onConflict: "automation_id,step_position" },
      );
    if (error) throw new ServiceError("UNAVAILABLE", "The template could not be saved on the step.");

    return {
      data: { mapped: true, templateId: template.id, category: template.category },
      entityId: args.automationId,
      before: (previous as Record<string, unknown> | null) ?? null,
      after: { template_id: template.id, variable_map: variableMap },
    };
  },
});

/* ============================================================ meeting types */

function presentMeetingType(type: MeetingType) {
  return type;
}

defineOperation("meeting_type.list", {
  schema: z.object({ includeArchived: z.boolean().optional() }),
  async run({ args, context }: HandlerInput<{ includeArchived?: boolean }>) {
    const types = await listMeetingTypes(context.businessId, { includeArchived: args.includeArchived });
    return { data: { meetingTypes: types.map(presentMeetingType) } };
  },
});

const MEETING_COLUMNS =
  "id, name, duration_minutes, buffer_minutes, assignee_rule, eligible_user_ids, service_ids, specialisms, calendar_integration_id, is_default, active";

async function assertReferences(businessId: string, input: MeetingTypeInput) {
  const admin = createAdminClient();
  if (input.eligibleUserIds.length) {
    const { data, error } = await admin
      .from("business_members")
      .select("user_id")
      .eq("business_id", businessId)
      .eq("status", "active")
      .in("user_id", input.eligibleUserIds);
    if (error) throw new ServiceError("UNAVAILABLE", "Team members could not be checked.");
    if ((data ?? []).length !== new Set(input.eligibleUserIds).size) {
      throw new ServiceError("INVALID_INPUT", "Everyone chosen must be an active member of this workspace.");
    }
  }
  if (input.serviceIds.length) {
    const { data, error } = await admin
      .from("services")
      .select("id")
      .eq("business_id", businessId)
      .in("id", input.serviceIds);
    if (error) throw new ServiceError("UNAVAILABLE", "Services could not be checked.");
    if ((data ?? []).length !== new Set(input.serviceIds).size) {
      throw new ServiceError("INVALID_INPUT", "One of the chosen services no longer exists.");
    }
  }
  if (input.calendarIntegrationId) {
    const { data, error } = await admin
      .from("integrations")
      .select("id, provider_type")
      .eq("business_id", businessId)
      .eq("id", input.calendarIntegrationId)
      .maybeSingle();
    if (error) throw new ServiceError("UNAVAILABLE", "The calendar could not be checked.");
    if (!data || (data.provider_type !== "google_calendar" && data.provider_type !== "calendly")) {
      throw new ServiceError("INVALID_INPUT", "Choose a connected Google Calendar or Calendly.");
    }
  }
}

defineOperation("meeting_type.save", {
  schema: meetingTypeInputSchema,
  async run({ args, context }: HandlerInput<MeetingTypeInput>) {
    await assertReferences(context.businessId, args);

    let before: Record<string, unknown> | null = null;
    if (args.id) {
      const { data } = await db()
        .from("meeting_types")
        .select(MEETING_COLUMNS)
        .eq("business_id", context.businessId)
        .eq("id", args.id)
        .maybeSingle();
      if (!data) throw new ServiceError("NOT_FOUND", "That meeting type could not be found.");
      before = data as Record<string, unknown>;
    }

    // One default per workspace (a partial unique index enforces it too).
    if (args.isDefault) {
      let clear = db()
        .from("meeting_types")
        .update({ is_default: false })
        .eq("business_id", context.businessId)
        .eq("is_default", true);
      if (args.id) clear = clear.neq("id", args.id);
      const { error } = await clear;
      if (error) throw new ServiceError("UNAVAILABLE", "The default meeting type could not be changed.");
    }

    const row = {
      business_id: context.businessId,
      name: args.name,
      duration_minutes: args.durationMinutes,
      buffer_minutes: args.bufferMinutes,
      assignee_rule: args.assigneeRule,
      eligible_user_ids: [...new Set(args.eligibleUserIds)],
      service_ids: [...new Set(args.serviceIds)],
      specialisms: cleanSpecialisms(args.eligibleUserIds, args.specialisms),
      calendar_integration_id: args.calendarIntegrationId ?? null,
      is_default: args.isDefault,
      active: true,
    };

    const write = args.id
      ? db()
          .from("meeting_types")
          .update(row)
          .eq("business_id", context.businessId)
          .eq("id", args.id)
          .select(MEETING_COLUMNS)
          .single()
      : db()
          .from("meeting_types")
          .insert({ ...row, created_by: context.userId })
          .select(MEETING_COLUMNS)
          .single();
    const { data, error } = await write;
    if (error || !data) {
      throw new ServiceError(
        error?.code === "23505" ? "CONFLICT" : "UNAVAILABLE",
        error?.code === "23505"
          ? "Another meeting type is already the default."
          : "The meeting type could not be saved.",
      );
    }

    const saved = meetingTypeFromRow(data as Parameters<typeof meetingTypeFromRow>[0]);
    return { data: saved, entityId: saved.id, before, after: data as Record<string, unknown> };
  },
});

defineOperation("meeting_type.archive", {
  schema: z.object({ id: z.uuid() }),
  async run({ args, context }: HandlerInput<{ id: string }>) {
    const { data, error } = await db()
      .from("meeting_types")
      .update({ active: false, is_default: false })
      .eq("business_id", context.businessId)
      .eq("id", args.id)
      .select("id, name")
      .maybeSingle();
    if (error) throw new ServiceError("UNAVAILABLE", "The meeting type could not be archived.");
    if (!data) throw new ServiceError("NOT_FOUND", "That meeting type could not be found.");
    return {
      data: { id: args.id },
      entityId: args.id,
      before: { active: true },
      after: { active: false },
    };
  },
});
