import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaChannelCapability, type MetaChannelCapability, type MetaMessagingChannel } from "./meta-capability";

/** The workspace's Meta messaging capability for one channel, read from its integration row. */
export async function getMetaChannelCapability(
  businessId: string,
  channel: MetaMessagingChannel,
): Promise<MetaChannelCapability> {
  const { data } = await createAdminClient()
    .from("integrations")
    .select("status, config, scopes")
    .eq("business_id", businessId)
    .eq("provider_type", "meta")
    .maybeSingle();
  const config = (data?.config ?? {}) as Record<string, unknown>;
  return metaChannelCapability(
    channel,
    data
      ? {
          connected: data.status !== "DISCONNECTED",
          pageId: typeof config.pageId === "string" ? config.pageId : null,
          instagramUserId: typeof config.instagramUserId === "string" ? config.instagramUserId : null,
          scopes: Array.isArray(data.scopes) ? (data.scopes as string[]) : null,
        }
      : null,
  );
}
