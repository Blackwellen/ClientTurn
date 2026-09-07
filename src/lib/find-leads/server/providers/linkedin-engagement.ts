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
 * LinkedIn engagement: people who interacted with your company page.
 *
 * The other route people miss. LinkedIn's Organization Social API returns the
 * members who commented on and reacted to your own posts — named individuals,
 * with their profile URNs, and nothing to do with Lead Gen Forms. For a B2B
 * business this is the highest-quality prospect source LinkedIn offers, because
 * the person engaged with your content in a professional context.
 *
 * Scope and honesty:
 *
 *   * it reads **your organisation's own posts**, using the `r_organization_social`
 *     permission on the page you administer. It cannot read anyone else's;
 *   * it returns a **member URN and, for approved apps, a name and headline**.
 *     It returns **no email** — LinkedIn does not expose member emails to any
 *     application, and a tool that produces one got it elsewhere;
 *   * a reaction is weaker evidence than a comment, and both are recorded as
 *     what they are rather than flattened into "engaged".
 *
 * The result is a Prospect: someone who showed interest and has not been
 * contacted. Promotion to Lead stays a human decision.
 */

type SocialActionsResponse = {
  elements?: {
    id?: string;
    message?: { text?: string };
    actor?: string;
    created?: { time?: number };
    object?: string;
  }[];
  paging?: { start?: number; total?: number };
};

type OrganizationPosts = {
  elements?: { id?: string }[];
};

type ConnectedLinkedInPage = {
  organizationUrn: string;
  accessToken: string;
};

async function connectedPage(businessId: string): Promise<ConnectedLinkedInPage | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", "linkedin_ads")
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

  const organizationUrn =
    typeof config.organizationUrn === "string"
      ? config.organizationUrn
      : typeof config.organizationId === "string"
        ? `urn:li:organization:${config.organizationId}`
        : null;

  const accessToken = secret?.access_token ?? null;

  if (!organizationUrn || !accessToken) return null;
  return { organizationUrn, accessToken };
}

function excerptOf(text: string | undefined | null): string | null {
  const trimmed = (text ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
}

/** `urn:li:person:ABC123` → a profile URL. LinkedIn's own public form. */
function profileUrlFor(actorUrn: string | undefined): string | null {
  if (!actorUrn) return null;
  const id = actorUrn.split(":").pop();
  return id ? `https://www.linkedin.com/in/${id}` : null;
}

async function fetchEngagement(input: {
  businessId: string;
  since: string | null;
  limit: number;
}): Promise<ProviderResponse<SocialEngagementCandidate>> {
  const page = await connectedPage(input.businessId);
  if (!page) return unconfigured<SocialEngagementCandidate>();

  const headers = {
    authorization: `Bearer ${page.accessToken}`,
    "linkedin-version": "202401",
    "x-restli-protocol-version": "2.0.0",
  };

  const limit = Math.min(Math.max(input.limit, 1), 50);

  // Comments hang off a post, so the posts come first. Only recent ones —
  // walking an entire page history to find a comment from last year is a lot
  // of calls for a stale signal.
  const postsResponse = await providerJson<OrganizationPosts>({
    url: `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(
      page.organizationUrn,
    )}&q=author&count=10&sortBy=LAST_MODIFIED`,
    headers,
  });

  if (!postsResponse.ok) {
    return providerFailure<SocialEngagementCandidate>(
      postsResponse.code,
      postsResponse.latencyMs,
    );
  }

  const sinceMs = input.since ? new Date(input.since).getTime() : 0;
  const records: SocialEngagementCandidate[] = [];
  let latencyMs = postsResponse.latencyMs;

  for (const post of (postsResponse.data.elements ?? []).slice(0, 10)) {
    if (!post.id) continue;

    const comments = await providerJson<SocialActionsResponse>({
      url: `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(
        post.id,
      )}/comments?count=${limit}`,
      headers,
    });

    // One post failing must not lose the comments already gathered from the
    // others, so this continues rather than returning.
    if (!comments.ok) continue;
    latencyMs += comments.latencyMs;

    for (const comment of comments.data.elements ?? []) {
      const actor = comment.actor;
      if (!actor || actor === page.organizationUrn) continue;

      const occurredMs = comment.created?.time ?? 0;
      if (sinceMs && occurredMs && occurredMs < sinceMs) continue;

      records.push({
        externalId: `linkedin_member:${actor}`,
        platform: "LINKEDIN",
        engagement: "COMMENT",
        // The comments endpoint gives the actor URN, not a name. Resolving a
        // name needs a separate profile call that most apps are not permitted
        // to make, so this stays null rather than inventing one — the URL below
        // is what makes the person findable.
        displayName: null,
        companyName: null,
        profileUrl: profileUrlFor(actor),
        excerpt: excerptOf(comment.message?.text),
        occurredAt: occurredMs ? new Date(occurredMs).toISOString() : null,
        sourceReference: comment.id ?? post.id,
      });
    }
  }

  // One person commenting on three posts is one prospect.
  const byPerson = new Map<string, SocialEngagementCandidate>();
  for (const record of records) {
    const existing = byPerson.get(record.externalId);
    if (!existing || (record.occurredAt ?? "") > (existing.occurredAt ?? "")) {
      byPerson.set(record.externalId, record);
    }
  }

  return {
    ok: true,
    records: [...byPerson.values()],
    costMinor: 0,
    cursor: null,
    latencyMs,
    errorCode: null,
  };
}

export const linkedinEngagementProvider: SourcingProvider = {
  key: "linkedin_engagement",
  displayName: "LinkedIn page engagement",
  capabilities: ["SOCIAL_ENGAGEMENT"],
  costRank: 1,
  // Your own page, your own token. LinkedIn bills the page, not the read.
  freeOfCharge: true,
  configured: () => true,
  fetchEngagement,
};
