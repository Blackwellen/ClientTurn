import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getV4Entitlements } from "@/lib/billing/v4-entitlements";
import { providersFor, unhealthyProviders } from "./providers/registry";
import type { SocialEngagementCandidate } from "./providers/types";

/**
 * Turning your own audience into prospects (V4 §12, §15.5).
 *
 * Someone who messaged your Page, commented on your post or mentioned you is a
 * better prospect than anything a cold database will sell you — they came to
 * *you*. This is the job that notices them.
 *
 * Three decisions worth stating, because each one is the difference between a
 * useful feature and a liability:
 *
 *   **They become Prospects, not Leads.** Engaging with a post is not asking to
 *   be sold to. §11.19 keeps promotion a human decision, and a commenter who
 *   landed straight in the conversion engine would get an automated sales
 *   sequence they never asked for.
 *
 *   **Eligibility starts at REVIEW, not ELIGIBLE.** We have a platform-scoped id
 *   and a display name — no email, no company, often no surname. That is not
 *   enough to establish who they are or whether they may be contacted, so a
 *   person decides. The one exception is a direct message: opening a
 *   conversation with a business is a clearer invitation than liking a photo.
 *
 *   **Nothing is invented to fill the gaps.** A commenter with a username and
 *   nothing else is stored as exactly that. Guessing an employer from a display
 *   name would produce a confident-looking record that is wrong.
 */

export type IngestOutcome = {
  ok: boolean;
  error: string | null;
  created: number;
  updated: number;
  skipped: number;
};

/** How far back a first run looks. Later runs use the stored cursor. */
const FIRST_RUN_WINDOW_DAYS = 30;

/**
 * The newest engagement this provider has already produced a prospect from.
 *
 * Falls back to a bounded first-run window rather than to the beginning of
 * time: a Page with ten years of comments should not spend its first run
 * ingesting a decade of them.
 */
async function highWaterMark(businessId: string, providerKey: string): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("prospect_data_sources")
    .select("obtained_at")
    .eq("business_id", businessId)
    .eq("provider", providerKey)
    .eq("field_name", "social_identity")
    .order("obtained_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    data?.obtained_at ??
    new Date(Date.now() - FIRST_RUN_WINDOW_DAYS * 864e5).toISOString()
  );
}

function displayNameParts(name: string | null): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = (name ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return { firstName: null, lastName: null };

  const parts = trimmed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: null };

  // Everything after the first token is the surname. Splitting a three-part
  // name any other way is guesswork, and the whole point here is not to guess.
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * A direct message is a stronger basis for replying than a public comment.
 *
 * Somebody who opened a conversation with a business plainly expects an answer
 * on that thread. A comment on a post is not that, so it goes to a human.
 */
function eligibilityFor(candidate: SocialEngagementCandidate): {
  eligibility: "ELIGIBLE" | "REVIEW";
  reason: string;
} {
  if (candidate.engagement === "MESSAGE") {
    return {
      eligibility: "ELIGIBLE",
      reason:
        "They opened a conversation with your account, so replying on that thread is expected.",
    };
  }
  return {
    eligibility: "REVIEW",
    reason:
      "They engaged publicly rather than contacting you. Confirm who they are before reaching out.",
  };
}

/**
 * Runs the engagement providers for a workspace and records what they find.
 *
 * Idempotent per person: the platform id is the dedupe key, so a candidate seen
 * on three posts produces one prospect, and re-running the job updates the
 * existing record rather than creating a second.
 */
export async function ingestSocialEngagement(
  businessId: string,
  limit = 100,
): Promise<IngestOutcome> {
  const entitlements = await getV4Entitlements(businessId);
  if (!entitlements.sourcingEnabled) {
    return {
      ok: false,
      error: "Find Leads is not on this workspace's plan.",
      created: 0,
      updated: 0,
      skipped: 0,
    };
  }

  const unhealthy = await unhealthyProviders();
  const providers = providersFor("SOCIAL_ENGAGEMENT", unhealthy).filter(
    (provider) => typeof provider.fetchEngagement === "function",
  );

  if (providers.length === 0) {
    return {
      ok: false,
      error: "No social account is connected to read engagement from.",
      created: 0,
      updated: 0,
      skipped: 0,
    };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const provider of providers) {
    // The high-water mark is derived from what was actually ingested rather
    // than stored in a cursor row. `lead_source_cursors` is keyed one-per-
    // integration, which the Meta lead poller already owns — a second writer
    // would fight it. More importantly, a derived mark cannot drift: if a batch
    // half-wrote, the newest row is genuinely the newest row, and the next run
    // picks up from exactly there.
    const since = await highWaterMark(businessId, provider.key);

    let response;
    try {
      response = await provider.fetchEngagement!({ businessId, since, limit });
    } catch {
      // An adapter that throws must not take the whole job with it — the other
      // providers still have work to do.
      continue;
    }

    if (!response.ok) continue;

    let newest = since;

    for (const candidate of response.records) {
      const result = await upsertEngagementProspect(businessId, provider.key, candidate);
      if (result === "created") created += 1;
      else if (result === "updated") updated += 1;
      else skipped += 1;

      if (candidate.occurredAt && candidate.occurredAt > newest) {
        newest = candidate.occurredAt;
      }
    }

    // `newest` is only used for logging — the next run re-derives its own mark
    // from the rows that were actually written, which is the point.
    void newest;
  }

  return { ok: true, error: null, created, updated, skipped };
}

