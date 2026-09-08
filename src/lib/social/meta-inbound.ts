import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaSendingAccount } from "@/lib/messaging/meta";
import { platformIdFrom, type InboundMessage, type MetaChannel } from "@/lib/messaging/types";

/**
 * Turning an inbound Meta direct message into something the agent can work.
 *
 * The whole social flow narrows to one moment, and this is it. Everything
 * before a reply is deterministic sequencing against a Prospect; the instant
 * somebody writes back they have stopped being someone we found and become
 * someone who contacted us — which is `lead-routes.ts`'s definition of a Lead —
 * so the record is promoted, the thread becomes a real conversation, and the
 * existing agent runtime takes it from there.
 *
 * Three rules this module exists to hold:
 *
 *   **The Page identifies the workspace.** Not the sender, not a heuristic.
 *   A message whose recipient Page matches no connected integration is dropped,
 *   because guessing which workspace might want it would file a stranger's
 *   enquiry in somebody's pipeline.
 *
 *   **The thread address is the identity.** A display name is not unique and
 *   changes; a PSID or IGSID does not. `conversations.external_thread_id` holds
 *   it, and it is what a second message on the same thread matches on, so a
 *   conversation is never forked into two.
 *
 *   **A first message creates a Lead, not a Prospect.** Someone who opens a
 *   conversation with a business has asked to be answered. That is the same act
 *   as submitting a lead form, and the product treats it the same way — which
 *   is exactly why it does *not* apply to a comment or a like, and why
 *   `engagement-ingest` sends those to a human instead.
 */

export type SocialThreadResolution = {
  businessId: string;
  leadId: string;
  conversationId: string;
  /** True when this message created the lead, so the caller can attribute it. */
  created: boolean;
};

/**
 * The workspace whose Page received this message.
 *
 * Meta addresses the recipient by Page id (Messenger) or Instagram account id
 * (Direct). Both live on the same integration row, so one lookup covers both,
 * and a disconnected integration matches nothing.
 */
export async function resolveMetaBusinessId(
  message: InboundMessage,
): Promise<string | null> {
  const recipientId = platformIdFrom(message.to);
  if (!recipientId) return null;

  const admin = createAdminClient();

  const column =
    message.channel === "instagram" ? "config->>instagramUserId" : "config->>pageId";

  const { data } = await admin
    .from("integrations")
    .select("business_id")
    .eq("provider_type", "meta")
    .eq(column, recipientId)
    .neq("status", "DISCONNECTED")
    .maybeSingle();

  return data?.business_id ?? null;
}

/**
 * The person's public profile, as Meta will tell us.
 *
 * Best-effort by design: this decorates a record that is already usable without
 * it, so every failure path returns nulls rather than throwing. Meta returns no
 * email and no phone for a messaging contact — only a name and a picture — and
 * that limit is the reason a social lead still has to be qualified through
 * conversation rather than enriched into one.
 */
async function fetchProfile(
  businessId: string,
  channel: MetaChannel,
  platformId: string,
): Promise<{ name: string | null; handle: string | null; avatarUrl: string | null }> {
  const empty = { name: null, handle: null, avatarUrl: null };

  const account = await metaSendingAccount(businessId);
  if (!account) return empty;

  const fields =
    channel === "instagram" ? "name,username,profile_pic" : "first_name,last_name,profile_pic";

  try {
    const response = await fetch(
      `https://graph.facebook.com/v21.0/${platformId}?fields=${fields}&access_token=${encodeURIComponent(account.pageToken)}`,
    );
    if (!response.ok) return empty;

    const data = (await response.json()) as {
      name?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
      profile_pic?: string;
    };

    const name =
      data.name?.trim() ||
      [data.first_name, data.last_name].filter(Boolean).join(" ").trim() ||
      null;

    return {
      name: name || null,
      handle: data.username?.trim() || null,
      avatarUrl: data.profile_pic ?? null,
    };
  } catch {
    // A profile lookup failing must not lose the message. The conversation is
    // perfectly workable with no name at all.
    return empty;
  }
}

function nameParts(name: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: null, lastName: null };

  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };

  // Everything after the first token is the surname. Splitting a three-part
  // name any other way is guesswork, and guessing is what this pipeline is
  // built not to do.
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Meta's profile picture URLs are signed and short-lived.
 *
 * Meta does not state the lifetime in the response, so this is a deliberate
 * under-estimate: a URL treated as expired early costs one refetch, whereas one
 * treated as live after it lapses renders a broken image on the record a
 * customer is looking at.
 */
const AVATAR_TTL_HOURS = 24;

/**
 * Finds the thread this message belongs to, creating the lead and conversation
 * the first time somebody writes.
 *
 * Idempotent on the thread address, which is what makes it safe under Meta's
 * retry policy: a redelivered first message finds the conversation the first
 * delivery created and returns it rather than creating a second lead.
 */
