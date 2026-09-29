import type { LaunchCheck } from "../campaign-validation";

/**
 * Creating an acquisition campaign from the wizard's unsaved form
 * (owner decision 2026-09-29).
 *
 * Opening "New campaign" used to insert a DRAFT row on first visit, so every
 * look at the wizard left an "Untitled campaign" behind. Now the new wizard
 * holds its form in the browser and nothing is written until the person
 * presses Create (or Launch) on the review step. That press:
 *
 *   1. inserts the DRAFT row,
 *   2. stores the whole form through the normal draft save, which re-checks
 *      every referenced record belongs to this workspace,
 *   3. launches it through the normal launch gate, which validates what is
 *      stored, not what the browser sent.
 *
 * If step 2 fails, the row from step 1 is removed again, so a failed Create
 * leaves nothing behind. If step 3 fails (a launch check blocks), the draft is
 * kept: the person asked for it to be created, and the wizard carries on
 * editing that saved draft.
 *
 * Pure orchestration with its dependencies passed in, so the order and the
 * clean-up are testable without a database.
 */

export type CreateFromDraftDeps = {
  createDraft: () => Promise<{ id: string } | null>;
  saveDraft: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  discardDraft: (id: string) => Promise<void>;
  recordCreated: (id: string) => Promise<void>;
  launch: (
    id: string,
  ) => Promise<
    | { ok: true; campaignId: string; status: string }
    | { ok: false; error: string; checks?: LaunchCheck[] }
  >;
};

export type CreateFromDraftResult =
  | { ok: true; campaignId: string; status: string }
  | {
      ok: false;
      error: string;
      /** The saved draft, when one now exists; null when nothing was kept. */
      campaignId: string | null;
      checks?: LaunchCheck[];
    };

export async function createCampaignFromDraft(
  deps: CreateFromDraftDeps,
): Promise<CreateFromDraftResult> {
  const created = await deps.createDraft();
  if (!created) {
    return { ok: false, error: "That campaign could not be created.", campaignId: null };
  }

  const saved = await deps.saveDraft(created.id);
  if (!saved.ok) {
    await deps.discardDraft(created.id);
    return { ok: false, error: saved.error, campaignId: null };
  }

  await deps.recordCreated(created.id);

  const launched = await deps.launch(created.id);
  if (!launched.ok) {
    return {
      ok: false,
      error: launched.error,
      campaignId: created.id,
      checks: launched.checks,
    };
  }

  return { ok: true, campaignId: launched.campaignId, status: launched.status };
}