async function upsertEngagementProspect(
  businessId: string,
  providerKey: string,
  candidate: SocialEngagementCandidate,
): Promise<"created" | "updated" | "skipped"> {
  const admin = createAdminClient();

  // The platform id is the identity. A display name is not unique and changes.
  const { data: existing } = await admin
    .from("prospect_data_sources")
    .select("prospect_id")
    .eq("business_id", businessId)
    .eq("field_name", "social_identity")
    .eq("provider", providerKey)
    .eq("provider_entity_id", candidate.externalId)
    .maybeSingle();

  const { eligibility, reason } = eligibilityFor(candidate);
  const now = new Date().toISOString();

  if (existing?.prospect_id) {
    // Re-engagement is worth recording — it is fresh evidence of interest — but
    // it must never reopen a prospect somebody suppressed.
    await admin
      .from("prospects")
      .update({ last_activity_at: candidate.occurredAt ?? now })
      .eq("business_id", businessId)
      .eq("id", existing.prospect_id)
      .neq("outreach_eligibility", "SUPPRESSED");

    return "updated";
  }

  const { firstName, lastName } = displayNameParts(candidate.displayName);
  if (!firstName && !candidate.profileUrl) {
    // Nothing to identify them by at all. Storing this would create a prospect
    // nobody could ever act on.
    return "skipped";
  }

  const { data: prospect, error } = await admin
    .from("prospects")
    .insert({
      business_id: businessId,
      first_name: firstName,
      last_name: lastName,
      role_classification: "UNKNOWN",
      status: eligibility === "ELIGIBLE" ? "READY" : "REVIEW",
      outreach_eligibility: eligibility,
      eligibility_reason: reason,
      source_provider: providerKey,
      linkedin_url: candidate.platform === "LINKEDIN" ? candidate.profileUrl : null,
      subscriber_type: "UNKNOWN",
      verification_status: "UNKNOWN",
      last_activity_at: candidate.occurredAt ?? now,
    })
    .select("id")
    .single();

  if (error || !prospect) return "skipped";

  // Provenance, including the id that makes the next run idempotent.
  await admin.from("prospect_data_sources").insert([
    {
      business_id: businessId,
      prospect_id: prospect.id,
      field_name: "social_identity",
      value_json: {
        value: candidate.displayName ?? candidate.externalId,
        platform: candidate.platform,
        engagement: candidate.engagement,
      } as never,
      provider: providerKey,
      provider_entity_id: candidate.externalId,
      source_type: "FIRST_PARTY",
      source_url: candidate.profileUrl,
      confidence: 0.95,
      obtained_at: candidate.occurredAt ?? now,
      verified_at: candidate.occurredAt ?? now,
    },
    ...(candidate.excerpt
      ? [
          {
            business_id: businessId,
            prospect_id: prospect.id,
            field_name: "engagement_excerpt",
            value_json: { value: candidate.excerpt } as never,
            provider: providerKey,
            provider_entity_id: candidate.sourceReference,
            source_type: "FIRST_PARTY" as const,
            source_url: candidate.profileUrl,
            confidence: 1,
            obtained_at: candidate.occurredAt ?? now,
          },
        ]
      : []),
  ]);

  // Their side of the conversation, where they started one. Attaching it now
  // means the thread is already there if they are promoted to a Lead.
  if (candidate.engagement === "MESSAGE" && candidate.excerpt) {
    const channel =
      candidate.platform === "INSTAGRAM"
        ? "instagram"
        : candidate.platform === "LINKEDIN"
          ? "linkedin"
          : "messenger";

    const { data: conversation } = await admin
      .from("conversations")
      .insert({ business_id: businessId, prospect_id: prospect.id, channel })
      .select("id")
      .single();

    if (conversation) {
      await admin.from("prospects").update({ conversation_id: conversation.id }).eq("id", prospect.id);
      await admin.from("messages").insert({
        business_id: businessId,
        conversation_id: conversation.id,
        prospect_id: prospect.id,
        direction: "inbound",
        channel,
        body: candidate.excerpt,
        status: "RECEIVED",
        created_at: candidate.occurredAt ?? now,
      });
    }
  }

  return "created";
}
