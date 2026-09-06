import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getEntitlements } from "@/lib/billing/entitlements";
import {
  NOT_AVAILABLE_REASON,
  PROVIDERS,
  type IntegrationObjectRecord,
  type IntegrationRecord,
  type ProviderBlock,
  type ProviderCardModel,
  type ProviderType,
} from "./catalog";

export type IntegrationsView = {
  cards: ProviderCardModel[];
  meta: { forms: IntegrationObjectRecord[]; pages: IntegrationObjectRecord[] };
  whatsappAvailableOnPlan: boolean;
  planName: string;
  /** Newest success/error timestamp across every connection, for the
   *  Connections health summary's "last check". */
  lastCheckedAt: string | null;
};

/**
 * Provider credentials are held by the platform, not the workspace, so a
 * provider is only offerable once the platform has been configured for it.
 * Reading process.env here keeps the answer honest without a code change.
 */
function platformConfigured(provider: ProviderType) {
  const definition = PROVIDERS.find((row) => row.id === provider);
  if (!definition) return false;
  // A `|`-separated entry means "any of these names will do", which is how a
  // provider that has been renamed upstream keeps working on a deployment
  // still using the older variable (see TikTok in the catalogue).
  return definition.requiredEnv.every((key) =>
    key.split("|").some((name) => Boolean(process.env[name.trim()])),
  );
}

export async function getIntegrationsView(
  businessId: string,
): Promise<IntegrationsView> {
  const supabase = await createClient();

  const [integrationsResult, objectsResult, entitlements] = await Promise.all([
    supabase
      .from("integrations")
      .select(
        "id, provider_type, status, external_account_id, display_name, last_success_at, last_error_at, last_error_message",
      )
      .eq("business_id", businessId),
    supabase
      .from("integration_objects")
      .select("id, object_type, external_id, name, enabled, integration_id")
      .eq("business_id", businessId)
      .order("name", { ascending: true }),
    getEntitlements(businessId),
  ]);

  const rows = integrationsResult.data ?? [];
  const objectRows = objectsResult.data ?? [];

  const mappingCounts = new Map<string, number>();
  if (objectRows.length > 0) {
    const { data: mappings } = await supabase
      .from("field_mappings")
      .select("integration_object_id")
      .eq("business_id", businessId);
    for (const mapping of mappings ?? []) {
      mappingCounts.set(
        mapping.integration_object_id,
        (mappingCounts.get(mapping.integration_object_id) ?? 0) + 1,
      );
    }
  }

  const byProvider = new Map<string, IntegrationRecord>();
  for (const row of rows) {
    byProvider.set(row.provider_type, {
      id: row.id,
      providerType: row.provider_type as ProviderType,
      status: row.status,
      externalAccountId: row.external_account_id,
      displayName: row.display_name,
      lastSuccessAt: row.last_success_at,
      lastErrorAt: row.last_error_at,
      lastErrorMessage: row.last_error_message,
    });
  }

  const toObject = (row: (typeof objectRows)[number]): IntegrationObjectRecord => ({
    id: row.id,
    objectType: row.object_type,
    externalId: row.external_id,
    name: row.name,
    enabled: row.enabled,
    mappedFieldCount: mappingCounts.get(row.id) ?? 0,
  });

  const cards: ProviderCardModel[] = PROVIDERS.map((definition) => {
    const integration = byProvider.get(definition.id) ?? null;
    const configured = platformConfigured(definition.id);

    if (definition.connection === "platform") {
      return {
        definition,
        integration,
        block: configured
          ? null
          : {
              kind: "unavailable",
              reason:
                "Client Turn has not finished configuring this service, so nothing is being sent through it yet.",
            },
        connected: configured && integration?.status !== "DISCONNECTED",
        status: configured
          ? (integration?.status ?? "HEALTHY")
          : "ACTION_REQUIRED",
      };
    }

    const connected = Boolean(integration) && integration!.status !== "DISCONNECTED";

    let block: ProviderBlock = null;
    if (definition.requiresFeature === "whatsapp" && !entitlements.whatsappEnabled) {
      block = {
        kind: "plan",
        reason: "WhatsApp is included on the Growth plan and above.",
      };
    } else if (!connected && (!configured || !definition.connectPath)) {
      block = { kind: "unavailable", reason: NOT_AVAILABLE_REASON };
    }

    return {
      definition,
      integration,
      block,
      connected,
      status: integration?.status ?? "DISCONNECTED",
    };
  });

  const metaIntegrationId = byProvider.get("meta")?.id ?? null;
  const metaObjects = objectRows.filter(
    (row) => row.integration_id === metaIntegrationId,
  );

  const timestamps = rows
    .flatMap((row) => [row.last_success_at, row.last_error_at])
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    cards,
    lastCheckedAt: timestamps.at(-1) ?? null,
    meta: {
      pages: metaObjects.filter((row) => row.object_type === "meta_page").map(toObject),
      forms: metaObjects.filter((row) => row.object_type === "meta_form").map(toObject),
    },
    whatsappAvailableOnPlan: entitlements.whatsappEnabled,
    planName: entitlements.plan,
  };
}
