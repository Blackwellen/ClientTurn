"use server";

import { z } from "zod";
import { getUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  parseSectionRecords,
  parseTourRecord,
  withSectionRecord,
  type SectionTourRecords,
  type TourRecord,
} from "./persistence";
import { SECTION_KEYS } from "./model";

/**
 * Product-tour persistence (Phase 8.4).
 *
 * Per person, not per workspace: a colleague invited later has never seen the
 * tour. The user id always comes from the session and the write is scoped to
 * it, so nobody can mark someone else's tour as done. The columns carry no
 * column grant for `authenticated` (migration 0128), so the service-role
 * client does the write, filtered to the caller's own row.
 */

export type TourState =
  /** The server answered. `record` is null when the tour was never finished. */
  | { known: true; record: TourRecord | null }
  /** Migration 0128 not applied yet, or the read failed. */
  | { known: false };

export async function readProductTour(): Promise<TourState> {
  const user = await getUser();
  if (!user) return { known: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("product_tour_version, product_tour_outcome, product_tour_completed_at")
      .eq("id", user.id)
      .maybeSingle();
    if (error) return { known: false };
    if (!data?.product_tour_version) return { known: true, record: null };
    return {
      known: true,
      record: parseTourRecord({
        version: data.product_tour_version,
        outcome: data.product_tour_outcome,
        at: data.product_tour_completed_at ?? "",
      }),
    };
  } catch {
    return { known: false };
  }
}

const finishSchema = z.object({
  version: z.number().int().min(1).max(1000),
  outcome: z.enum(["completed", "skipped"]),
});

export async function finishProductTour(input: unknown): Promise<{ ok: boolean }> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({
        product_tour_version: parsed.data.version,
        product_tour_outcome: parsed.data.outcome,
        product_tour_completed_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}

/* ------------------------------------------------------ section tours */

/**
 * Section tours (Phase 8.29) are stored without a migration, in the person's
 * own `auth.users.app_metadata` under `ct_section_tours`: a small map from
 * section key to `{ version, outcome, at }`. `app_metadata` rather than
 * `user_metadata` because only the service role can write it, the same
 * guarantee the `profiles.product_tour_*` columns have. Nothing in it is
 * security-relevant; it only decides whether a tour starts on its own.
 */
const SECTION_METADATA_KEY = "ct_section_tours";

export type SectionTourState =
  | { known: true; records: SectionTourRecords }
  | { known: false };

export async function readSectionTours(): Promise<SectionTourState> {
  const user = await getUser();
  if (!user) return { known: false };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error || !data.user) return { known: false };
    const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    return { known: true, records: parseSectionRecords(meta[SECTION_METADATA_KEY]) };
  } catch {
    return { known: false };
  }
}

const finishSectionSchema = z.object({
  section: z.enum(SECTION_KEYS),
  version: z.number().int().min(1).max(1000),
  outcome: z.enum(["completed", "skipped"]),
});

export async function finishSectionTour(input: unknown): Promise<{ ok: boolean }> {
  const parsed = finishSectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const user = await getUser();
  if (!user) return { ok: false };
  try {
    const admin = createAdminClient();
    // Re-read rather than trusting the session's copy: another tab may have
    // finished a different section since this one loaded.
    const { data, error } = await admin.auth.admin.getUserById(user.id);
    if (error || !data.user) return { ok: false };
    const meta = (data.user.app_metadata ?? {}) as Record<string, unknown>;
    const records = withSectionRecord(parseSectionRecords(meta[SECTION_METADATA_KEY]), parsed.data.section, {
      version: parsed.data.version,
      outcome: parsed.data.outcome,
      at: new Date().toISOString(),
    });
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      app_metadata: { ...meta, [SECTION_METADATA_KEY]: records },
    });
    return { ok: !updateError };
  } catch {
    return { ok: false };
  }
}
