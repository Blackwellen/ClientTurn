/**
 * Whether a prospect's photo may be shown, and from where.
 *
 * Pure -- no `server-only`, no Supabase, no network -- so the rule can be
 * applied identically in a Server Component, a client list and a test.
 *
 * ## The answer to "can we show their LinkedIn photo"
 *
 * Not from LinkedIn, no. Three separate constraints, and the first is on its
 * own decisive:
 *
 *   1. **LinkedIn's User Agreement forbids it.** Copying, storing or
 *      redisplaying member profile images outside the platform is prohibited,
 *      and there is no API that would supply one for this purpose anyway. A
 *      product that scraped the image would be putting the customer's own
 *      account at risk to decorate a list.
 *   2. **Meta's image URLs are signed and short-lived.** They expire in hours.
 *      Storing one without an expiry produces a UI that demos perfectly and
 *      shows broken images a week later, which is worse than never having shown
 *      one -- a broken avatar reads as a broken product.
 *   3. **It is personal data with no purpose here.** A photo does not help
 *      qualify, score or contact anybody. Retaining one because it looks good
 *      is exactly the "collect it in case" habit that data-minimisation exists
 *      to stop, and it would have to appear in a subject access response.
 *
 * So the rule this module encodes: **reference, never copy; expire, never
 * assume; and fall back to initials without apology.** An initials avatar is a
 * finished design, not a placeholder for a photo we failed to get.
 *
 * What *is* permitted, and is what `avatar_source` distinguishes:
 *
 *   * `COMPANY_SITE` -- an image the business publishes about itself on its own
 *     website. Published by the subject, for exactly this purpose.
 *   * `GRAVATAR` -- an avatar the person themselves attached to their email
 *     address and chose to make globally resolvable.
 *   * `UPLOAD` -- one the customer added by hand, on a basis they hold.
 *   * `FACEBOOK` / `INSTAGRAM` / `TIKTOK` -- only for someone who engaged with
 *     the workspace's *own* account, where the platform hands us the URL as
 *     part of that conversation, and only until it expires.
 *   * `LINKEDIN` -- present in the column's check constraint for completeness
 *     and never written by this product. `avatarPolicyFor` refuses it.
 */

export const AVATAR_SOURCES = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "TIKTOK",
  "GRAVATAR",
  "COMPANY_SITE",
  "UPLOAD",
] as const;

export type AvatarSource = (typeof AVATAR_SOURCES)[number];

export type AvatarPolicy = {
  /** May this product ever store a reference from this source? */
  storable: boolean;
  /** Does the URL carry a short lifetime we must record and honour? */
  expires: boolean;
  /** Why, for the settings screen and for anyone reading this in six months. */
  note: string;
};

export const AVATAR_POLICY: Record<AvatarSource, AvatarPolicy> = {
  LINKEDIN: {
    storable: false,
    expires: false,
    note: "LinkedIn's terms do not permit member profile images to be stored or redisplayed outside the platform, so ClientTurn never holds one.",
  },
  FACEBOOK: {
    storable: true,
    expires: true,
    note: "Only for someone who messaged or commented on your own Page. Meta's image URLs are signed and expire within hours.",
  },
  INSTAGRAM: {
    storable: true,
    expires: true,
    note: "Only for someone who engaged with your own account. The URL is signed and expires within hours.",
  },
  TIKTOK: {
    storable: true,
    expires: true,
    note: "Only for someone who engaged with your own account. The URL expires.",
  },
  GRAVATAR: {
    storable: true,
    expires: false,
    note: "An avatar the person attached to their own email address and chose to make publicly resolvable.",
  },
  COMPANY_SITE: {
    storable: true,
    expires: false,
    note: "An image the business publishes about itself on its own website.",
  },
  UPLOAD: {
    storable: true,
    expires: false,
    note: "Added by someone in your workspace, on a basis you hold.",
  },
};

export function avatarPolicyFor(source: string | null | undefined): AvatarPolicy | null {
  if (!source) return null;
  return AVATAR_POLICY[source as AvatarSource] ?? null;
}

/** Whether a reference from this source may be written at all. */
export function mayStoreAvatar(source: string | null | undefined): boolean {
  return avatarPolicyFor(source)?.storable ?? false;
}

export type StoredAvatar = {
  avatar_url: string | null;
  avatar_source: string | null;
  avatar_expires_at: string | null;
};

export type ResolvedAvatar = {
  /** The URL to render, or null to fall back to initials. */
  url: string | null;
  /** Null when `url` is set. Otherwise why there is no image, for a tooltip. */
  reason: string | null;
};

/**
 * What to render, right now.
 *
 * `now` is a parameter so a list rendered on the server and hydrated on the
 * client agrees with itself: reading the clock during render is impure, and an
 * avatar that appears server-side and vanishes on hydration is a worse bug than
 * a stale image.
 *
 * A lapsed URL returns null rather than being rendered optimistically. The
 * signed URL will 403, and a broken image is more damaging than an initials
 * circle that was always going to look deliberate.
 */
export function resolveAvatar(
  stored: StoredAvatar | null | undefined,
  now: Date = new Date(),
): ResolvedAvatar {
  if (!stored?.avatar_url) {
    return { url: null, reason: null };
  }

  const policy = avatarPolicyFor(stored.avatar_source);

  // An unknown source, or one we are not permitted to hold. Refused on read as
  // well as on write: a row written by an older build, a manual fix or a future
  // import must not become renderable merely because it exists.
  if (!policy?.storable) {
    return {
      url: null,
      reason:
        policy?.note ??
        "This image comes from a source ClientTurn does not display photos from.",
    };
  }

  if (stored.avatar_expires_at) {
    const expiry = new Date(stored.avatar_expires_at).getTime();
    // An unparseable expiry is treated as expired. The alternative is rendering
    // a URL whose lifetime we cannot establish, which is the case the expiry
    // column exists to prevent.
    if (!Number.isFinite(expiry) || expiry <= now.getTime()) {
      return {
        url: null,
        reason: "The platform's link to this image has expired.",
      };
    }
  }

  return { url: stored.avatar_url, reason: null };
}

/**
 * Initials for the fallback.
 *
 * Kept here beside the policy rather than in the Avatar primitive, because the
 * fallback is part of the same decision: what a prospect looks like when we
 * are not permitted to show their face.
 */
export function initialsFor(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  const first = firstName?.trim()?.[0] ?? "";
  const last = lastName?.trim()?.[0] ?? "";
  const initials = `${first}${last}`.toUpperCase();
  return initials || "?";
}
