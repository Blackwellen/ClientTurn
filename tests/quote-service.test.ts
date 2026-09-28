import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  approveQuote,
  calculateQuoteDraft,
  catalogueSubset,
  createQuote,
  getQuote,
  QuoteServiceError,
  rejectQuote,
  reviseQuote,
  sendQuote,
  submitForApproval,
  updateDraft,
  withdrawQuote,
  type QuoteActor,
} from "../src/lib/quotes/service-core.ts";
import { renderModelHash } from "../src/lib/quotes/render-model.ts";
import { AGENT_QUOTE_OPERATIONS, serviceOperation, registryProblems } from "../src/lib/services/registry.ts";
import { requiresConfirmation, roleMeets } from "../src/lib/services/types.ts";
import { BUSINESS, CATALOGUE, OPPORTUNITY, OTHER_BUSINESS, createFakeDeps } from "./fixtures/quote-fakes.ts";

/**
 * The quote service core with an in-memory store that mirrors the 0153 RPCs
 * (fixtures/quote-fakes.ts): idempotent creation, drafts, approvals by the
 * right person, send (freeze + token + jobs + events), revise and withdraw.
 * No database, no email, no Stripe, no AI.
 */

const member: QuoteActor = { kind: "HUMAN", userId: "u-member", role: "member" };
const admin: QuoteActor = { kind: "HUMAN", userId: "u-admin", role: "admin" };
const owner: QuoteActor = { kind: "HUMAN", userId: "u-owner", role: "owner" };
const agent: QuoteActor = { kind: "AI", userId: null, role: "member" };

const websiteLines = [{ lineId: "l1", kind: "ITEM" as const, itemId: "website", quantity: 1, optionIds: [] }];

async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => error instanceof QuoteServiceError && error.code === code);
}

describe("quote.create", () => {
  test("creates a numbered draft priced from the catalogue", async () => {
    const { deps, state, effects } = createFakeDeps();
    const result = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "req-1" });
    assert.equal(result.duplicate, false);
    assert.equal(result.quote.number, "Q-00001");
    assert.equal(result.quote.status, "DRAFT");
    assert.equal(result.revision?.calculation.totals.grossMinor, 600_000); // £5,000 + 20% VAT
    assert.equal(state.revisions.size, 1);
    assert.ok(effects.emitted.some((e) => e.type === "quote.created"));
  });

  test("is idempotent on the request: the same request returns the same quote", async () => {
    const { deps, state } = createFakeDeps();
    const first = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "req-1" });
    const second = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "req-1" });
    assert.equal(second.duplicate, true);
    assert.equal(second.quote.id, first.quote.id);
    assert.equal(state.quotes.size, 1);
    assert.equal(state.numbers, 1, "no second number is allocated for a repeat");
    const third = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "req-2" });
    assert.notEqual(third.quote.id, first.quote.id);
  });

  test("snapshots only the referenced catalogue items", () => {
    const subset = catalogueSubset(CATALOGUE, websiteLines);
    assert.deepEqual(subset.items.map((i) => i.id), ["website"]);
    assert.deepEqual(subset.items[0].addOnItemIds, [], "add-ons not on the quote are dropped from the snapshot");
  });

  test("an opportunity in another workspace is not found", async () => {
    const { deps } = createFakeDeps();
    await rejects(createQuote(deps, OTHER_BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "r" }), "NOT_FOUND");
  });

  test("needs quote_builder_enabled (can()), and the AI also needs quote_ai_enabled", async () => {
    const locked = createFakeDeps({ capabilities: { quote_builder_enabled: false } });
    await rejects(createQuote(locked.deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "r" }), "PLAN_LIMIT");
    const noAi = createFakeDeps({ capabilities: { quote_ai_enabled: false } });
    await rejects(createQuote(noAi.deps, BUSINESS, agent, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "r" }), "PLAN_LIMIT");
  });

  test("a closed or anonymised opportunity gets no quote", async () => {
    const closed = createFakeDeps({ opportunity: { outcome: "WON" } });
    await rejects(createQuote(closed.deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "r" }), "CONFLICT");
    const gone = createFakeDeps({ opportunity: { anonymised: true } });
    await rejects(createQuote(gone.deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "r" }), "CONFLICT");
  });

  test("an unknown item is refused with the calculator's reason", async () => {
    const { deps } = createFakeDeps();
    await rejects(
      createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: [{ lineId: "x", kind: "ITEM", itemId: "nope", quantity: 1, optionIds: [] }], requestId: "r" }),
      "INVALID_INPUT",
    );
  });

  test("the default deposit applies when there is something one-off to carry it", async () => {
    const { deps } = createFakeDeps({ settings: { defaultDepositBps: 5000 } });
    const withOneOff = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "a" });
    assert.equal(withOneOff.revision?.calculation.depositMinor, 300_000);
    const recurringOnly = await createQuote(deps, BUSINESS, member, {
      opportunityId: OPPORTUNITY,
      lines: [{ lineId: "h", kind: "ITEM", itemId: "hosting", quantity: 1, optionIds: [] }],
      requestId: "b",
    });
    assert.equal(recurringOnly.revision?.calculation.depositMinor, 0, "dropped, not an error");
  });
});

