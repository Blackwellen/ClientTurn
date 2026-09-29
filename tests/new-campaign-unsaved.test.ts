import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCampaignFromDraft, type CreateFromDraftDeps } from "../src/lib/outreach/campaigns/create-from-draft.ts";

/**
 * Owner decision 2026-09-29: opening Find Leads -> New campaign creates
 * nothing. The wizard holds an unsaved form, and the campaign row is written
 * only when the person presses Create on the review step. Existing drafts are
 * kept and offered, never deleted.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function fakeDeps(overrides: Partial<CreateFromDraftDeps> = {}) {
  const calls: string[] = [];
  const deps: CreateFromDraftDeps = {
    createDraft: async () => {
      calls.push("create");
      return { id: "c-1" };
    },
    saveDraft: async (id) => {
      calls.push(`save:${id}`);
      return { ok: true };
    },
    discardDraft: async (id) => {
      calls.push(`discard:${id}`);
    },
    recordCreated: async (id) => {
      calls.push(`audit:${id}`);
    },
    launch: async (id) => {
      calls.push(`launch:${id}`);
      return { ok: true, campaignId: id, status: "READY" };
    },
    ...overrides,
  };
  return { deps, calls };
}

describe("Create is the only write for a new campaign", () => {
  test("create, store the form, audit, then launch, in that order", async () => {
    const { deps, calls } = fakeDeps();
    const result = await createCampaignFromDraft(deps);
    assert.deepEqual(result, { ok: true, campaignId: "c-1", status: "READY" });
    assert.deepEqual(calls, ["create", "save:c-1", "audit:c-1", "launch:c-1"]);
  });

  test("a form that cannot be stored leaves nothing behind", async () => {
    const { deps, calls } = fakeDeps({
      saveDraft: async (id) => {
        calls.push(`save:${id}`);
        return { ok: false, error: "That sender does not belong to this workspace." };
      },
    });
    const result = await createCampaignFromDraft(deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.campaignId, null);
    assert.ok(calls.includes("discard:c-1"), "the inserted row is removed again");
    assert.ok(!calls.some((c) => c.startsWith("launch")), "nothing is launched");
    assert.ok(!calls.some((c) => c.startsWith("audit")), "no created audit for a removed row");
  });

  test("a blocked launch keeps the draft and returns its id and the checks", async () => {
    const checks = [{ key: "sender", state: "BLOCK", label: "Sender", detail: "Connect a mailbox" }];
    const { deps, calls } = fakeDeps({
      launch: async () => ({ ok: false, error: "Fix the blocking checks first.", checks: checks as never }),
    });
    const result = await createCampaignFromDraft(deps);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.campaignId, "c-1");
      assert.deepEqual(result.checks, checks);
    }
    assert.ok(!calls.some((c) => c.startsWith("discard")), "a created draft is never deleted");
  });

  test("an insert failure reports it and writes nothing else", async () => {
    const { deps, calls } = fakeDeps({ createDraft: async () => null });
    const result = await createCampaignFromDraft(deps);
    assert.deepEqual(result, { ok: false, error: "That campaign could not be created.", campaignId: null });
    assert.deepEqual(calls, []);
  });
});

describe("opening the new-campaign page creates nothing", () => {
  const page = read("src/app/(app)/app/find-leads/campaigns/new/page.tsx");
  const wizard = read("src/components/find-leads/campaigns/wizard/campaign-wizard.tsx");
  const actions = read("src/lib/outreach/campaign-actions.ts");

  test("the page never inserts a draft", () => {
    assert.doesNotMatch(page, /\bcreateDraft\b/);
    assert.doesNotMatch(page, /createCampaignDraftAction/);
    assert.match(page, /campaignId=\{null\}/);
  });

  test("the page keeps the plan-limit, permission and not-found states", () => {
    assert.match(page, /coldEmailEnabled/);
    assert.match(page, /PlanLimitState/);
    assert.match(page, /You do not have permission to create campaigns/);
    assert.match(page, /That draft could not be found/);
  });

  test("an unfinished draft is offered, not opened or deleted", () => {
    assert.match(page, /findResumableDraft/);
    assert.match(page, /Continue that draft/);
    assert.doesNotMatch(page, /redirect\(`\/app\/find-leads\/campaigns\/new\?draft=\$\{draftId\}/);
  });

  test("the wizard does not autosave an unsaved campaign and validates the form instead", () => {
    assert.match(wizard, /if \(!dirty\.current \|\| campaignId === null\) return;/);
    assert.match(wizard, /previewLaunchChecksAction\(\{ draft \}\)/);
    assert.match(wizard, /createAcquisitionCampaignAction\(/);
    assert.match(wizard, /Nothing is created until you press Create/);
  });

  test("the create action is admin-only, needs cold email and send permission, and validates input", () => {
    const body = actions.slice(actions.indexOf("export async function createAcquisitionCampaignAction"));
    const fn = body.slice(0, body.indexOf("/* ----"));
    assert.match(fn, /createSchema\.safeParse\(input\)/);
    assert.match(fn, /requireCampaignAdmin\(\)/);
    assert.match(fn, /workspaceCan\(access\.workspace, "send_outbound"\)/);
    const preview = actions.slice(actions.indexOf("export async function previewLaunchChecksAction"));
    assert.match(preview.slice(0, preview.indexOf("\n}\n")), /requireCampaignAdmin\(\)/);
  });
});
