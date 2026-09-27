/**
 * Workspace-provided objections and reassurance assets (elite-closer brief).
 *
 * The business enters the objections it hears most, its own best answer to
 * each, and the reassurance it can stand behind: SLAs, guarantees, case
 * studies, testimonials it owns, response-time commitments. The agent prefers
 * these over the generic library, may paraphrase them, and never adds to
 * them.
 *
 * Storage: `workspace_sales_overrides`, kind OBJECTION (0121; the payload is
 * validated here, in code, as the table's contract says):
 *   key = a library objection key ("PRICE") or "custom:<slug>"
 *         payload WorkspaceObjectionPayload;
 *   key = "*"  payload { assets: ReassuranceAsset[] }.
 * Member-read RLS, service-role writes (0121). Migration 0147 documents the
 * payload shapes on the table.
 *
 * Pure: zod only.
 */

import { z } from "zod";
import { OBJECTION_KEYS, type ObjectionKey } from "./types.ts";

export const REASSURANCE_KINDS = ["SLA", "GUARANTEE", "CASE_STUDY", "TESTIMONIAL", "RESPONSE_TIME", "OTHER"] as const;
export type ReassuranceKind = (typeof REASSURANCE_KINDS)[number];

export const REASSURANCE_KIND_LABEL: Record<ReassuranceKind, string> = {
  SLA: "Service level",
  GUARANTEE: "Guarantee",
  CASE_STUDY: "Case study",
  TESTIMONIAL: "Testimonial (yours to use)",
  RESPONSE_TIME: "Response-time commitment",
  OTHER: "Other reassurance",
};

export const REASSURANCE_KEY = "*" as const;
export const CUSTOM_OBJECTION_PREFIX = "custom:" as const;
export const MAX_WORKSPACE_OBJECTIONS = 30;
export const MAX_REASSURANCE_ASSETS = 20;

const slug = z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,40}$/, "Use lower-case letters, numbers and hyphens.");
const plain = (max: number) => z.string().trim().min(1).max(max);

export const reassuranceAssetSchema = z.object({
  id: slug,
  kind: z.enum(REASSURANCE_KINDS),
  text: plain(300),
  /** Where it comes from (a URL or document name), for the team. Never sent. */
  source: z.string().trim().max(200).optional().nullable(),
});
export type ReassuranceAsset = z.infer<typeof reassuranceAssetSchema>;

export const reassurancePayloadSchema = z.object({
  assets: z.array(reassuranceAssetSchema).max(MAX_REASSURANCE_ASSETS),
});

export const workspaceObjectionPayloadSchema = z.object({
  label: plain(80),
  /** How leads tend to say it, as plain phrases ("we're mid-rebrand"). */
  phrases: z.array(z.string().trim().min(2).max(80)).max(20).default([]),
  /** The business's own best answer. Approved text: paraphrased, never added to. */
  response: plain(600),
  /** Reassurance asset ids to lean on for this objection. */
  reassuranceIds: z.array(slug).max(5).default([]),
  enabled: z.boolean().default(true),
});
export type WorkspaceObjectionPayload = z.infer<typeof workspaceObjectionPayloadSchema>;

export type WorkspaceObjection = WorkspaceObjectionPayload & {
  /** The row key: a library key or custom:<slug>. */
  key: string;
  /** The library objection this refines, or null for a custom one. */
  libraryKey: ObjectionKey | null;
};

export const workspaceObjectionKeySchema = z.union([
  z.enum(OBJECTION_KEYS),
  z.string().regex(/^custom:[a-z0-9][a-z0-9-]{0,40}$/),
]);

export function libraryKeyOf(key: string): ObjectionKey | null {
  return (OBJECTION_KEYS as readonly string[]).includes(key) ? (key as ObjectionKey) : null;
}

export type WorkspaceObjectionSet = {
  objections: WorkspaceObjection[];
  assets: ReassuranceAsset[];
  /** Row keys whose payload failed validation (ignored, reported in the UI). */
  invalid: string[];
};