describe("calculate (read-only) hides margin from members", () => {
  test("members get no cost or margin; admins do", async () => {
    const { deps, state } = createFakeDeps();
    const asMember = await calculateQuoteDraft(deps, BUSINESS, member, { lines: websiteLines });
    assert.ok(asMember.ok);
    assert.equal((asMember.calculation as { margin: unknown }).margin, null);
    assert.equal(asMember.calculation.lines[0].costMinor, null);
    const asAdmin = await calculateQuoteDraft(deps, BUSINESS, admin, { lines: websiteLines });
    assert.ok(asAdmin.ok);
    assert.equal(asAdmin.calculation.lines[0].costMinor, 200_000);
    assert.equal(state.quotes.size, 0, "calculating saves nothing");
  });
});

describe("approvals", () => {
  const policy = {
    discountPolicy: {
      restraint: "NEVER" as const,
      aiMaxBps: 0,
      aiMaxMinor: null,
      firstConcessionMaxBps: null,
      marginFloorBps: null,
      approvalRules: [
        { id: "big-discount", discountAboveBps: 1000, role: "admin" as const },
        { id: "huge-deal", valueAboveMinor: 1_000_000, role: "owner" as const },
      ],
    },
  };

  test("a member's discount above the threshold needs approval before sending", async () => {
    const { deps } = createFakeDeps({ settings: policy });
    const created = await createQuote(deps, BUSINESS, member, {
      opportunityId: OPPORTUNITY,
      lines: websiteLines,
      quoteDiscount: { type: "PERCENT", bps: 1500, scope: "ALL" },
      requestId: "d",
    });
    assert.equal(created.revision?.approvalRequired, true);
    await rejects(sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" }), "POLICY_BLOCKED");

    const submitted = await submitForApproval(deps, BUSINESS, member, { quoteId: created.quote.id });
    assert.equal(submitted.status, "PENDING_APPROVAL");
    assert.equal(submitted.requiredRole, "admin");

    await rejects(approveQuote(deps, BUSINESS, agent, { quoteId: created.quote.id }), "FORBIDDEN_ROLE");
    await rejects(approveQuote(deps, BUSINESS, member, { quoteId: created.quote.id }), "FORBIDDEN_ROLE");
    const approved = await approveQuote(deps, BUSINESS, admin, { quoteId: created.quote.id });
    assert.equal(approved.status, "APPROVED");
    const sent = await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" });
    assert.equal(sent.status, "SENT");
  });

  test("an admin proposing the same discount needs no approval", async () => {
    const { deps } = createFakeDeps({ settings: policy });
    const created = await createQuote(deps, BUSINESS, admin, {
      opportunityId: OPPORTUNITY,
      lines: websiteLines,
      quoteDiscount: { type: "PERCENT", bps: 1500, scope: "ALL" },
      requestId: "d",
    });
    assert.equal(created.revision?.approvalRequired, false);
  });

  test("a value threshold naming the owner needs the owner, even for an admin", async () => {
    const { deps } = createFakeDeps({ settings: policy });
    const created = await createQuote(deps, BUSINESS, admin, {
      opportunityId: OPPORTUNITY,
      lines: [{ lineId: "l", kind: "ITEM", itemId: "website", quantity: 3, optionIds: [] }],
      requestId: "big",
    });
    assert.equal(created.revision?.approvalRequired, true);
    await submitForApproval(deps, BUSINESS, admin, { quoteId: created.quote.id });
    await rejects(approveQuote(deps, BUSINESS, admin, { quoteId: created.quote.id }), "FORBIDDEN_ROLE");
    assert.equal((await approveQuote(deps, BUSINESS, owner, { quoteId: created.quote.id })).status, "APPROVED");
  });

  test("a rejection returns the quote to draft; approving twice is one approval", async () => {
    const { deps, state } = createFakeDeps({ settings: policy });
    const created = await createQuote(deps, BUSINESS, member, {
      opportunityId: OPPORTUNITY,
      lines: websiteLines,
      quoteDiscount: { type: "PERCENT", bps: 1500, scope: "ALL" },
      requestId: "r1",
    });
    await submitForApproval(deps, BUSINESS, member, { quoteId: created.quote.id });
    assert.equal((await rejectQuote(deps, BUSINESS, admin, { quoteId: created.quote.id, note: "Too much off" })).status, "DRAFT");
    assert.equal(state.approvals[0].decision, "REJECTED");
    await submitForApproval(deps, BUSINESS, member, { quoteId: created.quote.id });
    await approveQuote(deps, BUSINESS, admin, { quoteId: created.quote.id });
    await rejects(approveQuote(deps, BUSINESS, admin, { quoteId: created.quote.id }), "CONFLICT");
  });

  test("approvals need quote_approval_enabled", async () => {
    const { deps } = createFakeDeps({ capabilities: { quote_approval_enabled: false } });
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "a" });
    await rejects(submitForApproval(deps, BUSINESS, member, { quoteId: created.quote.id }), "PLAN_LIMIT");
  });

  test("the assistant may not discount under restraint NEVER", async () => {
    const { deps } = createFakeDeps({ settings: policy });
    await rejects(
      createQuote(deps, BUSINESS, agent, {
        opportunityId: OPPORTUNITY,
        lines: websiteLines,
        quoteDiscount: { type: "PERCENT", bps: 500, scope: "ALL" },
        requestId: "ai",
      }),
      "POLICY_BLOCKED",
    );
  });
});

