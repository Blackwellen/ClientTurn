import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BULK_ACTIONS,
  MAX_BULK_LEADS,
  bulkActionsFor,
  bulkAllowed,
  bulkMinimumRole,
  bulkNeedsConfirmation,
  itemFromService,
  leadCount,
  summariseBulk,
  type BulkItemResult,
} from "../src/lib/leads/bulk.ts";
import { registryProblems, serviceOperation } from "../src/lib/services/registry.ts";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("bulk action catalogue", () => {
  test("every action is a registered operation the UI may call", () => {
    assert.deepEqual(registryProblems(), []);
    for (const action of BULK_ACTIONS) {
      const op = serviceOperation(action.operation);
      assert.ok(op, action.operation);
      const callers = (op!.callers ?? ["UI"]) as readonly string[];
      assert.ok(callers.includes("UI"), `${action.operation} must allow UI`);
    }
  });

  test("campaign.add_lead is a reversible, admin-only write and never an agent's", () => {
    const op = serviceOperation("campaign.add_lead")!;
    assert.equal(op.risk, "REVERSIBLE_WRITE");
    assert.equal(op.minimumRole, "admin");
    assert.ok(!(op.callers as readonly string[]).includes("AGENT"));
    assert.ok(!(op.callers as readonly string[]).includes("COPILOT"));
  });

  test("the selection cap is one page at its largest", () => {
    assert.equal(MAX_BULK_LEADS, 200);
  });
});

describe("role gating", () => {
  test("roles come from the registry, not a second list", () => {
    for (const action of BULK_ACTIONS) {
      assert.equal(bulkMinimumRole(action.kind), serviceOperation(action.operation)!.minimumRole);
    }
  });

  test("a viewer gets nothing; a member gets no admin-only action", () => {
    assert.deepEqual(bulkActionsFor("viewer"), []);
    const member = bulkActionsFor("member").map((a) => a.kind);
    assert.ok(member.includes("assign"));
    assert.ok(member.includes("suppress")); // lead.suppress is member-level
    assert.ok(!member.includes("archive")); // lead.archive is admin-only
    assert.ok(!member.includes("add_to_campaign"));
    assert.equal(bulkAllowed("member", "archive"), false);
    assert.equal(bulkAllowed("admin", "archive"), true);
    assert.equal(bulkAllowed("owner", "add_to_campaign"), true);
    assert.equal(bulkAllowed("nonsense", "assign"), false);
  });

  test("the server action checks the role itself, before any operation runs", () => {
    const actions = source("../src/lib/leads/bulk-actions.ts");
    assert.match(actions, /^"use server";/);
    assert.match(actions, /requireRole\(bulkMinimumRole\(kind\)\)/);
    assert.match(actions, /runOperation\(def\.operation/);
    // Supabase is never touched directly: every write is a registry operation.
    assert.doesNotMatch(actions, /createAdminClient|createClient|\.rpc\(/);
  });
});

describe("confirmation requirements", () => {
  test("suppress and archive need a confirmation; the rest run immediately", () => {
    const confirmed = BULK_ACTIONS.filter((a) => bulkNeedsConfirmation(a.kind)).map((a) => a.kind);
    assert.deepEqual(confirmed.sort(), ["archive", "suppress"]);
  });

  test("the server refuses an unconfirmed destructive action", () => {
    const actions = source("../src/lib/leads/bulk-actions.ts");
    assert.match(actions, /bulkNeedsConfirmation\(kind\) && !confirmed/);
  });

  test("destructive actions are the ones marked destructive in the menu", () => {
    for (const action of BULK_ACTIONS) {
      assert.equal(Boolean(action.destructive), bulkNeedsConfirmation(action.kind), action.kind);
    }
  });
});

describe("per-item results", () => {
  test("service envelopes map to updated / skipped / failed", () => {
    assert.deepEqual(itemFromService("1", { success: true, data: {} }), {
      leadId: "1",
      outcome: "updated",
    });
    assert.deepEqual(itemFromService("2", { success: true, data: { unchanged: true } }), {
      leadId: "2",
      outcome: "skipped",
      reason: "already done",
    });
    assert.deepEqual(
      itemFromService("3", {
        success: false,
        code: "POLICY_BLOCKED",
        message: "This lead opted out. Follow-up cannot resume.",
      }),
      { leadId: "3", outcome: "skipped", reason: "this lead opted out" },
    );
    assert.deepEqual(
      itemFromService("4", { success: false, code: "INTERNAL", message: "Something went wrong." }),
      { leadId: "4", outcome: "failed", reason: "something went wrong" },
    );
  });

  test("the summary counts, groups reasons and says what happened", () => {
    const items: BulkItemResult[] = [
      ...Array.from({ length: 12 }, (_, i) => ({ leadId: `u${i}`, outcome: "updated" as const })),
      { leadId: "s1", outcome: "skipped", reason: "opted out" },
      { leadId: "s2", outcome: "skipped", reason: "opted out" },
    ];
    const summary = summariseBulk("archive", items);
    assert.equal(summary.total, 14);
    assert.equal(summary.updated, 12);
    assert.equal(summary.skipped, 2);
    assert.equal(summary.failed, 0);
    assert.equal(summary.message, "12 archived, 2 skipped: opted out.");
    assert.deepEqual(summary.unchangedIds, ["s1", "s2"]);
  });

  test("mixed reasons are listed with counts, most common first, and failures called out", () => {
    const summary = summariseBulk("set_status", [
      { leadId: "a", outcome: "updated" },
      { leadId: "b", outcome: "skipped", reason: "already done" },
      { leadId: "c", outcome: "skipped", reason: "archived" },
      { leadId: "d", outcome: "skipped", reason: "archived" },
      { leadId: "e", outcome: "failed", reason: "unexpected error" },
    ]);
    assert.deepEqual(
      summary.reasons.map((r) => [r.reason, r.count, r.outcome]),
      [
        ["archived", 2, "skipped"],
        ["already done", 1, "skipped"],
        ["unexpected error", 1, "failed"],
      ],
    );
    assert.equal(
      summary.message,
      "1 updated, 3 skipped: archived (2); already done (1), 1 failed — try again.",
    );
  });

  test("an all-success run keeps nothing selected", () => {
    const summary = summariseBulk("rescore", [
      { leadId: "a", outcome: "updated" },
      { leadId: "b", outcome: "updated" },
    ]);
    assert.equal(summary.message, "2 re-scored.");
    assert.deepEqual(summary.unchangedIds, []);
  });

  test("lead counts pluralise", () => {
    assert.equal(leadCount(1), "1 lead");
    assert.equal(leadCount(1200), "1,200 leads");
  });
});

describe("export and UI wiring", () => {
  test("the export route is admin-only, business-scoped, audited and POST", () => {
    const route = source("../src/app/api/exports/leads/route.ts");
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function GET/);
    assert.match(route, /hasRole\(workspace\.role, "admin"\)/);
    assert.match(route, /\.eq\("business_id", workspace\.businessId\)/);
    assert.match(route, /recordAudit\(/);
    assert.match(route, /if \(error\)/);
  });

  test("the bar uses the Actions dropdown and confirmation dialogs", () => {
    const bar = source("../src/components/leads/lead-bulk-bar.tsx");
    assert.match(bar, /<DropdownMenu/);
    assert.match(bar, /<ConfirmDialog/);
    assert.match(bar, /confirmed: true/);
  });
});
