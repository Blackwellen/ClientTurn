import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { providerJson, unconfigured } from "./http";
import {
  providerFailure,
  type ProviderResponse,
  type SocialEngagementCandidate,
  type SourcingProvider,
} from "./types";

/**
 * TikTok engagement: people who commented on the workspace's own videos.
 *
 * The counterpart to `tiktok-commercial-content.ts`, and the more useful half.
 * That adapter reads the DSA advertiser registry and returns *businesses*; this
 * one reads the workspace's own TikTok account and returns *people* — which is
 * what the "find a lead on TikTok, follow them, then message them" flow needs,
 * and which nothing else in the registry supplies.
 *
 * The same three properties that make the Meta adapter safe hold here, and for
 * the same structural reasons:
 *
 *   * it reads **only the account the workspace connected**, with that
 *     workspace's own token. There is no way to point it at a competitor's
 *     audience, because there is no endpoint that would accept one;
 *   * it returns **no email and no phone**. TikTok does not expose them for
 *     commenters, and nothing here guesses at them;
 *   * commenting is not consent. Everything it produces is a Prospect at
 *     `REVIEW`, and `engagement-ingest.ts` is what enforces that.
 *
 * ## Why there are no direct messages here
 *
 * The Meta adapter can read who messaged your Page, and a DM is the strongest
 * engagement signal there is — someone opening a conversation with a business.
 * TikTok has no equivalent public API. Business messaging exists in the app, in
 * some regions, but it is not exposed for reading, so there is no honest way to
 * ingest it. Rather than approximate it, this adapter covers comments and
 * mentions only, and the gap is stated instead of being papered over.
 *
 * That asymmetry is also why TikTok is the hardest of the four channels to run:
 * the one engagement type that would make a prospect obviously contactable is
 * exactly the one that cannot be read, so almost every TikTok prospect arrives
 * needing the follow-then-wait gate in `social_connection_states`.
 *
 * ## On the endpoints: what is confirmed, and what is not
 *
 * **Confirmed.** `business/video/list` is a **GET** taking `business_id` and a
 * `fields` list as URL parameters, on `/open_api/v1.3/`. The Business Account
 * family (`business/*`) is distinct from the Ads family (`comment/list` and
 * friends), which is keyed on `advertiser_id` and returns comments on *ads*
 * rather than on organic posts — the wrong data for this adapter. TikTok's own
 * v1.3 collection lists a `business/comment/list` alongside the video list, and
 * that pairing is what this reads.
 *
 * **Not confirmed.** The comment object's shape, and specifically whether it
 * carries a commenter identity. TikTok's docs portal is a client-rendered SPA
 * that serves no fetchable HTML, the published SDKs cover only the Ads comment
 * family, and `TIKTOK_APP_ID`/`TIKTOK_APP_SECRET` are unset here, so no live
 * call could settle it. The published SDK's ad-comment endpoints do *not*
 * document a commenter id at all.
 *
 * That last point is why this adapter is **off unless
 * `TIKTOK_ENGAGEMENT_ENABLED` is set**. Everything else in the pipeline treats
 * a configured provider as one that returns usable people, and a provider that
 * might return comments with no attributable author would produce either
 * nothing or — worse — records identified by something that is not a person.
 * The flag is the honest position: the code is complete and reviewed, and one
 * sandbox call flips it on. Until then no customer run touches it.
 *
 * Every failure path is soft regardless: a wrong path, an auth failure or an
 * unexpected body yields a provider error, the run records it and moves to the
 * next source, and no prospect is fabricated.
 */

