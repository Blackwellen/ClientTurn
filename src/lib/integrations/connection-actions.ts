"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import {
  refreshMetaPages,
  selectMetaPage,
  type MetaPageOption,
} from "@/lib/integrations/providers/meta-lead-ads";

/**
 * Per-provider choices made after a connection exists (tracker 8.23): which
 * Google Ads account to read, which Meta Page to receive. Admin only, like
 * every other connection change.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const SETTINGS_PATH = "/app/settings";

async function admin() {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------- Google Ads */

/**
 * Chooses which Google Ads account leads are read from.
 *
 * Only an account the connection itself listed is accepted, so this cannot be
 * used to point a workspace at an account its Google sign-in cannot reach.
 * The poll cursor is reset so the new account's recent leads (last 24 hours)
 * are picked up rather than skipped past the old account's cursor.
 */
export async function selectGoogleAdsCustomerAction(input: unknown): Promise<Result> {
  const parsed = z.object({ customerId: z.string().regex(/^\d{6,12}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose one of the listed accounts." };

  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only owners and admins can change connections." };

  const db = createAdminClient();
  const { data: integration, error } = await db
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", workspace.businessId)
    .eq("provider_type", "google_ads")
    .maybeSingle();
  if (error || !integration || integration.status === "DISCONNECTED") {
    return { ok: false, error: "Google Ads is not connected." };
  }

  const config = (integration.config ?? {}) as { accessibleCustomerIds?: unknown };
  const accessible = Array.isArray(config.accessibleCustomerIds)
    ? (config.accessibleCustomerIds as unknown[])
    : [];
  if (!accessible.includes(parsed.data.customerId)) {
    return {
      ok: false,
      error: "That account is not one this Google sign-in can reach. Reconnect Google Ads to refresh the list.",
    };
  }

  const { error: writeError } = await db
    .from("integrations")
    .update({
      external_account_id: parsed.data.customerId,
      display_name: `Google Ads account ${parsed.data.customerId}`,
    })
    .eq("id", integration.id)
    .eq("business_id", workspace.businessId);
  if (writeError) return { ok: false, error: "The account choice could not be saved." };

  const { error: cursorError } = await db
    .from("lead_source_cursors")
    .delete()
    .eq("integration_id", integration.id);
  if (cursorError) console.error("[google_ads] cursor reset failed", cursorError.message);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.connected",
    entityType: "integration",
    entityId: integration.id,
    metadata: { provider: "google_ads", customerId: parsed.data.customerId, change: "account" },
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* ---------------------------------------------------------------- LinkedIn */

/**
 * Chooses which LinkedIn organisation's lead forms (and, once approved, page
 * engagement) this workspace reads. Only an organisation the member
 * administered at connect time is accepted.
 */
export async function selectLinkedInOrganizationAction(input: unknown): Promise<Result> {
  const parsed = z.object({ organizationId: z.string().regex(/^\d{1,20}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose one of the listed organisations." };

  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only owners and admins can change connections." };

  const db = createAdminClient();
  const { data: integration, error } = await db
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", workspace.businessId)
    .eq("provider_type", "linkedin_ads")
    .maybeSingle();
  if (error || !integration || integration.status === "DISCONNECTED") {
    return { ok: false, error: "LinkedIn is not connected." };
  }

  const config = (integration.config ?? {}) as Record<string, unknown>;
  const organizations = Array.isArray(config.organizations)
    ? (config.organizations as { id?: unknown; name?: unknown; urn?: unknown }[])
    : [];
  const chosen = organizations.find((org) => org.id === parsed.data.organizationId);
  if (!chosen) {
    return {
      ok: false,
      error: "That organisation is not one this LinkedIn sign-in administers. Reconnect LinkedIn to refresh the list.",
    };
  }

  const { error: writeError } = await db
    .from("integrations")
    .update({
      external_account_id: parsed.data.organizationId,
      display_name: typeof chosen.name === "string" ? chosen.name : null,
      config: {
        ...config,
        organizationUrn:
          typeof chosen.urn === "string"
            ? chosen.urn
            : `urn:li:organization:${parsed.data.organizationId}`,
      } as never,
    })
    .eq("id", integration.id)
    .eq("business_id", workspace.businessId);
  if (writeError) return { ok: false, error: "The organisation choice could not be saved." };

  const { error: cursorError } = await db
    .from("lead_source_cursors")
    .delete()
    .eq("integration_id", integration.id);
  if (cursorError) console.error("[linkedin_ads] cursor reset failed", cursorError.message);

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "integration.connected",
    entityType: "integration",
    entityId: integration.id,
    metadata: { provider: "linkedin_ads", organizationId: parsed.data.organizationId, change: "organization" },
  });

  revalidatePath(SETTINGS_PATH);
  return { ok: true };
}

/* -------------------------------------------------------------------- Meta */

async function metaIntegrationId(businessId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("integrations")
    .select("id, status")
    .eq("business_id", businessId)
    .eq("provider_type", "meta")
    .maybeSingle();
  if (error || !data || data.status === "DISCONNECTED") return null;
  return data.id;
}

/** Re-reads the Pages this Meta connection manages. */
export async function loadMetaPagesAction(): Promise<Result<MetaPageOption[]>> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only owners and admins can change connections." };
  const integrationId = await metaIntegrationId(workspace.businessId);
  if (!integrationId) return { ok: false, error: "Meta is not connected." };

  try {
    const pages = await refreshMetaPages({ businessId: workspace.businessId, integrationId });
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: pages };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Your Pages could not be loaded.",
    };
  }
}

/** Switches which Page leads and messages are received for. */
export async function selectMetaPageAction(input: unknown): Promise<Result<{ name: string }>> {
  const parsed = z.object({ pageId: z.string().regex(/^\d{3,30}$/) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose one of the listed Pages." };

  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only owners and admins can change connections." };
  const integrationId = await metaIntegrationId(workspace.businessId);
  if (!integrationId) return { ok: false, error: "Meta is not connected." };

  try {
    const result = await selectMetaPage({
      businessId: workspace.businessId,
      integrationId,
      pageId: parsed.data.pageId,
    });
    if (!result.ok) return result;

    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "integration.connected",
      entityType: "integration",
      entityId: integrationId,
      metadata: { provider: "meta", pageId: parsed.data.pageId, change: "page" },
    });

    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: { name: result.name } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "The Page could not be switched.",
    };
  }
}
