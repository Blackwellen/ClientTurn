/**
 * Database rows to `Banner`, defensively: anything the model does not know
 * (a tone, audience or placement added by a later migration) is dropped
 * rather than rendered with a guessed meaning.
 *
 * Pure: relative imports only.
 */

import {
  BANNER_AUDIENCES,
  BANNER_PLACEMENTS,
  BANNER_TONES,
  type Banner,
  type BannerAudience,
  type BannerPlacement,
  type BannerTone,
} from "./types.ts";

export type BannerRow = {
  id: string;
  title: string;
  body: string | null;
  link_url: string | null;
  link_label: string | null;
  tone: string;
  audience: string;
  plans?: string[] | null;
  business_ids?: string[] | null;
  placements: string[] | null;
  starts_at: string;
  ends_at: string | null;
  ended_at?: string | null;
  dismissible: boolean;
  priority: number;
  updated_at: string;
};

export function rowToBanner(row: BannerRow): Banner | null {
  if (!row || typeof row.id !== "string" || typeof row.title !== "string") return null;
  if (!(BANNER_TONES as readonly string[]).includes(row.tone)) return null;
  if (!(BANNER_AUDIENCES as readonly string[]).includes(row.audience)) return null;
  const placements = (row.placements ?? []).filter((p): p is BannerPlacement =>
    (BANNER_PLACEMENTS as readonly string[]).includes(p),
  );
  if (placements.length === 0) return null;
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? null,
    linkUrl: row.link_url ?? null,
    linkLabel: row.link_label ?? null,
    tone: row.tone as BannerTone,
    audience: row.audience as BannerAudience,
    plans: row.plans ?? [],
    businessIds: row.business_ids ?? [],
    placements,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? null,
    endedAt: row.ended_at ?? null,
    dismissible: row.dismissible !== false,
    priority: Number.isFinite(row.priority) ? row.priority : 0,
    updatedAt: row.updated_at,
  };
}

export function rowsToBanners(rows: unknown): Banner[] {
  if (!Array.isArray(rows)) return [];
  return (rows as BannerRow[]).map(rowToBanner).filter((b): b is Banner => b !== null);
}
