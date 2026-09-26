/**
 * CRM pull (brief §29): the opt-in inbound sync from HubSpot, Salesforce and
 * Zoho. The decisions are pure (src/lib/integrations/crm-pull/plan.ts) and are
 * asserted here without a network or a database; the structural checks hold
 * the job to the one intake path and to its safety rules.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  advanceCrmCursor,
  crmIngestInput,
  crmProviderRecordId,
  crmRunStatus,
  decideCrmRecord,
  initialCrmCursor,
  isAfterCursor,
  isCrmPullProvider,
  ownerUserIdFor,
  parseCrmCursor,
  serialiseCrmCursor,
  soqlDateTime,
  sortForCursor,
  type CrmPulledRecord,
} from "../src/lib/integrations/crm-pull/plan.ts";
import { ingestInputSchema } from "../src/lib/ingest/types.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (relative: string) =>
  readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const INTEGRATION = "22222222-2222-4222-8222-222222222222";

function record(overrides: Partial<CrmPulledRecord> = {}): CrmPulledRecord {
  return {
    externalId: "101",
    objectType: "contact",
    firstName: "Priya",
    lastName: "Shah",
    email: "priya@studio.co.uk",
    phone: null,
    companyName: "Studio Ltd",
    roleTitle: "Director",
    postcode: "EC1A 1BB",
    createdAt: "2026-09-20T09:00:00.000Z",
    modifiedAt: "2026-09-26T10:00:00.000Z",
    ownerEmail: null,
    ...overrides,
  };
}

describe("cursor", () => {
  test("round-trips through its stored form", () => {
    const cursor = { modifiedAt: "2026-09-26T10:00:00.000Z", externalId: "abc" };
    assert.deepEqual(parseCrmCursor(serialiseCrmCursor(cursor)), cursor);
  });

  test("an unreadable cursor is no cursor, never the start of history", () => {
    assert.equal(parseCrmCursor(null), null);
    assert.equal(parseCrmCursor("not json"), null);
    assert.equal(parseCrmCursor(JSON.stringify({ modifiedAt: "yesterday-ish" })), null);
  });

  test("a freshly enabled pull starts now", () => {
    const now = new Date("2026-09-26T12:00:00.000Z");
    assert.deepEqual(initialCrmCursor(now), { modifiedAt: now.toISOString(), externalId: "" });
  });

  test("ties at the cursor's instant are broken on the id", () => {
    const cursor = { modifiedAt: "2026-09-26T10:00:00.000Z", externalId: "105" };
    assert.equal(isAfterCursor(record({ externalId: "104" }), cursor), false);
    assert.equal(isAfterCursor(record({ externalId: "105" }), cursor), false);
    assert.equal(isAfterCursor(record({ externalId: "106" }), cursor), true);
    assert.equal(isAfterCursor(record({ modifiedAt: "2026-09-26T10:00:01.000Z", externalId: "001" }), cursor), true);
    assert.equal(isAfterCursor(record({ modifiedAt: "2026-09-26T09:59:59.000Z", externalId: "999" }), cursor), false);
  });

  test("a record with no usable modified time is never after the cursor", () => {
    assert.equal(isAfterCursor(record({ modifiedAt: "" }), null), false);
  });

  test("records sort oldest first, ties on the id", () => {
    const sorted = sortForCursor([
      record({ externalId: "b", modifiedAt: "2026-09-26T10:00:00Z" }),
      record({ externalId: "c", modifiedAt: "2026-09-26T09:00:00Z" }),
      record({ externalId: "a", modifiedAt: "2026-09-26T10:00:00Z" }),
    ]);
    assert.deepEqual(sorted.map((r) => r.externalId), ["c", "a", "b"]);
  });

  test("advances past handled records and stops at the first failure", () => {
    const cursor = { modifiedAt: "2026-09-26T09:00:00.000Z", externalId: "" };
    const next = advanceCrmCursor(cursor, [
      { record: record({ externalId: "1", modifiedAt: "2026-09-26T09:10:00.000Z" }), ok: true },
      { record: record({ externalId: "2", modifiedAt: "2026-09-26T09:20:00.000Z" }), ok: false },
      { record: record({ externalId: "3", modifiedAt: "2026-09-26T09:30:00.000Z" }), ok: true },
    ]);
    assert.deepEqual(next, { modifiedAt: "2026-09-26T09:10:00.000Z", externalId: "1" });
  });

  test("a failure on the first record leaves the cursor where it was", () => {
    const cursor = { modifiedAt: "2026-09-26T09:00:00.000Z", externalId: "" };
    const next = advanceCrmCursor(cursor, [
      { record: record({ externalId: "1", modifiedAt: "2026-09-26T09:10:00.000Z" }), ok: false },
    ]);
    assert.deepEqual(next, cursor);
  });

  test("never moves backwards", () => {
    const cursor = { modifiedAt: "2026-09-26T12:00:00.000Z", externalId: "z" };
    const next = advanceCrmCursor(cursor, [
      { record: record({ modifiedAt: "2026-09-26T11:00:00.000Z" }), ok: true },
    ]);
    assert.deepEqual(next, cursor);
  });

  test("SOQL datetimes are second precision, unquoted UTC", () => {
    assert.equal(soqlDateTime("2026-09-26T10:11:12.345Z"), "2026-09-26T10:11:12Z");
  });
});

describe("per record", () => {
  test("a record ClientTurn pushed is never re-ingested (loop prevention)", () => {
    assert.deepEqual(decideCrmRecord(record(), new Set(["101"])), {
      action: "SKIP",
      reason: "pushed_by_clientturn",
    });
  });

  test("a record with no email and no phone is skipped without an ingest call", () => {
    assert.deepEqual(decideCrmRecord(record({ email: null, phone: " " }), new Set()), {
      action: "SKIP",
      reason: "no_contact_point",
    });
  });

  test("anything else is ingested", () => {
    assert.deepEqual(decideCrmRecord(record(), new Set(["999"])), { action: "INGEST" });
    assert.deepEqual(decideCrmRecord(record({ email: null, phone: "07700900123" }), new Set()), {
      action: "INGEST",
    });
  });

  test("the owner maps to a member by email, case-insensitively", () => {
    const members = [
      { userId: "u1", email: "Alex@Agency.co.uk" },
      { userId: "u2", email: null },
    ];
    assert.equal(ownerUserIdFor("alex@agency.co.uk ", members), "u1");
    assert.equal(ownerUserIdFor("nobody@agency.co.uk", members), null);
    assert.equal(ownerUserIdFor(null, members), null);
  });
});

describe("the ingest contract", () => {
  const input = crmIngestInput({
    businessId: BUSINESS,
    provider: "hubspot",
    integrationId: INTEGRATION,
    record: record(),
  });

  test("is source CRM, with the provider and the record id", () => {
    assert.equal(input.source.type, "CRM");
    assert.equal(input.source.provider, "hubspot");
    assert.equal(input.source.providerRecordId, "contact:101");
    assert.equal(crmProviderRecordId(record({ objectType: "lead", externalId: "00Q1" })), "lead:00Q1");
  });

  test("carries the CRM's own created time, so speed-to-lead starts there", () => {
    assert.equal(input.source.submittedAt, "2026-09-20T09:00:00.000Z");
  });

  test("relationship is IMPORTED: a CRM row is never a marketing basis (§29)", () => {
    assert.equal(input.relationship, "IMPORTED");
    assert.equal(input.consent, undefined);
  });

  test("the caller is the connector", () => {
    assert.deepEqual(input.source.caller, { type: "CONNECTOR", id: INTEGRATION });
  });

  test("passes the ingest schema for every provider", () => {
    for (const provider of ["hubspot", "salesforce", "zoho_crm"] as const) {
      const parsed = ingestInputSchema.safeParse(
        crmIngestInput({ businessId: BUSINESS, provider, integrationId: INTEGRATION, record: record() }),
      );
      assert.equal(parsed.success, true, provider);
    }
  });

  test("clips over-long fields rather than failing the record", () => {
    const long = crmIngestInput({
      businessId: BUSINESS,
      provider: "salesforce",
      integrationId: INTEGRATION,
      record: record({ companyName: "x".repeat(500), postcode: "  " }),
    });
    assert.equal(long.person.companyName?.length, 200);
    assert.equal(long.person.postcode, undefined);
    assert.equal(ingestInputSchema.safeParse(long).success, true);
  });

  test("only the three CRMs pull", () => {
    assert.equal(isCrmPullProvider("hubspot"), true);
    assert.equal(isCrmPullProvider("salesforce"), true);
    assert.equal(isCrmPullProvider("zoho_crm"), true);
    assert.equal(isCrmPullProvider("pipedrive"), false);
  });
});

describe("run status", () => {
  test("OK, PARTIAL and FAILED", () => {
    assert.equal(crmRunStatus({ handled: 10, failed: false, rateLimited: false }), "OK");
    assert.equal(crmRunStatus({ handled: 4, failed: true, rateLimited: false }), "PARTIAL");
    assert.equal(crmRunStatus({ handled: 0, failed: false, rateLimited: true }), "PARTIAL");
    assert.equal(crmRunStatus({ handled: 0, failed: true, rateLimited: false }), "FAILED");
  });
});

describe("structure", () => {
  const handler = read("src/lib/jobs/handlers/crm-pull.ts");

  test("every record goes through ingestLead, never a direct lead insert", () => {
    assert.match(handler, /ingestLead\(/);
    assert.doesNotMatch(handler, /from\("leads"\)\s*\.insert/);
  });

  test("imported contacts are recorded only, never followed up automatically", () => {
    assert.match(handler, /mode: "RECORD_ONLY"/);
  });

  test("a pull switched off or a disconnected CRM does nothing", () => {
    assert.match(handler, /if \(!row\?\.enabled \|\| !integration\) return;/);
    assert.match(handler, /integration\.status === "DISCONNECTED"\) return;/);
  });

  test("the loop-prevention lookup covers push records and entity links", () => {
    assert.match(handler, /from\("crm_push_records"\)/);
    assert.match(handler, /from\("external_entity_links"\)/);
  });

  test("the cursor is written only from advanceCrmCursor", () => {
    assert.match(handler, /advanceCrmCursor\(cursor, handled\)/);
  });

  test("each adapter implements pull and registers it", () => {
    for (const [file, name] of [
      ["src/lib/integrations/providers/hubspot.ts", "hubspot"],
      ["src/lib/integrations/providers/salesforce.ts", "salesforce"],
      ["src/lib/integrations/providers/zoho-crm.ts", "zoho_crm"],
    ] as const) {
      const source = read(file);
      assert.match(source, /async function pull\(/, file);
      assert.match(source, new RegExp(`registerCrmProvider\\("${name}", \\{[^}]*\\bpull\\b`), file);
      assert.match(source, /rateLimited: true/, file);
    }
  });

  test("the setting defaults to off in the migration", () => {
    const sql = read("supabase/migrations/0127_crm_pull_templates_email_meetings.sql");
    assert.match(sql, /enabled boolean not null default false/);
    assert.match(sql, /crm_push_records_external_idx/);
  });

  test("the worker queues the sweep", () => {
    assert.match(read("src/app/api/cron/worker/route.ts"), /scheduleCrmPullSweep\(\)/);
    assert.match(read("src/lib/jobs/register.ts"), /registerHandler\("crm\.pull", handleCrmPull\)/);
  });
});
