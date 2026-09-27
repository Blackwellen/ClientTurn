import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CREDIT_NOTE_PREFIX,
  DEFAULT_INVOICE_PREFIX,
  allocateNumber,
  auditSequence,
  formatDocumentNumber,
  isUnique,
  parseDocumentNumber,
  validatePrefix,
} from "../src/lib/invoicing/numbering.ts";
import { addDays, computeReminderSchedule, invoiceDueDate, nextReminder } from "../src/lib/invoicing/reminders.ts";

describe("invoice numbering", () => {
  test("prefix + zero-padded sequence", () => {
    assert.equal(formatDocumentNumber("INV-", 1), "INV-00001");
    assert.equal(formatDocumentNumber("ACME/2026-", 123, 4), "ACME/2026-0123");
    assert.equal(formatDocumentNumber("INV-", 123456), "INV-123456");
    assert.equal(DEFAULT_INVOICE_PREFIX, "INV-");
    assert.equal(DEFAULT_CREDIT_NOTE_PREFIX, "CN-");
  });

  test("prefix rules", () => {
    for (const ok of ["INV-", "A", "ACME/2026-", "Q1"]) assert.equal(validatePrefix(ok), true, ok);
    for (const bad of ["", "inv-", "-INV", "INV 1", "INV_", "ABCDEFGHIJKLMNOPQ"]) assert.equal(validatePrefix(bad), false, bad);
    assert.throws(() => formatDocumentNumber("bad prefix", 1));
    assert.throws(() => formatDocumentNumber("INV-", 0));
    assert.throws(() => formatDocumentNumber("INV-", 1.5));
  });

  test("allocation advances the counter and never repeats", () => {
    let counter = { prefix: "INV-", nextSeq: 41, width: 5 };
    const numbers: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const next = allocateNumber(counter);
      numbers.push(next.number);
      counter = next.counter;
    }
    assert.deepEqual(numbers, ["INV-00041", "INV-00042", "INV-00043", "INV-00044", "INV-00045"]);
    assert.equal(counter.nextSeq, 46);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  test("duplicates are detected case-insensitively; gaps are allowed and reported", () => {
    assert.equal(isUnique(["INV-00001"], "inv-00001"), false);
    assert.equal(isUnique(["INV-00001"], "INV-00002"), true);
    assert.deepEqual(auditSequence(["INV-00001", "INV-00002", "INV-00005", "INV-00002"], "INV-"), { duplicates: ["INV-00002"], gaps: [3, 4] });
    assert.deepEqual(auditSequence(["INV-00001", "INV-00003"], "INV-"), { duplicates: [], gaps: [2] });
  });

  test("parse", () => {
    assert.equal(parseDocumentNumber("INV-00042", "INV-"), 42);
    assert.equal(parseDocumentNumber("CN-00042", "INV-"), null);
    assert.equal(parseDocumentNumber("INV-4a", "INV-"), null);
  });
});

describe("reminder schedule", () => {
  test("golden: default offsets, weekends moved to Monday", () => {
    // Due Friday 2026-10-16.
    const schedule = computeReminderSchedule({ issueDate: "2026-10-02", dueDate: "2026-10-16" });
    assert.deepEqual(schedule.map((s) => [s.step, s.offsetDays, s.kind, s.sendOn]), [
      [1, -3, "BEFORE_DUE", "2026-10-13"],
      [2, 0, "ON_DUE", "2026-10-16"],
      [3, 3, "OVERDUE", "2026-10-19"], // Mon 19th
      [4, 7, "OVERDUE", "2026-10-23"],
      [5, 14, "OVERDUE", "2026-10-30"],
    ]);
  });

  test("weekend collisions merge; no reminder on or before the issue day", () => {
    const schedule = computeReminderSchedule({ issueDate: "2026-10-14", dueDate: "2026-10-17", offsetsDays: [-3, 0, 1, 2] });
    // -3 = 14th (issue day, dropped); 0 = Sat 17 -> Mon 19; +1 = Sun 18 -> Mon 19 (merged); +2 = Mon 19 (merged)
    assert.deepEqual(schedule.map((s) => s.sendOn), ["2026-10-19"]);
  });

  test("weekend skipping can be turned off", () => {
    const schedule = computeReminderSchedule({ issueDate: "2026-10-01", dueDate: "2026-10-17", offsetsDays: [0], skipWeekends: false });
    assert.equal(schedule[0].sendOn, "2026-10-17");
  });

  test("next reminder: the latest due one, earlier missed ones skipped", () => {
    const schedule = computeReminderSchedule({ issueDate: "2026-10-02", dueDate: "2026-10-16" });
    assert.deepEqual(nextReminder({ schedule, status: "OPEN", sentSteps: [], today: "2026-10-12" }), { send: false, reason: "NOTHING_DUE" });
    const burst = nextReminder({ schedule, status: "OPEN", sentSteps: [], today: "2026-10-20" });
    assert.ok(burst.send);
    if (burst.send) {
      assert.equal(burst.step.step, 3);
      assert.deepEqual(burst.skipped, [1, 2]);
    }
    const afterSent = nextReminder({ schedule, status: "PARTIALLY_PAID", sentSteps: [1, 2, 3], today: "2026-10-20" });
    assert.deepEqual(afterSent, { send: false, reason: "NOTHING_DUE" });
    assert.deepEqual(nextReminder({ schedule, status: "OPEN", sentSteps: [1, 2, 3, 4, 5], today: "2026-12-01" }), { send: false, reason: "ALL_SENT" });
  });

  test("settled invoices are never reminded", () => {
    const schedule = computeReminderSchedule({ issueDate: "2026-10-02", dueDate: "2026-10-16" });
    for (const status of ["PAID", "VOID", "UNCOLLECTIBLE", "DRAFT"] as const) {
      assert.deepEqual(nextReminder({ schedule, status, sentSteps: [], today: "2026-12-01" }), { send: false, reason: "SETTLED" });
    }
  });

  test("dates", () => {
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-03-29", 1), "2026-03-30"); // BST change does not shift a calendar date
    assert.throws(() => addDays("31/12/2026", 1));
  });

  test("due dates from schedule rules", () => {
    assert.equal(invoiceDueDate({ due: { type: "ON_ACCEPTANCE" }, acceptedOn: "2026-10-02", termsDays: 14 }), "2026-10-02");
    assert.equal(invoiceDueDate({ due: { type: "DAYS_AFTER_ACCEPTANCE", days: 30 }, acceptedOn: "2026-10-02", termsDays: 14 }), "2026-11-01");
    assert.equal(invoiceDueDate({ due: { type: "ON_COMPLETION" }, acceptedOn: "2026-10-02", completedOn: "2026-11-20", termsDays: 14 }), "2026-12-04");
    assert.equal(invoiceDueDate({ due: { type: "ON_COMPLETION" }, acceptedOn: "2026-10-02", termsDays: 14 }), null);
  });
});