describe("drafts", () => {
  test("a draft is re-priced on edit; a sent quote is not editable", async () => {
    const { deps } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "e" });
    const edited = await updateDraft(deps, BUSINESS, member, {
      quoteId: created.quote.id,
      lines: [...websiteLines, { lineId: "h", kind: "ITEM", itemId: "hosting", quantity: 1, optionIds: [], parentLineId: "l1" }],
    });
    assert.equal(edited.revision.calculation.recurring.length, 1);
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    await rejects(updateDraft(deps, BUSINESS, member, { quoteId: created.quote.id, lines: websiteLines }), "CONFLICT");
  });
});

describe("quote.send", () => {
  test("freezes the render model, issues a link, queues the PDF, expiry and first nudge, and emits quote.sent", async () => {
    const { deps, state, effects } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "s" });
    const sent = await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" });
    assert.equal(sent.status, "SENT");
    assert.match(sent.publicUrl, /^https:\/\/app\.test\/q\/tok/);
    const rev = [...state.revisions.values()][0];
    assert.ok(rev.frozenAt && rev.renderModel && rev.renderHash);
    assert.equal(rev.renderHash, renderModelHash(rev.renderModel!), "the stored hash is the model's hash");
    assert.equal(rev.renderModel!.poweredBy, true, "the badge shows without white_label_public_pages");
    assert.equal(state.tokens.length, 1);
    assert.deepEqual(effects.jobs.map((j) => j.type).sort(), ["quote.expire", "quote.nudge", "quote.render_pdf"]);
    assert.equal(effects.delivered.length, 1);
    assert.equal(effects.delivered[0].origin, "manual");
    assert.ok(effects.emitted.some((e) => e.type === "quote.sent"));
  });

  test("the render model carries no cost, margin, internal note or AI rationale", async () => {
    const { deps, state } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, {
      opportunityId: OPPORTUNITY,
      lines: websiteLines,
      requestId: "leak",
      internalNote: "SECRET-NOTE",
      aiRationale: "SECRET-RATIONALE",
    });
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    const json = JSON.stringify([...state.revisions.values()][0].renderModel);
    for (const forbidden of ["SECRET-NOTE", "SECRET-RATIONALE", "costMinor", "margin", "200000"]) {
      assert.ok(!json.includes(forbidden), `render model leaks ${forbidden}`);
    }
  });

  test("white_label_public_pages removes the badge", async () => {
    const { deps, state } = createFakeDeps({ capabilities: { white_label_public_pages: true } });
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "wl" });
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    assert.equal([...state.revisions.values()][0].renderModel!.poweredBy, false);
  });

  test("sending again is a resend: a fresh link, no second transition, no second PDF job", async () => {
    const { deps, state, effects } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "rs" });
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" });
    const again = await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" });
    assert.equal(again.resend, true);
    assert.equal(state.transitions.filter((t) => t.action === "SEND").length, 1);
    assert.equal(effects.jobs.filter((j) => j.type === "quote.render_pdf").length, 1);
    assert.equal(state.tokens.length, 2);
    assert.equal(effects.delivered[1].kind, "REMINDER");
  });

  test("email needs an address; the link option does not", async () => {
    const { deps } = createFakeDeps({ opportunity: { lead: { name: "No Email", company: null, email: null, address: [] } } });
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "ne" });
    await rejects(sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "email" }), "CONFLICT");
    const sent = await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    assert.equal(sent.delivery.queued, false);
  });
});

