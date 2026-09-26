import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import {
  googleAdsWebhookUrl,
  type CrmPushFailure,
  type ProviderExtras,
  type ProviderType,
} from "./catalog";

/**
 * The per-provider details the Connections drawer shows (tracker 8.23).
 *
 * Read with the service role because two of them live where the browser
 * client cannot reach: `integration_secrets` (the Google Ads webhook key, the
 * Meta token's expiry). That is exactly why the key is included only when the
 * caller is an admin -- it is a credential, and the Connections page is
 * readable by every member.
 *
 * Every read failure degrades to "not shown" for that provider rather than
 * breaking the page: these are details, and the cards above them still work.
 */
export async function loadProviderExtras(input: {
  businessId: string;
  canManage: boolean;
}): Promise<Partial<Record<ProviderType, ProviderExtras>>> {
  const admin = createAdminClient();
  const out: Partial<Record<ProviderType, ProviderExtras>> = {};

  const { data: integrations, error } = await admin
    .from("integrations")
    .select("id, provider_type, status, external_account_id, config")
    .eq("business_id", input.businessId)
    .neq("status", "DISCONNECTED");
  if (error) {
    console.error("[connections] extras: integrations read failed", error.message);
    return out;
  }

  const byType = new Map((integrations ?? []).map((row) => [row.provider_type, row]));

  /* ---- Google Ads: webhook URL + key, accessible accounts ---- */
  const googleAds = byType.get("google_ads");
  if (googleAds) {
    let webhookKey: string | null = null;
    if (input.canManage) {
      const { data, error: secretError } = await admin
        .from("integration_secrets")
        .select("webhook_secret")
        .eq("integration_id", googleAds.id)
        .maybeSingle();
      if (secretError) {
        console.error("[connections] extras: google key read failed", secretError.message);
      }
      webhookKey = data?.webhook_secret ?? null;
    }
    const config = (googleAds.config ?? {}) as { accessibleCustomerIds?: unknown };
    const accessible = Array.isArray(config.accessibleCustomerIds)
      ? config.accessibleCustomerIds.filter((id): id is string => typeof id === "string")
      : [];
    out.google_ads = {
      googleAds: {
        webhookUrl: googleAdsWebhookUrl(serverEnv.siteUrl, googleAds.id),
        webhookKey,
        customerId: googleAds.external_account_id,
        accessibleCustomerIds: accessible,
      },
    };
  }

  /* ---- Meta: Pages and token expiry ---- */
  const meta = byType.get("meta");
  if (meta) {
    const config = (meta.config ?? {}) as { pageId?: unknown; pages?: unknown };
    const pages = Array.isArray(config.pages)
      ? (config.pages as { id?: unknown; name?: unknown }[])
          .filter((page) => typeof page.id === "string")
          .map((page) => ({
            id: page.id as string,
            name: typeof page.name === "string" ? page.name : (page.id as string),
          }))
      : [];
    const { data: secret, error: secretError } = await admin
      .from("integration_secrets")
      .select("token_expires_at")
      .eq("integration_id", meta.id)
      .maybeSingle();
    if (secretError) {
      console.error("[connections] extras: meta expiry read failed", secretError.message);
    }
    out.meta = {
      meta: {
        pages,
        selectedPageId: typeof config.pageId === "string" ? config.pageId : null,
        tokenExpiresAt: secret?.token_expires_at ?? null,
      },
    };
  }

  /* ---- Slack: the alert channel (integrations.config.channel_id) ---- */
  const slack = byType.get("slack");
  if (slack) {
    const config = (slack.config ?? {}) as { channel_id?: unknown };
    out.slack = {
      slack: { channelId: typeof config.channel_id === "string" ? config.channel_id : null },
    };
  }

  /* ---- LinkedIn: which organisation, and whether page engagement is on ---- */
  const linkedin = byType.get("linkedin_ads");
  if (linkedin) {
    const config = (linkedin.config ?? {}) as { organizations?: unknown };
    const organizations = Array.isArray(config.organizations)
      ? (config.organizations as { id?: unknown; name?: unknown }[])
          .filter((org) => typeof org.id === "string")
          .map((org) => ({
            id: org.id as string,
            name: typeof org.name === "string" ? org.name : (org.id as string),
          }))
      : [];
    out.linkedin_ads = {
      linkedin: {
        organizations,
        selectedId: linkedin.external_account_id,
        pageEngagementEnabled: serverEnv.linkedinAds.communityManagementApproved === "true",
      },
    };
  }

  /* ---- CRMs: what was pushed, and what failed ---- */
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (const provider of ["hubspot", "zoho_crm", "salesforce"] as const) {
    if (!byType.get(provider)) continue;
    const [latest, recent, failed] = await Promise.all([
      admin
        .from("crm_push_records")
        .select("pushed_at")
        .eq("business_id", input.businessId)
        .eq("provider_type", provider)
        .not("pushed_at", "is", null)
        .order("pushed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("crm_push_records")
        .select("id", { count: "exact", head: true })
        .eq("business_id", input.businessId)
        .eq("provider_type", provider)
        .eq("status", "pushed")
        .gte("pushed_at", since),
      admin
        .from("crm_push_records")
        .select("lead_id, status, last_error, updated_at, leads(first_name, last_name, email)")
        .eq("business_id", input.businessId)
        .eq("provider_type", provider)
        .in("status", ["failed", "partial"])
        .order("updated_at", { ascending: false })
        .limit(5),
    ]);
    const readError = latest.error ?? recent.error ?? failed.error;
    if (readError) {
      console.error(`[connections] extras: ${provider} push status read failed`, readError.message);
      continue;
    }
    const failures: CrmPushFailure[] = (failed.data ?? []).map((row) => {
      const lead = row.leads as unknown as {
        first_name: string | null;
        last_name: string | null;
        email: string | null;
      } | null;
      const name =
        [lead?.first_name, lead?.last_name].filter(Boolean).join(" ") || lead?.email || "A lead";
      return {
        leadId: row.lead_id,
        leadName: name,
        status: row.status === "partial" ? "partial" : "failed",
        error: row.last_error,
        at: row.updated_at,
      };
    });
    out[provider] = {
      crm: {
        lastPushAt: latest.data?.pushed_at ?? null,
        pushedLast30Days: recent.count ?? 0,
        failures,
      },
    };
  }

  return out;
}
