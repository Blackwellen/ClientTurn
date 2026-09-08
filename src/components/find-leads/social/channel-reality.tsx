import * as React from "react";
import { ROUTES, type LeadRouteKey } from "@/lib/find-leads/lead-routes";

/**
 * What each social channel can and cannot actually do.
 *
 * This exists because the gap between what customers expect from "social
 * outreach" and what the platforms permit is enormous, and finding out by
 * running a campaign that quietly reaches nobody is the worst way to learn it.
 * Every claim here is a platform rule, not a product limitation, and each one
 * is stated with the reason so it reads as an explanation rather than an
 * excuse.
 *
 * `lead-routes.ts` is the single source: the stages and the limitation shown
 * here are the same values the engine works from, so this panel cannot drift
 * into describing behaviour the product no longer has.
 */

const CHANNEL_ORDER: SocialRouteKey[] = [
  "facebook_social",
  "instagram_social",
  "linkedin_social",
  "tiktok_social",
];

/**
 * The two sentences that most often surprise a customer, per channel.
 *
 * Deliberately not derived from the route stages: the stages describe what the
 * product does, and these describe what it *cannot* do, which is the part
 * somebody planning a campaign needs before they plan it.
 */
/**
 * Only the social routes. `public_sources` and `lead_forms` are deliberately
 * absent rather than filled in with empty arrays: this component exists to
 * explain the connect-then-message gate, and neither of those routes has one.
 * Widening the key type to every route would force two entries that could only
 * ever be blank or misleading.
 */
type SocialRouteKey = Extract<
  LeadRouteKey,
  "facebook_social" | "instagram_social" | "linkedin_social" | "tiktok_social"
>;

const CANNOT: Record<SocialRouteKey, string[]> = {
  facebook_social: [
    "Follow a person from your Page — Facebook has no such API for Pages.",
    "Message somebody who has never interacted with you.",
  ],
  instagram_social: [
    "Follow an account automatically — Instagram offers no API for it, and doing it another way gets the account blocked.",
    "Message somebody who has never commented, mentioned you or written to you.",
  ],
  linkedin_social: [
    "Read your LinkedIn inbox — no API exists that lets an application do that.",
    "Send a connection request or a message automatically without a partner agreement.",
  ],
  tiktok_social: [
    "Read direct messages — TikTok publishes no API for it.",
    "Message an account that has not followed you back.",
  ],
};

const CAN: Record<SocialRouteKey, string[]> = {
  facebook_social: [
    "Answer anyone who messages your Page, automatically, around the clock.",
    "Send one private reply to anyone who comments on your posts or ads, within seven days of their comment.",
  ],
  instagram_social: [
    "Answer your direct messages automatically, around the clock.",
    "Send one private reply to anyone who comments on a post or reel, or mentions you in a story, within seven days.",
  ],
  linkedin_social: [
    "Prepare each connection request and message, paced inside your account's real limits, for you to send.",
    "Record replies against the prospect so the conversation and its history stay in one place.",
  ],
  tiktok_social: [
    "Prepare follows and opening messages, paced slowly enough not to trigger a block.",
    "Record replies against the prospect once an account follows you back.",
  ],
};

export function ChannelReality({
  channels = CHANNEL_ORDER,
}: {
  /** Narrow to the platforms this workspace has actually connected. */
  channels?: SocialRouteKey[];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-xs">
      <h3 className="text-[13px] font-semibold text-content">
        What each channel can reach
      </h3>
      <p className="mt-1.5 max-w-[68ch] text-[12.5px] leading-relaxed text-content-muted">
        Social platforms decide who a business may message, and the rules are
        stricter than most people expect. None of the limits below are choices
        ClientTurn made — they are what the platforms permit, and working inside
        them is what keeps your accounts from being restricted.
      </p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {channels.map((key) => {
          const route = ROUTES[key];
          return (
            <article
              key={key}
              className="rounded-lg border border-line-subtle bg-surface-subtle p-4"
            >
              <h4 className="text-[12.5px] font-semibold text-content">{route.name}</h4>

              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Can
              </p>
              <ul className="mt-1 space-y-1">
                {CAN[key].map((line) => (
                  <li key={line} className="flex gap-1.5 text-[12px] text-content">
                    <span aria-hidden className="text-success-600">
                      ✓
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-content-subtle">
                Cannot
              </p>
              <ul className="mt-1 space-y-1">
                {CANNOT[key].map((line) => (
                  <li key={line} className="flex gap-1.5 text-[12px] text-content-muted">
                    <span aria-hidden className="text-content-subtle">
                      —
                    </span>
                    <span>{line}</span>
                  </li>
                ))}
              </ul>

              {/* The route's own limitation sentence, verbatim. It is the text
                  the engine is built against, so it can never describe
                  behaviour the product does not have. */}
              <p className="mt-3 border-t border-line-subtle pt-3 text-[11.5px] leading-relaxed text-content-muted">
                {route.limitation}
              </p>
            </article>
          );
        })}
      </div>

      <p className="mt-4 max-w-[68ch] text-[12px] leading-relaxed text-content-muted">
        <strong className="font-semibold text-content">
          Where a person is still needed.
        </strong>{" "}
        On LinkedIn and TikTok the connection request, the follow and the opening
        message are performed by you, from the queue above — the product finds
        the person, checks they are contactable, paces the action inside your
        account&rsquo;s limits and writes the message, and you send it. Automating
        that step would breach those platforms&rsquo; terms and put your account at
        risk, which is a far worse outcome than a slower campaign. On Facebook
        and Instagram no person is needed: replies are delivered through Meta&rsquo;s
        own messaging API and the assistant handles the conversation itself.
      </p>
    </section>
  );
}