describe("revise and withdraw", () => {
  test("a revision supersedes the sent one and revokes its links", async () => {
    const { deps, state } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "rv" });
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    const revised = await reviseQuote(deps, BUSINESS, member, { quoteId: created.quote.id });
    assert.equal(revised.revisionNo, 2);
    assert.equal(state.quotes.get(created.quote.id)?.status, "DRAFT");
    assert.ok(state.tokens.every((t) => t.revokedAt !== null), "old links revoked");
    const view = await getQuote(deps, BUSINESS, member, { quoteId: created.quote.id });
    assert.equal(view.revisions.length, 2);
    assert.equal(view.current?.revisionNo, 2);
  });

  test("withdraw ends the quote; a withdrawn quote cannot be sent", async () => {
    const { deps } = createFakeDeps();
    const created = await createQuote(deps, BUSINESS, member, { opportunityId: OPPORTUNITY, lines: websiteLines, requestId: "wd" });
    await sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" });
    assert.equal((await withdrawQuote(deps, BUSINESS, member, { quoteId: created.quote.id, reason: "Client went elsewhere" })).status, "WITHDRAWN");
    await rejects(sendQuote(deps, BUSINESS, member, { quoteId: created.quote.id, channel: "link" }), "CONFLICT");
  });
});

describe("registry declarations", () => {
  test("every quote-to-cash declaration is well formed", () => {
    assert.deepEqual(registryProblems(), []);
  });

  test("roles: catalogue and settings are owner/admin; members work quotes; only admins approve", () => {
    for (const name of ["catalogue.upsert_item", "catalogue.upsert_bundle", "catalogue.archive", "quote_settings.update", "quote.approve", "quote.reject", "invoice.issue", "invoice.record_payment", "invoice.void", "invoice.credit_note", "invoice.create_from_quote"]) {
      const op = serviceOperation(name);
      assert.ok(op, name);
      assert.equal(op!.minimumRole, "admin", name);
      assert.equal(roleMeets("member", op!.minimumRole), false, `${name}: a member must be refused`);
      assert.equal(roleMeets("owner", op!.minimumRole), true);
    }
    for (const name of ["quote.create", "quote.update_draft", "quote.send", "quote.revise", "quote.withdraw", "quote.submit_for_approval"]) {
      assert.equal(serviceOperation(name)!.minimumRole, "member", name);
      assert.equal(roleMeets("viewer", "member"), false);
    }
  });

  test("approval is a person in the app only", () => {
    assert.deepEqual(serviceOperation("quote.approve")!.callers, ["UI"]);
    assert.deepEqual(serviceOperation("quote.reject")!.callers, ["UI"]);
  });

  test("sending, withdrawing and money records need a person's confirmation", () => {
    for (const name of ["quote.send", "quote.withdraw", "invoice.issue", "invoice.record_payment", "invoice.void", "invoice.credit_note", "invoice.create_from_quote"]) {
      assert.ok(requiresConfirmation(serviceOperation(name)!.risk), name);
    }
    assert.equal(requiresConfirmation(serviceOperation("quote.calculate")!.risk), false);
  });

  test("the agent uses exactly calculate, create, request approval, send and its own discount", () => {
    // quote.apply_discount was added deliberately with the agent's quote tools
    // (brief §74, agent/tools.ts propose_discount): the assistant's discount,
    // decided by the discount policy in the quote core. update_draft, approve,
    // reject and withdraw stay closed to the agent (below).
    assert.deepEqual([...AGENT_QUOTE_OPERATIONS].sort(), ["quote.apply_discount", "quote.calculate", "quote.create", "quote.send", "quote.submit_for_approval"]);
    for (const name of AGENT_QUOTE_OPERATIONS) {
      const callers = serviceOperation(name)!.callers;
      assert.ok(!callers || callers.includes("AGENT"), `${name} must admit the AGENT caller`);
    }
    for (const name of ["quote.approve", "quote.reject", "quote.update_draft", "quote.withdraw", "invoice.issue", "catalogue.upsert_item"]) {
      assert.ok(!serviceOperation(name)!.callers?.includes("AGENT"), `${name} must not admit the agent`);
    }
  });

  test("every declared quote-to-cash operation has a handler", () => {
    const sources = ["quotes", "catalogue", "invoices"].map((f) => readFileSync(`src/lib/services/operations/${f}.ts`, "utf8")).join("\n");
    for (const name of ["catalogue.list", "catalogue.upsert_item", "catalogue.upsert_bundle", "catalogue.archive", "quote_settings.get", "quote_settings.update", "quote.calculate", "quote.create", "quote.update_draft", "quote.submit_for_approval", "quote.approve", "quote.reject", "quote.send", "quote.revise", "quote.withdraw", "quote.get", "quote.list", "invoice.create_from_quote", "invoice.issue", "invoice.record_payment", "invoice.void", "invoice.credit_note", "invoice.list"]) {
      assert.ok(sources.includes(`defineOperation("${name}"`), `${name} has no handler`);
    }
    const index = readFileSync("src/lib/services/index.ts", "utf8");
    for (const f of ["catalogue", "quotes", "invoices"]) assert.ok(index.includes(`./operations/${f}`));
  });

  test("no quote-to-cash code checks a plan by name", () => {
    for (const file of [
      "src/lib/quotes/service-core.ts",
      "src/lib/services/operations/quotes.ts",
      "src/lib/services/operations/catalogue.ts",
      "src/lib/services/operations/invoices.ts",
      "src/lib/invoicing/service-core.ts",
      "src/lib/quotes/public-server.ts",
    ]) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /["'](starter|growth|pro|enterprise|trial)["']/, `${file} names a plan`);
    }
  });
});
