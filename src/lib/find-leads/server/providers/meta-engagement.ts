import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type ProviderResponse,
  type SocialEngagementCandidate,
  type SourcingProvider,
} from "./types";

/**
 * Meta engagement: people who talked to your Facebook Page or Instagram
 * account.
 *
 * This is the route that is easy to miss, and it is the strongest one Meta
 * offers. It has nothing to do with lead forms: the Graph API will tell you who
 * messaged your Page, who commented on your posts and who mentioned you — real,
 * named people who chose to interact with the business. For a UK home-service
 * firm that is often a better prospect than anything a cold database returns,
 * because the person came to *them*.
 *
 * Three properties make it lawful and safe, and all three are structural here:
 *
 *   * it reads **only the workspace's own connected Page and IG account**, with
 *     the Page access token that workspace granted — there is no way to point
 *     it at somebody else's audience;
 *   * it returns **no email and no phone**, because Meta does not expose them
 *     for engagers. What comes back is a platform-scoped id and a display name;
 *   * a person who messaged you can be replied to **on that thread**, which is
 *     the channel they opened. Contactability still decides that at send time —
 *     this adapter records what happened, it does not grant permission.
 *
 * The people it returns are Prospects, not Leads. They engaged, but nobody has
 * qualified them, and §11.19 keeps promotion a human decision.
 */

type ConversationsResponse = {
  data?: {
    id?: string;
    updated_time?: string;
    participants?: { data?: { id?: string; name?: string; email?: string }[] };
    messages?: { data?: { message?: string; created_time?: string }[] };
  }[];
  paging?: { cursors?: { after?: string } };
};

type CommentsResponse = {
  data?: {
    id?: string;
    message?: string;
    created_time?: string;
    permalink_url?: string;
    from?: { id?: string; name?: string };
  }[];
  paging?: { cursors?: { after?: string } };
};

type ConnectedMetaAccount = {
  pageId: string;
  pageToken: string;
  instagramUserId: string | null;
};

/**
 * The workspace's connected Page.
 *
 * Read from `integrations`, so a workspace that has not connected Meta gets
 * nothing rather than an error — and, critically, one workspace's token can
 * never be used to read another's audience.
 */
async function connectedAccount(businessId: string): Promise<ConnectedMetaAccount | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", "meta")
    .maybeSingle();

  if (!data || data.status === "DISCONNECTED") return null;

  const config = (data.config ?? {}) as Record<string, unknown>;

  // Tokens live in `integration_secrets`, never on the integration row — the
  // row is readable by the workspace, the secret is not.
  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", data.id)
    .maybeSingle();

  const pageId = typeof config.pageId === "string" ? config.pageId : null;
  const pageToken = secret?.access_token ?? null;

  if (!pageId || !pageToken) return null;

  return {
    pageId,
    pageToken,
    instagramUserId:
      typeof config.instagramUserId === "string" ? config.instagramUserId : null,
  };
}

