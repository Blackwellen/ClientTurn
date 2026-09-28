import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import {
  applyPatch,
  canApplyToInvoice,
  canDismiss,
  countByKind,
  decideApply,
  DISMISS_RESOLUTIONS,
  isOpenReview,
  RESOLUTIONS_FOR_KIND,
  reviewKind,
  type ReviewPaymentRow,
} from "../src/lib/invoicing/payment-review.ts";
import { ledgerEntryLabel, partnershipCloseBlocker } from "../src/lib/affiliates/ledger-rules.ts";
import {
  linkedInSentCounts,
  memberPermissionRow,
  normaliseHoldReason,
} from "../src/lib/admin/support-signals-types.ts";

/**
 * Admin / affiliate gap audit (2026-09-28): the support side of 0171-0174
 * and the affiliate chain. Pure rules plus wiring checks on the source; no
 * database, no Stripe, no provider, no AI.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const BIZ = "11111111-1111-4111-8111-111111111111";

function row(patch: Partial<ReviewPaymentRow> = {}): ReviewPaymentRow & { currency: string } {
  return {
    status: "REVIEW",
    review_reason: null,
    review_resolved_at: null,
    applied_at: null,
    invoice_id: null,
    match_kind: null,
    amount_minor: 12_000,
    currency: "GBP",
    ...patch,
  };
}

const openInvoice = { business_id: BIZ, status: "OPEN", currency: "GBP", total_minor: 10_000, paid_minor: 0 };

describe("invoice payment review queue: who is waiting", () => {
  test("flagged, unmatched and email-only payments are open; resolved or applied lead payments are not", () => {
    assert.equal(isOpenReview(row({ status: "MATCHED", applied_at: "x", review_reason: "OVERPAID" })), true);
    assert.equal(isOpenReview(row({ status: "MATCHED", applied_at: "x", review_reason: "REFUNDED" })), true);
    assert.equal(isOpenReview(row({ status: "UNMATCHED" })), true);
    assert.equal(isOpenReview(row({ status: "REVIEW", match_kind: "EMAIL" })), true);
    assert.equal(isOpenReview(row({ status: "MATCHED", applied_at: "x" })), false);
    assert.equal(isOpenReview(row({ status: "LINKED" })), false);
    assert.equal(isOpenReview(row({ review_reason: "OVERPAID", review_resolved_at: "x" })), false);
  });

  test("kinds come from the settlement reason, else the match", () => {
    assert.equal(reviewKind(row({ review_reason: "CURRENCY_MISMATCH" })), "CURRENCY_MISMATCH");
    assert.equal(reviewKind(row({ match_kind: "EMAIL" })), "EMAIL_ONLY");
    assert.equal(reviewKind(row({ status: "UNMATCHED" })), "UNMATCHED");
  });

  test("apply is offered only for unrecorded payments with an amount that were not refunded or disputed", () => {
    assert.equal(canApplyToInvoice(row({ review_reason: "INVOICE_NOT_PAYABLE" })), true);
    assert.equal(canApplyToInvoice(row({ review_reason: "INVOICE_ALREADY_PAID" })), true);
    assert.equal(canApplyToInvoice(row({ status: "UNMATCHED" })), true);
    assert.equal(canApplyToInvoice(row({ review_reason: "ZERO_AMOUNT", amount_minor: 0 })), false);
    assert.equal(canApplyToInvoice(row({ review_reason: "REFUNDED" })), false);
    assert.equal(canApplyToInvoice(row({ review_reason: "DISPUTED" })), false);
    // OVERPAID was already recorded (applied_at set): never applied twice.
    assert.equal(canApplyToInvoice(row({ status: "MATCHED", applied_at: "x", review_reason: "OVERPAID" })), false);
  });

  test("every kind offers at least one way to dismiss, and only its own", () => {
    for (const [kind, options] of Object.entries(RESOLUTIONS_FOR_KIND)) {
      assert.ok(options.length > 0, kind);
      for (const option of options) assert.ok(DISMISS_RESOLUTIONS.includes(option), `${kind}: ${option}`);
    }
    assert.equal(canDismiss(row({ status: "MATCHED", applied_at: "x", review_reason: "OVERPAID" }), "REFUNDED"), true);
    assert.equal(canDismiss(row({ status: "MATCHED", applied_at: "x", review_reason: "OVERPAID" }), "DISPUTE_WON"), false);
    assert.equal(canDismiss(row({ review_reason: "OVERPAID", review_resolved_at: "x" }), "REFUNDED"), false);
  });
});

describe("invoice payment review queue: apply uses the settlement rules", () => {
  test("records at most the amount due; the excess stays in the queue as OVERPAID", () => {
    const decision = decideApply({ businessId: BIZ, row: row({ status: "UNMATCHED" }), invoice: openInvoice, alreadyRecordedMinor: null });
    assert.deepEqual(decision, { kind: "RECORD", amountMinor: 10_000, excessMinor: 2_000 });
    const patch = applyPatch({ invoiceId: "inv", leadId: null, excessMinor: 2_000, userId: "u", now: "t" });
    assert.equal(patch.review_reason, "OVERPAID");
    assert.equal(patch.review_resolved_at, null);
    assert.equal(patch.applied_at, "t");
  });

  test("an exact payment resolves the review as APPLIED", () => {
    const decision = decideApply({ businessId: BIZ, row: row({ amount_minor: 10_000 }), invoice: openInvoice, alreadyRecordedMinor: null });
    assert.deepEqual(decision, { kind: "RECORD", amountMinor: 10_000, excessMinor: 0 });
    const patch = applyPatch({ invoiceId: "inv", leadId: "lead", excessMinor: 0, userId: "u", now: "t" });
    assert.equal(patch.review_resolution, "APPLIED");
    assert.equal(patch.review_resolved_by, "u");
    assert.equal(patch.review_reason, null);
    assert.equal(patch.match_kind, "INVOICE");
  });

  test("a person can never record what a pay token could not", () => {
    const usd = decideApply({ businessId: BIZ, row: row({ currency: "USD" } as never), invoice: openInvoice, alreadyRecordedMinor: null });
    assert.equal(usd.kind, "REFUSE");
    const paid = decideApply({ businessId: BIZ, row: row(), invoice: { ...openInvoice, status: "PAID", paid_minor: 10_000 }, alreadyRecordedMinor: null });
    assert.equal(paid.kind, "REFUSE");
    const draft = decideApply({ businessId: BIZ, row: row(), invoice: { ...openInvoice, status: "DRAFT" }, alreadyRecordedMinor: null });
    assert.equal(draft.kind, "REFUSE");
    const other = decideApply({ businessId: BIZ, row: row(), invoice: { ...openInvoice, business_id: "other" }, alreadyRecordedMinor: null });
    assert.equal(other.kind, "REFUSE");
    const refunded = decideApply({ businessId: BIZ, row: row({ review_reason: "REFUNDED" }), invoice: openInvoice, alreadyRecordedMinor: null });
    assert.equal(refunded.kind, "REFUSE");
  });

  test("a retry or double click records nothing twice", () => {
    const again = decideApply({ businessId: BIZ, row: row(), invoice: { ...openInvoice, status: "PAID", paid_minor: 10_000 }, alreadyRecordedMinor: 10_000 });
    assert.deepEqual(again, { kind: "ALREADY_RECORDED", amountMinor: 10_000, excessMinor: 2_000 });
  });

  test("support counts group open reviews by kind", () => {
    const counts = countByKind([
      row({ review_reason: "OVERPAID", status: "MATCHED", applied_at: "x" }),
      row({ review_reason: "OVERPAID", status: "MATCHED", applied_at: "x" }),
      row({ status: "UNMATCHED" }),
      row({ review_reason: "REFUNDED", review_resolved_at: "x" }),
    ]);
    assert.deepEqual(counts, { total: 3, byKind: { OVERPAID: 2, UNMATCHED: 1 } });
  });
});

describe("invoice payment review queue: wiring", () => {
  const ops = read("src/lib/services/operations/invoice-review.ts");
  const registry = read("src/lib/services/registry.ts");

  test("both operations are registered, UI-only, owner/admin, and loaded", () => {
    for (const name of ["invoice.review_apply_payment", "invoice.review_dismiss_payment"]) {
      assert.match(ops, new RegExp(`defineOperation\\("${name.replace(".", "\\.")}"`));
      const block = registry.slice(registry.indexOf(`name: "${name}"`), registry.indexOf(`name: "${name}"`) + 700);
      assert.match(block, /minimumRole: "admin"/);
      assert.match(block, /callers: \["UI"\]/);
    }
    assert.match(read("src/lib/services/index.ts"), /import "\.\/operations\/invoice-review";/);
    // Apply records money permanently: it must need a person's confirmation.
    const apply = registry.slice(registry.indexOf('name: "invoice.review_apply_payment"'), registry.indexOf('name: "invoice.review_dismiss_payment"'));
    assert.match(apply, /risk: "DESTRUCTIVE"/);
  });

  test("writes are conditional on the row still being open (idempotent)", () => {
    assert.match(ops, /\.is\("applied_at", null\)\s*\.is\("review_resolved_at", null\)/);
    assert.match(ops, /\.is\("review_resolved_at", null\)\s*\.select\("id"\)/);
    // Money is never moved: no Stripe client anywhere in the queue.
    for (const file of ["src/lib/services/operations/invoice-review.ts", "src/lib/invoicing/payment-review-store.ts", "src/lib/invoicing/payment-review.ts"]) {
      assert.doesNotMatch(read(file), /stripe\.|new Stripe|refunds\.create/i, file);
    }
  });

  test("it lives in Settings -> Quotes & invoices, and notices link there", () => {
    assert.match(read("src/app/(app)/app/settings/_sections/quotes-section.tsx"), /<PaymentReviewCard/);
    assert.match(read("src/lib/payments/store.ts"), /linkUrl: "\/app\/settings\?section=quotes#payment-review"/);
    // Invoice payments are not offered for "link to a lead" (that would mark a lead won).
    assert.match(read("src/lib/payments/store.ts"), /match_kind\.is\.null,match_kind\.neq\.INVOICE/);
  });

  test("the service-role store never reaches a client file", () => {
    const card = read("src/components/settings/quotes/payment-review-card.tsx");
    assert.match(card, /^"use client";/);
    assert.doesNotMatch(card, /from "@\/lib\/invoicing\/payment-review-store"(?!;)/);
    assert.match(card, /import type \{ OpenInvoiceOption, PaymentReviewItem \} from "@\/lib\/invoicing\/payment-review-store"/);
    assert.match(read("src/lib/invoicing/payment-review-store.ts"), /^import "server-only";/);
  });
});

describe("migration 0175", () => {
  const sql = read("supabase/migrations/0175_admin_affiliate_gaps.sql");

  test("adds the review resolution and the LinkedIn hold, with RLS forced and SELECT only", () => {
    assert.match(sql, /add column if not exists review_resolved_at timestamptz/);
    assert.match(sql, /create table if not exists public\.linkedin_assist_workspace_holds/);
    assert.match(sql, /business_id uuid primary key references public\.businesses/);
    assert.match(sql, /alter table public\.linkedin_assist_workspace_holds force row level security/);
    assert.match(sql, /revoke all on public\.linkedin_assist_workspace_holds from anon, authenticated/);
    assert.match(sql, /grant select on public\.linkedin_assist_workspace_holds to authenticated/);
    assert.match(sql, /is_business_member\(business_id\)/);
    assert.doesNotMatch(sql, /grant (insert|update|delete|all)/i);
  });

  test("is the only 0175", () => {
    assert.ok(existsSync(new URL("../supabase/migrations/0175_admin_affiliate_gaps.sql", import.meta.url)));
  });
});

describe("admin support signals", () => {
  test("permission grid uses the enforced rules: owner and viewer overrides are ignored", () => {
    const owner = memberPermissionRow({ memberId: "m", name: "O", email: "o", role: "owner", status: "active", row: { can_manage_billing: false } });
    assert.ok(owner.capabilities.every((c) => c.allowed && !c.overridden));
    const viewer = memberPermissionRow({ memberId: "m", name: "V", email: "v", role: "viewer", status: "active", row: { can_send_outbound: true } });
    assert.ok(viewer.capabilities.every((c) => !c.allowed));
    const admin = memberPermissionRow({ memberId: "m", name: "A", email: "a", role: "admin", status: "active", row: { can_manage_billing: true, can_send_outbound: false } });
    const byKey = Object.fromEntries(admin.capabilities.map((c) => [c.key, c]));
    assert.equal(byKey.manage_billing.allowed, true);
    assert.equal(byKey.manage_billing.overridden, true);
    assert.equal(byKey.send_outbound.allowed, false);
    assert.equal(byKey.manage_integrations.overridden, false);
  });

  test("LinkedIn usage counts 7 and 30 days from completion times", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const counts = linkedInSentCounts(
      [
        { kind: "CONNECTION_NOTE", completed_at: "2026-09-27T10:00:00Z" },
        { kind: "FOLLOW_UP", completed_at: "2026-09-25T10:00:00Z" },
        { kind: "CONNECTION_NOTE", completed_at: "2026-09-10T10:00:00Z" },
        { kind: "FOLLOW_UP", completed_at: "2026-08-01T10:00:00Z" },
        { kind: "FOLLOW_UP", completed_at: null },
      ],
      now,
    );
    assert.deepEqual(counts, { sent7d: 2, sent30d: 3, connectionNotes7d: 1 });
  });

  test("a hold needs a real reason", () => {
    assert.equal(normaliseHoldReason("  "), null);
    assert.equal(normaliseHoldReason("x".repeat(501)), null);
    assert.equal(normaliseHoldReason("  complaint   from  LinkedIn "), "complaint from LinkedIn");
  });

  test("pausing is guarded (platform_role + step-up), audited, and the drawer read is audited", () => {
    const actions = read("src/lib/admin/support-signals-actions.ts");
    assert.match(actions, /^"use server";/);
    assert.equal((actions.match(/return guarded\("admin\.linkedin_assist_(paused|resumed)"/g) ?? []).length, 2);
    assert.equal((actions.match(/action: "admin\.linkedin_assist_(paused|resumed)"/g) ?? []).length, 2);
    const loader = read("src/lib/admin/support-signals.ts");
    assert.match(loader, /^import "server-only";/);
    assert.match(loader, /requirePlatformAdmin\(\)/);
    assert.match(loader, /action: "admin\.support_view"/);
    // Read only: the loader never writes tenant data.
    assert.doesNotMatch(loader, /\.(insert|update|upsert|delete)\(/);
    // No secrets or message bodies are selected.
    assert.doesNotMatch(loader, /select\([^)]*(secret|token|body)/);
    // The client drawer imports types only from the server loader's sibling.
    const drawer = read("src/components/admin/customers/customer-support-signals.tsx");
    assert.doesNotMatch(drawer, /@\/lib\/admin\/support-signals"/);
  });

  test("the hold pauses every list, blocks new contacts and stops AI drafts", () => {
    const store = read("src/lib/linkedin-assist/store.ts");
    assert.match(store, /settings: workspaceHold \? \{ \.\.\.own, paused: true \} : own/);
    assert.match(store, /const aiEnabled = aiAllowed && !hold;/);
    assert.match(read("src/lib/services/operations/linkedin-assist.ts"), /if \(workspaceHold\) \{\s*throw new ServiceError\("POLICY_BLOCKED"/);
    // The pacing form keeps the person's own switch, so a hold never becomes a personal pause.
    assert.match(read("src/lib/linkedin-assist/queries.ts"), /settings: \{ \.\.\.settings, paused: personPaused \}/);
  });
});

describe("voice and maintenance in admin", () => {
  test("admin voice ops shows the maintenance call hold, using voice.dial's own rule", () => {
    const ops = read("src/lib/admin/voice-ops.ts");
    assert.match(ops, /outboundPauseUntil\(status, now\)/);
    assert.match(ops, /maintenanceHold: await voiceMaintenanceHold\(now\)/);
    assert.match(read("src/components/admin/system/system-voice-view.tsx"), /ops\.maintenanceHold &&/);
    assert.match(read("src/lib/voice/server-p3.ts"), /return outboundPauseUntil\(status, new Date\(\)\);/);
  });

  test("the runbook no longer says voice ignores maintenance", () => {
    assert.doesNotMatch(read("docs/MAINTENANCE.md"), /Voice dialling is not held by this switch/);
  });
});

describe("affiliate programme gaps", () => {
  test("ledger rows are named, so a write-off never reads as commission", () => {
    assert.equal(ledgerEntryLabel("NEW_CUSTOMER"), "Commission");
    assert.equal(ledgerEntryLabel("WRITE_OFF"), "Written off");
    assert.equal(ledgerEntryLabel("ADJUSTMENT", "WRITE_OFF"), "Written off");
    assert.equal(ledgerEntryLabel("ADJUSTMENT", null), "Adjustment");
    assert.equal(ledgerEntryLabel("REVERSAL"), "Reversal");
    assert.equal(ledgerEntryLabel("REACCRUAL"), "Restored after dispute");
  });

  test("ending a partnership never strands money the partner earned", () => {
    const format = (minor: number) => `£${(minor / 100).toFixed(2)}`;
    assert.match(partnershipCloseBlocker({ availableMinor: 5_000, pendingMinor: 0, openPayouts: 0, format }) ?? "", /£50\.00 of approved/);
    assert.match(partnershipCloseBlocker({ availableMinor: 0, pendingMinor: 900, openPayouts: 0, format }) ?? "", /still in its hold/);
    assert.match(partnershipCloseBlocker({ availableMinor: 0, pendingMinor: 0, openPayouts: 1, format }) ?? "", /1 payout not yet paid/);
    // A negative balance is the owner decision: written off, not blocked.
    assert.equal(partnershipCloseBlocker({ availableMinor: -2_500, pendingMinor: 0, openPayouts: 0, format }), null);
    assert.equal(partnershipCloseBlocker({ availableMinor: 0, pendingMinor: 0, openPayouts: 0, format }), null);
    const action = read("src/lib/admin/affiliate-actions.ts");
    const end = action.slice(action.indexOf("export async function endPartnership"), action.indexOf("export async function reinstateAffiliate"));
    assert.ok(end.indexOf("partnershipCloseBlocker(") < end.indexOf("closePartnership("), "checked before closing");
    assert.match(end, /return guarded\("affiliate\.closed"/);
  });

  test("admin commissions and the partner portal both show the entry type", () => {
    assert.match(read("src/lib/admin/affiliates.ts"), /id, affiliate_id, entry_type, reversal_reason, status/);
    assert.match(read("src/components/admin/affiliates/affiliates-view.tsx"), /ledgerEntryLabel\(row\.entryType, row\.reversalReason\)/);
    assert.match(read("src/lib/affiliates/queries.ts"), /`id, entry_type, status, base_amount_minor/);
    assert.match(read("src/app/affiliates/app/payouts/page.tsx"), /<CommissionHistory rows=\{commissions\}/);
    // The portal reads with the partner's own session (RLS), never the service role.
    const queries = read("src/lib/affiliates/queries.ts");
    const list = queries.slice(queries.indexOf("export async function listCommissions"), queries.indexOf("export async function listPayouts"));
    assert.match(list, /await createClient\(\)/);
    assert.doesNotMatch(list, /createAdminClient|businesses/);
  });

  test("the programme terms are owner-approved (2026-09-28): indexed, no draft note", () => {
    const terms = read("src/app/(marketing)/affiliates/terms/page.tsx");
    assert.doesNotMatch(terms, /index: false/);
    assert.doesNotMatch(terms, /Draft pending/);
    assert.match(terms, /APPROVED BY THE OWNER 2026-09-28/);
  });
});