export async function resolveSocialThread(
  message: InboundMessage,
  businessId: string,
): Promise<SocialThreadResolution | null> {
  const channel = message.channel as MetaChannel;
  const senderId = platformIdFrom(message.from);
  if (!senderId) return null;

  const admin = createAdminClient();

  /* ---------------------------------------------- an existing conversation */
  const { data: existing } = await admin
    .from("conversations")
    .select("id, lead_id")
    .eq("business_id", businessId)
    .eq("external_thread_id", message.from)
    .maybeSingle();

  if (existing?.lead_id) {
    return {
      businessId,
      leadId: existing.lead_id,
      conversationId: existing.id,
      created: false,
    };
  }

  /* --------------------------------------------------------- a new enquiry */
  const profile = await fetchProfile(businessId, channel, senderId);
  const { firstName, lastName } = nameParts(profile.name);

  const platform = channel === "instagram" ? "INSTAGRAM" : "FACEBOOK";

  // A prospect may already exist for this person — `engagement-ingest` creates
  // one when they comment, and the assisted outreach queue creates one when we
  // find them. Finding it here is what makes "they replied to our opener" a
  // promotion rather than a second, unrelated record.
  const { data: prospect } = await admin
    .from("prospects")
    .select("id, first_name, last_name, promoted_to_lead_id")
    .eq("business_id", businessId)
    .eq("social_platform", platform)
    .eq("social_external_id", senderId)
    .maybeSingle();

  if (prospect?.promoted_to_lead_id) {
    // Already a lead, but with no conversation on this channel yet — they
    // replied on Instagram to an approach made on Facebook, say.
    const conversationId = await createThread({
      businessId,
      leadId: prospect.promoted_to_lead_id,
      channel,
      threadAddress: message.from,
      profile,
    });
    return conversationId
      ? { businessId, leadId: prospect.promoted_to_lead_id, conversationId, created: false }
      : null;
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      business_id: businessId,
      // The platform id, not the display name: this is what makes a
      // redelivered webhook collide on the unique index rather than create a
      // second lead.
      external_id: `meta:${channel}:${senderId}`,
      first_name: firstName ?? prospect?.first_name ?? null,
      last_name: lastName ?? prospect?.last_name ?? null,
      status: "NEW",
      // No `source` column is set: `leads.source_id` is a foreign key to a
      // configured lead source, and inventing one for an inbound DM would
      // create a source row nobody configured. Where the enquiry came from is
      // recorded on the conversation's channel and in `external_id`, both of
      // which are exact.
    })
    .select("id")
    .single();

  let leadId = lead?.id ?? null;

  if (error?.code === "23505") {
    // A concurrent delivery won the race. Its lead is the right one.
    const { data: raced } = await admin
      .from("leads")
      .select("id")
      .eq("business_id", businessId)
      .eq("external_id", `meta:${channel}:${senderId}`)
      .maybeSingle();
    leadId = raced?.id ?? null;
  } else if (error) {
    throw error;
  }

  if (!leadId) return null;

  if (prospect) {
    await admin
      .from("prospects")
      .update({ promoted_to_lead_id: leadId, promoted_at: new Date().toISOString() })
      .eq("id", prospect.id)
      .eq("business_id", businessId);
  }

  const conversationId = await createThread({
    businessId,
    leadId,
    channel,
    threadAddress: message.from,
    profile,
  });

  if (!conversationId) return null;

  return { businessId, leadId, conversationId, created: true };
}

async function createThread(input: {
  businessId: string;
  leadId: string;
  channel: MetaChannel;
  threadAddress: string;
  profile: { name: string | null; handle: string | null; avatarUrl: string | null };
}): Promise<string | null> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("conversations")
    .insert({
      business_id: input.businessId,
      lead_id: input.leadId,
      channel: input.channel,
      external_thread_id: input.threadAddress,
      counterparty_name: input.profile.name,
      counterparty_handle: input.profile.handle,
      counterparty_avatar_url: input.profile.avatarUrl,
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    const { data: raced } = await admin
      .from("conversations")
      .select("id")
      .eq("business_id", input.businessId)
      .eq("external_thread_id", input.threadAddress)
      .maybeSingle();
    return raced?.id ?? null;
  }

  if (!data) return null;

  // Mirror the profile onto the prospect, where one exists, so the Find Leads
  // list shows the same face as the inbox rather than falling back to initials
  // on one surface and not the other.
  if (input.profile.avatarUrl) {
    await admin
      .from("prospects")
      .update({
        avatar_url: input.profile.avatarUrl,
        avatar_source: input.channel === "instagram" ? "INSTAGRAM" : "FACEBOOK",
        avatar_expires_at: new Date(Date.now() + AVATAR_TTL_HOURS * 3600_000).toISOString(),
      })
      .eq("business_id", input.businessId)
      .eq("promoted_to_lead_id", input.leadId);
  }

  return data.id;
}