function excerptOf(text: string | undefined | null): string | null {
  const trimmed = (text ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  // Enough to classify intent, short enough that we are not warehousing
  // somebody's message history.
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
}

async function fetchEngagement(input: {
  businessId: string;
  since: string | null;
  limit: number;
}): Promise<ProviderResponse<SocialEngagementCandidate>> {
  const account = await connectedAccount(input.businessId);
  if (!account) return unconfigured<SocialEngagementCandidate>();

  const limit = Math.min(Math.max(input.limit, 1), 100);
  const records: SocialEngagementCandidate[] = [];
  let latencyMs = 0;

  /* ------------------------------------------------- Page and IG messages */
  const conversationParams = new URLSearchParams({
    access_token: account.pageToken,
    fields: "id,updated_time,participants,messages.limit(1){message,created_time}",
    limit: String(limit),
  });
  if (input.since) conversationParams.set("since", input.since);

  const conversations = await providerJson<ConversationsResponse>({
    url: `https://graph.facebook.com/v21.0/${account.pageId}/conversations?${conversationParams.toString()}`,
  });

  if (!conversations.ok) {
    // Auth failure is worth surfacing: it means the Page token was revoked and
    // the connection needs attention, not that the audience is empty.
    return providerFailure<SocialEngagementCandidate>(
      conversations.code,
      conversations.latencyMs,
    );
  }
  latencyMs += conversations.latencyMs;

  for (const thread of conversations.data.data ?? []) {
    // The Page is a participant in its own threads. The other party is the
    // person; including ourselves would create a prospect for the business.
    const person = thread.participants?.data?.find(
      (participant) => participant.id && participant.id !== account.pageId,
    );
    if (!person?.id) continue;

    records.push({
      externalId: `meta_psid:${person.id}`,
      platform: "FACEBOOK",
      engagement: "MESSAGE",
      displayName: person.name?.trim() || null,
      companyName: null,
      profileUrl: null,
      excerpt: excerptOf(thread.messages?.data?.[0]?.message),
      occurredAt: thread.updated_time ?? null,
      sourceReference: thread.id ?? null,
    });
  }

  /* --------------------------------------------------------- Page comments */
  const commentParams = new URLSearchParams({
    access_token: account.pageToken,
    fields: "id,message,created_time,permalink_url,from",
    limit: String(limit),
  });
  if (input.since) commentParams.set("since", input.since);

  const comments = await providerJson<CommentsResponse>({
    url: `https://graph.facebook.com/v21.0/${account.pageId}/feed?${commentParams.toString()}`,
  });

  if (comments.ok) {
    latencyMs += comments.latencyMs;
    for (const comment of comments.data.data ?? []) {
      const from = comment.from;
      if (!from?.id || from.id === account.pageId) continue;

      records.push({
        externalId: `meta_psid:${from.id}`,
        platform: "FACEBOOK",
        engagement: "COMMENT",
        displayName: from.name?.trim() || null,
        companyName: null,
        profileUrl: comment.permalink_url ?? null,
        excerpt: excerptOf(comment.message),
        occurredAt: comment.created_time ?? null,
        sourceReference: comment.id ?? null,
      });
    }
  }
  // A comments failure is not fatal — the messages above are already worth
  // returning, and failing the whole batch would lose them.

  /* ----------------------------------------------------- Instagram comments */
  if (account.instagramUserId) {
    const igParams = new URLSearchParams({
      access_token: account.pageToken,
      fields: "id,comments{id,text,timestamp,username,from},permalink,timestamp",
      limit: String(limit),
    });

    const igMedia = await providerJson<{
      data?: {
        id?: string;
        permalink?: string;
        comments?: {
          data?: {
            id?: string;
            text?: string;
            timestamp?: string;
            username?: string;
            from?: { id?: string; username?: string };
          }[];
        };
      }[];
    }>({
      url: `https://graph.facebook.com/v21.0/${account.instagramUserId}/media?${igParams.toString()}`,
    });

    if (igMedia.ok) {
      latencyMs += igMedia.latencyMs;
      for (const media of igMedia.data.data ?? []) {
        for (const comment of media.comments?.data ?? []) {
          const id = comment.from?.id ?? comment.id;
          if (!id) continue;

          const username = comment.from?.username ?? comment.username ?? null;
          records.push({
            externalId: `meta_igsid:${id}`,
            platform: "INSTAGRAM",
            engagement: "COMMENT",
            displayName: username,
            companyName: null,
            profileUrl: username ? `https://instagram.com/${username}` : (media.permalink ?? null),
            excerpt: excerptOf(comment.text),
            occurredAt: comment.timestamp ?? null,
            sourceReference: comment.id ?? media.id ?? null,
          });
        }
      }
    }
  }

  // One person may have messaged and commented. They are one prospect, and the
  // strongest engagement wins — a DM is a better basis for replying than a
  // public comment.
  const strength: Record<SocialEngagementCandidate["engagement"], number> = {
    MESSAGE: 3,
    MENTION: 2,
    COMMENT: 1,
    REACTION: 0,
  };
  const byPerson = new Map<string, SocialEngagementCandidate>();
  for (const record of records) {
    const existing = byPerson.get(record.externalId);
    if (!existing || strength[record.engagement] > strength[existing.engagement]) {
      byPerson.set(record.externalId, record);
    }
  }

  return {
    ok: true,
    records: [...byPerson.values()],
    costMinor: 0,
    cursor: conversations.data.paging?.cursors?.after ?? null,
    latencyMs,
    errorCode: null,
  };
}

export const metaEngagementProvider: SourcingProvider = {
  key: "meta_engagement",
  displayName: "Facebook & Instagram engagement",
  capabilities: ["SOCIAL_ENGAGEMENT"],
  costRank: 0,
  // Your own audience through your own connected Page. Meta does not invoice
  // for reading it, so a run is not charged.
  freeOfCharge: true,
  // Per-workspace, not per-deployment: whether this can run depends on whether
  // *that* workspace connected a Page, which `fetchEngagement` resolves.
  configured: () => true,
  fetchEngagement,
};
