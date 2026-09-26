"use server";

import { z } from "zod";
import { recordHelpView } from "./service";

/**
 * Counts a help-article view from a rendered article page.
 *
 * Public on purpose: the public `/help` article pages are statically rendered
 * and revalidated, so a count taken during render would count builds, not
 * readers. The page sends this once from the browser instead.
 *
 * Takes a slug and nothing else, validated to the slug shape, and the service
 * only counts slugs that exist. The worst a crafted request can do is add one
 * to a real article's popularity — the same as reading it.
 */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export async function recordHelpArticleView(slug: unknown): Promise<void> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return;
  await recordHelpView(parsed.data);
}
