import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTwilioContentTemplates } from "./twilio";
import { fetchMetaTemplates, usesWhatsAppCloudApi } from "./whatsapp";
import {
  normaliseCategory,
  normaliseMetaTemplate,
  normaliseStatus,
  normaliseTwilioContent,
  type TemplateProvider,
  type TemplateUpsert,
  type WhatsAppTemplateRecord,
} from "./whatsapp-templates";

/**
 * The WhatsApp template registry's server half (brief §45): syncing from
 * Twilio Content (the platform account every non-Cloud-API workspace sends
 * through) and from a workspace's own WhatsApp Business Account, and reading
 * templates and step mappings back for the send path and Settings.
 */

// whatsapp_templates / whatsapp_step_templates (0127) post-date the generated types.
function db(): SupabaseClient {
  return createAdminClient() as unknown as SupabaseClient;
}

const TEMPLATE_COLUMNS =
  "id, business_id, provider, external_id, name, language, category, status, body, variables";

type TemplateRow = {
  id: string;
  business_id: string | null;
  provider: string;
  external_id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string | null;
  variables: string[] | null;
};

function toRecord(row: TemplateRow): WhatsAppTemplateRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider === "meta" ? "meta" : "twilio",
    externalId: row.external_id,
    name: row.name,
    language: row.language,
    category: normaliseCategory(row.category),
    status: normaliseStatus(row.status),
    body: row.body,
    variables: row.variables ?? [],
  };
}

/** Which transport this workspace's WhatsApp goes through right now. */
export async function whatsAppTransportFor(businessId: string): Promise<TemplateProvider> {
  return (await usesWhatsAppCloudApi(businessId)) ? "meta" : "twilio";
}

async function upsertAll(
  scope: { businessId: string | null; provider: TemplateProvider },
  rows: TemplateUpsert[],
): Promise<{ synced: number; retired: number }> {
  const now = new Date().toISOString();
  if (rows.length > 0) {
    const { error } = await db()
      .from("whatsapp_templates")
      .upsert(
        rows.map((row) => ({
          business_id: row.businessId,
          provider: row.provider,
          external_id: row.externalId,
          name: row.name,
          language: row.language,
          category: row.category,
          status: row.status,
          body: row.body,
          variables: row.variables,
          synced_at: now,
        })),
        { onConflict: "business_id,provider,external_id" },
      );
    if (error) throw new Error(`WhatsApp templates could not be saved: ${error.message}`);
  }

  // A template the provider no longer lists cannot be sent: retire it rather
  // than delete it, so a step mapped to it shows why it stopped working.
  let retire = db()
    .from("whatsapp_templates")
    .update({ status: "DISABLED", synced_at: now })
    .eq("provider", scope.provider)
    .neq("status", "DISABLED")
    .lt("synced_at", now);
  retire = scope.businessId ? retire.eq("business_id", scope.businessId) : retire.is("business_id", null);
  const { data: retired, error: retireError } = await retire.select("id");
  if (retireError) throw new Error(`WhatsApp templates could not be retired: ${retireError.message}`);

  return { synced: rows.length, retired: (retired ?? []).length };
}

export type TemplateSyncResult = {
  twilio: { synced: number; retired: number } | "NOT_CONFIGURED";
  meta: { synced: number; retired: number } | "NOT_CONNECTED" | null;
};

/** The platform's Twilio Content templates (shared by every Twilio workspace). */
export async function syncTwilioTemplates(): Promise<TemplateSyncResult["twilio"]> {
  const items = await fetchTwilioContentTemplates();
  if (!items) return "NOT_CONFIGURED";
  const rows = items
    .map((item) => normaliseTwilioContent(item as Parameters<typeof normaliseTwilioContent>[0]))
    .filter((row): row is TemplateUpsert => row !== null);
  return upsertAll({ businessId: null, provider: "twilio" }, rows);
}

/** One workspace's own WhatsApp Business Account templates. */
export async function syncMetaTemplates(businessId: string): Promise<TemplateSyncResult["meta"]> {
  const items = await fetchMetaTemplates(businessId);
  if (!items) return "NOT_CONNECTED";
  const rows = items
    .map((item) => normaliseMetaTemplate(item, businessId))
    .filter((row): row is TemplateUpsert => row !== null);
  return upsertAll({ businessId, provider: "meta" }, rows);
}

/** Templates this workspace can see: the platform's Twilio ones and its own. */
export async function listWorkspaceTemplates(businessId: string): Promise<WhatsAppTemplateRecord[]> {
  const { data, error } = await db()
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .or(`business_id.is.null,business_id.eq.${businessId}`)
    .order("name", { ascending: true })
    .limit(500);
  if (error) throw new Error(`WhatsApp templates could not be read: ${error.message}`);
  return ((data ?? []) as TemplateRow[]).map(toRecord);
}

export async function loadTemplate(templateId: string): Promise<WhatsAppTemplateRecord | null> {
  const { data, error } = await db()
    .from("whatsapp_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("id", templateId)
    .maybeSingle();
  if (error) throw new Error(`WhatsApp template could not be read: ${error.message}`);
  return data ? toRecord(data as TemplateRow) : null;
}

export type StepTemplateMapping = {
  automationId: string;
  stepPosition: number;
  templateId: string;
  variableMap: Record<string, string>;
};

function toMapping(row: {
  automation_id: string;
  step_position: number;
  template_id: string;
  variable_map: unknown;
}): StepTemplateMapping {
  const raw = (row.variable_map ?? {}) as Record<string, unknown>;
  const variableMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) if (typeof value === "string") variableMap[key] = value;
  return {
    automationId: row.automation_id,
    stepPosition: row.step_position,
    templateId: row.template_id,
    variableMap,
  };
}

/** The template a follow-up step sends outside the window, if one is mapped. */
export async function stepTemplateFor(
  businessId: string,
  automationId: string,
  stepPosition: number,
): Promise<StepTemplateMapping | null> {
  const { data, error } = await db()
    .from("whatsapp_step_templates")
    .select("automation_id, step_position, template_id, variable_map")
    .eq("business_id", businessId)
    .eq("automation_id", automationId)
    .eq("step_position", stepPosition)
    .maybeSingle();
  if (error) throw new Error(`WhatsApp step template could not be read: ${error.message}`);
  return data ? toMapping(data as Parameters<typeof toMapping>[0]) : null;
}

export async function listStepTemplates(businessId: string): Promise<StepTemplateMapping[]> {
  const { data, error } = await db()
    .from("whatsapp_step_templates")
    .select("automation_id, step_position, template_id, variable_map")
    .eq("business_id", businessId)
    .limit(500);
  if (error) throw new Error(`WhatsApp step templates could not be read: ${error.message}`);
  return ((data ?? []) as Parameters<typeof toMapping>[0][]).map(toMapping);
}