export const EMPTY_WORKSPACE_OBJECTIONS: WorkspaceObjectionSet = { objections: [], assets: [], invalid: [] };

/** Validates OBJECTION rows. Invalid rows are skipped and reported, never half-used. */
export function parseWorkspaceObjectionRows(rows: readonly { key: string; payload: unknown }[]): WorkspaceObjectionSet {
  const out: WorkspaceObjectionSet = { objections: [], assets: [], invalid: [] };
  for (const row of rows) {
    if (row.key === REASSURANCE_KEY) {
      const parsed = reassurancePayloadSchema.safeParse(row.payload);
      if (parsed.success) out.assets = parsed.data.assets;
      else out.invalid.push(row.key);
      continue;
    }
    const key = workspaceObjectionKeySchema.safeParse(row.key);
    const payload = workspaceObjectionPayloadSchema.safeParse(row.payload);
    if (!key.success || !payload.success) {
      out.invalid.push(row.key);
      continue;
    }
    const libraryKey = libraryKeyOf(key.data);
    // A custom objection needs phrases to be recognised at all.
    if (!libraryKey && payload.data.phrases.length === 0) {
      out.invalid.push(row.key);
      continue;
    }
    out.objections.push({ ...payload.data, key: key.data, libraryKey });
  }
  out.objections.sort((a, b) => a.key.localeCompare(b.key));
  out.objections = out.objections.slice(0, MAX_WORKSPACE_OBJECTIONS);
  return out;
}

function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9£%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  const needle = normalise(phrase);
  if (needle.length < 2) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

export type WorkspaceObjectionMatch = {
  objection: WorkspaceObjection;
  /** PHRASE: the business's own phrase matched. LIBRARY: it refines the library match. */
  via: "PHRASE" | "LIBRARY";
  matched: string;
  assets: ReassuranceAsset[];
};

/**
 * The business's own objection for this message: one of its phrases, first
 * (most specific); otherwise its answer to the library objection that
 * matched. Null when it has none, and the library playbook applies.
 */
export function matchWorkspaceObjection(
  text: string | null | undefined,
  set: WorkspaceObjectionSet,
  libraryKeys: readonly ObjectionKey[] = [],
): WorkspaceObjectionMatch | null {
  const input = normalise((text ?? "").slice(0, 2000));
  if (!input) return null;
  const enabled = set.objections.filter((o) => o.enabled);
  const assetsFor = (o: WorkspaceObjection) =>
    o.reassuranceIds.map((id) => set.assets.find((a) => a.id === id)).filter((a): a is ReassuranceAsset => Boolean(a));
  for (const objection of enabled) {
    const phrase = objection.phrases.find((p) => containsPhrase(input, p));
    if (phrase) return { objection, via: "PHRASE", matched: phrase, assets: assetsFor(objection) };
  }
  for (const key of libraryKeys) {
    const objection = enabled.find((o) => o.libraryKey === key);
    if (objection) return { objection, via: "LIBRARY", matched: key, assets: assetsFor(objection) };
  }
  return null;
}

/**
 * Strategy lines for a matched workspace objection. The answer is the
 * business's approved text: paraphrase it to fit the lead's words, never add a
 * fact, figure or promise to it.
 */
export function renderWorkspaceObjection(match: WorkspaceObjectionMatch): string[] {
  const lines = [
    `The business's own answer to "${match.objection.label}" (approved: use it, paraphrase to fit their words, add nothing): ${match.objection.response}`,
  ];
  if (match.assets.length) {
    lines.push(`Reassurance you may use, word for word or not at all: ${match.assets.map((a) => a.text).join(" | ")}`);
  }
  return lines;
}

/** Reassurance assets as approved offer-card lines. */
export function reassuranceLines(assets: readonly ReassuranceAsset[]): string[] {
  return assets.map((asset) => `${REASSURANCE_KIND_LABEL[asset.kind]}: ${asset.text}`);
}