type VideoListResponse = {
  data?: {
    videos?: { item_id?: string; create_time?: number; share_url?: string }[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string };
};

type CommentListResponse = {
  data?: {
    comments?: {
      comment_id?: string;
      text?: string;
      create_time?: number;
      /**
       * The commenter. TikTok scopes this id to the app, like a Meta PSID.
       *
       * Every field is optional and several spellings are tolerated because the
       * exact shape could not be confirmed from a fetchable source — see the
       * module header. `commenterOf` is the single place that reads it, and it
       * returns null rather than guessing when nothing usable is present.
       */
      user?: {
        open_id?: string;
        user_id?: string;
        unique_id?: string;
        display_name?: string;
        nickname?: string;
        username?: string;
      };
      /** Some TikTok payloads flatten the commenter onto the comment itself. */
      open_id?: string;
      username?: string;
      display_name?: string;
    }[];
    cursor?: number;
    has_more?: boolean;
  };
  error?: { code?: string; message?: string };
};

type ConnectedTikTokAccount = {
  accessToken: string;
  /** The business account whose videos are read. */
  businessAccountId: string;
};

/**
 * The workspace's connected TikTok account.
 *
 * Mirrors the Meta adapter exactly: the integration row is readable by the
 * workspace, the token is not — it lives in `integration_secrets` and is only
 * ever joined server-side. A workspace that has not connected TikTok gets
 * `null`, which the caller turns into "unconfigured" rather than an error.
 */
async function connectedAccount(
  businessId: string,
): Promise<ConnectedTikTokAccount | null> {
  const admin = createAdminClient();

  const { data } = await admin
    .from("integrations")
    .select("id, config, status")
    .eq("business_id", businessId)
    .eq("provider_type", "tiktok_ads")
    .maybeSingle();

  if (!data || data.status === "DISCONNECTED") return null;

  const { data: secret } = await admin
    .from("integration_secrets")
    .select("access_token")
    .eq("integration_id", data.id)
    .maybeSingle();

  const config = (data.config ?? {}) as Record<string, unknown>;
  const businessAccountId =
    typeof config.businessAccountId === "string"
      ? config.businessAccountId
      : typeof config.advertiserId === "string"
        ? config.advertiserId
        : null;

  const accessToken = secret?.access_token ?? null;
  if (!accessToken || !businessAccountId) return null;

  return { accessToken, businessAccountId };
}

function excerptOf(text: string | undefined | null): string | null {
  const trimmed = (text ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  // Enough to classify intent, short enough that we are not warehousing
  // somebody's comment history.
  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}…` : trimmed;
}

/**
 * A TikTok comment carries no profile URL, only a display name and an
 * app-scoped id. The handle in the display name is the only thing that makes
 * the person findable, so a profile URL is built from it when it looks like a
 * handle and left null otherwise — a guessed URL that 404s is worse than none.
 */
/**
 * The commenter's identity, or nothing.
 *
 * The one place the unconfirmed part of the payload is read. It tolerates the
 * plausible spellings rather than committing to one, and returns null when none
 * is present — which makes the comment skipped.
 *
 * Skipping is the right answer and not a defensive reflex: a prospect whose
 * identity is a comment id is a record nobody can ever act on, and it would
 * dedupe against nothing, so every re-run would create another one.
 */
function commenterOf(comment: {
  user?: {
    open_id?: string;
    user_id?: string;
    unique_id?: string;
    display_name?: string;
    nickname?: string;
    username?: string;
  };
  open_id?: string;
  username?: string;
  display_name?: string;
}): { externalId: string; displayName: string | null } | null {
  const user = comment.user ?? {};

  const externalId =
    user.open_id?.trim() ||
    user.user_id?.trim() ||
    user.unique_id?.trim() ||
    comment.open_id?.trim() ||
    "";

  if (!externalId) return null;

  const displayName =
    user.display_name?.trim() ||
    user.nickname?.trim() ||
    user.username?.trim() ||
    comment.display_name?.trim() ||
    comment.username?.trim() ||
    null;

  return { externalId, displayName };
}

function profileUrlFor(displayName: string | null): string | null {
  if (!displayName) return null;
  const handle = displayName.trim().replace(/^@/, "");
  return /^[A-Za-z0-9._]{2,24}$/.test(handle)
    ? `https://www.tiktok.com/@${handle}`
    : null;
}

async function fetchEngagement(input: {
  businessId: string;
  since: string | null;
  limit: number;
}): Promise<ProviderResponse<SocialEngagementCandidate>> {
  const account = await connectedAccount(input.businessId);
  if (!account) return unconfigured<SocialEngagementCandidate>();

  const sinceMs = input.since ? Date.parse(input.since) : 0;
  let latencyMs = 0;

  // Recent videos first. Comments are addressed per video, so there is no
  // account-wide comment feed to read — the video list is the index into it.
  // GET with URL parameters, not a POST body. The Business Account family
  // differs from the Ads family in exactly this way, and sending a JSON body
  // here returns an empty result rather than an error — which would read as
  // "this account has no videos" for what is actually a malformed request.
  const videoQuery = new URLSearchParams({
    business_id: account.businessAccountId,
    max_count: "20",
    fields: JSON.stringify(["item_id", "create_time", "share_url"]),
  });

  const videos = await providerJson<VideoListResponse>({
    url: `https://business-api.tiktok.com/open_api/v1.3/business/video/list/?${videoQuery}`,
    method: "GET",
    headers: { "access-token": account.accessToken },
  });

  latencyMs += videos.latencyMs;

  if (!videos.ok) {
    return providerFailure<SocialEngagementCandidate>(videos.code, latencyMs);
  }

  // TikTok answers HTTP 200 with an error body, so the payload is checked as
  // well as the status. Without this an auth failure reads as "no comments"
  // and the run reports an empty result for what was actually a broken
  // connection — the customer would see silence rather than a fixable problem.
  if (videos.data.error?.code && videos.data.error.code !== "0") {
    return providerFailure<SocialEngagementCandidate>("PROVIDER_BAD_RESPONSE", latencyMs);
  }

  const recentVideos = (videos.data.data?.videos ?? []).filter((video) => {
    if (!sinceMs || !video.create_time) return true;
    // A video posted before the cursor can still be commented on today, so the
    // window is generous rather than exact: 30 days of slack either side of the
    // high-water mark. Being too strict here silently drops live conversations
    // on older posts, which are often the best ones.
    return video.create_time * 1000 > sinceMs - 30 * 864e5;
  });

  const records: SocialEngagementCandidate[] = [];

  for (const video of recentVideos) {
    if (!video.item_id) continue;
    if (records.length >= input.limit) break;

    const commentQuery = new URLSearchParams({
      business_id: account.businessAccountId,
      video_id: video.item_id,
      max_count: "50",
    });

    const comments = await providerJson<CommentListResponse>({
      url: `https://business-api.tiktok.com/open_api/v1.3/business/comment/list/?${commentQuery}`,
      method: "GET",
      headers: { "access-token": account.accessToken },
    });

    latencyMs += comments.latencyMs;

    // One video's comments failing must not abandon the others — a single
    // deleted or restricted post is normal and should not fail the run.
    if (!comments.ok) continue;
    if (comments.data.error?.code && comments.data.error.code !== "0") continue;

    for (const comment of comments.data.data?.comments ?? []) {
      const commenter = commenterOf(comment);
      if (!commenter) continue;

      const occurredMs = comment.create_time ? comment.create_time * 1000 : null;
      if (sinceMs && occurredMs && occurredMs <= sinceMs) continue;

      const { displayName } = commenter;

      records.push({
        externalId: commenter.externalId,
        platform: "TIKTOK",
        // Comments are all this API exposes. A mention arrives as a comment
        // containing the handle, and is not distinguished — claiming to
        // separate them would be a distinction the data does not support.
        engagement: "COMMENT",
        displayName,
        // TikTok exposes no employer for a commenter, and deriving one from a
        // display name would produce a confident-looking record that is wrong.
        companyName: null,
        profileUrl: profileUrlFor(displayName),
        excerpt: excerptOf(comment.text),
        occurredAt: occurredMs ? new Date(occurredMs).toISOString() : null,
        sourceReference: video.share_url ?? video.item_id,
      });
    }
  }

  // One person commenting on three videos is one prospect, represented by their
  // most recent comment — that is the one worth reading when deciding whether
  // to approach them.
  const byPerson = new Map<string, SocialEngagementCandidate>();
  for (const record of records) {
    const existing = byPerson.get(record.externalId);
    if (!existing || (record.occurredAt ?? "") > (existing.occurredAt ?? "")) {
      byPerson.set(record.externalId, record);
    }
  }

  return {
    ok: true,
    records: [...byPerson.values()].slice(0, input.limit),
    costMinor: 0,
    cursor: null,
    latencyMs,
    errorCode: null,
  };
}

export const tiktokEngagementProvider: SourcingProvider = {
  key: "tiktok_engagement",
  displayName: "TikTok account engagement",
  capabilities: ["SOCIAL_ENGAGEMENT"],
  costRank: 1,
  // The workspace's own account, read with the workspace's own token. TikTok
  // does not meter it, so a run must not be billed for it.
  freeOfCharge: true,
  /**
   * Off until somebody has seen it work.
   *
   * The Meta and LinkedIn engagement adapters report `true` here because their
   * credential is per workspace and their payloads are documented. This one
   * differs on the second count: the comment object's commenter identity could
   * not be confirmed from any fetchable source (see the module header), and a
   * source that silently yields nothing is worse than one that is plainly
   * switched off — the first looks like "you have no engagement", the second
   * says what it is.
   *
   * Set `TIKTOK_ENGAGEMENT_ENABLED=1` once a sandbox call has confirmed the
   * response shape. Nothing else needs to change.
   */
  configured: () => serverEnv.sourcing.tiktokEngagementEnabled,
  fetchEngagement,
};
