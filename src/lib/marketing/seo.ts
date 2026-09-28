/**
 * The site-wide social preview image, for pages that define their own
 * `openGraph` / `twitter` metadata.
 *
 * `src/app/opengraph-image.tsx` is file-based metadata on the ROOT segment.
 * Next merges metadata shallowly, so a page that sets its own `openGraph`
 * object replaces the root one wholesale, image included: every marketing
 * page was being unfurled with no image at all (QA 2026-09-28). Pages that
 * set `openGraph` or `twitter` add these explicitly.
 */
export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "ClientTurn — Turn more leads into clients",
  type: "image/png",
} as const;

export const OG_IMAGES = [OG_IMAGE];

/** Twitter/X takes the same image by URL. */
export const TWITTER_IMAGES = [OG_IMAGE.url];
