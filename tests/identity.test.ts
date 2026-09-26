/**
 * Identity resolution (docs/revenue-engine/03-phase1-spine-design.md §2):
 * every row of the rule table, the conflict case, prospects, and the
 * migration's race-safety indexes.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  isWeakMatch,
  resolveIdentity,
  type IdentityLead,
  type IdentityProspect,
} from "../src/lib/identity/resolve.ts";

function lead(overrides: Partial<IdentityLead> & { id: string }): IdentityLead {
  return {
    email: null,
    phone: null,
    firstName: null,
    lastName: null,
    companyName: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function prospect(overrides: Partial<IdentityProspect> & { id: string }): IdentityProspect {
  return { ...lead(overrides), promotedToLeadId: null, ...overrides };
}

const probe = {
  email: "jo@acme.co.uk",
  phone: "+447700900123",
  firstName: "Jo",
  lastName: "Bloggs",
  companyName: "Acme Studio Ltd",
};

const none = { providerRecordLeadId: null, leads: [], prospects: [] };

describe("the rule table, in order", () => {
  test("same (provider, providerRecordId) -> DUPLICATE, whatever else matches", () => {
    const decision = resolveIdentity(probe, {
      providerRecordLeadId: "L-record",
      leads: [lead({ id: "L-email", email: "jo@acme.co.uk" })],
      prospects: [],
    });
    assert.deepEqual(decision, { kind: "DUPLICATE", leadId: "L-record", rule: "PROVIDER_RECORD", confidence: 1 });
  });

  test("same normalised email -> MERGE (strong)", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [lead({ id: "L1", email: "JO@acme.co.uk", phone: "+447700900123" })],
    });
    assert.equal(decision.kind, "MERGE");
    if (decision.kind === "MERGE") {
      assert.equal(decision.leadId, "L1");
      assert.equal(decision.rule, "EMAIL");
      assert.equal(decision.confidence, 1);
      assert.deepEqual(decision.notes, []);
    }
  });

  test("an email match with a different phone still merges, and says the phone was kept", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [lead({ id: "L1", email: "jo@acme.co.uk", phone: "+447700900999" })],
    });
    assert.equal(decision.kind, "MERGE");
    if (decision.kind === "MERGE") assert.deepEqual(decision.notes, ["phone_differs_kept_existing"]);
  });

  test("same phone, email absent on the existing lead -> MERGE (strong)", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [lead({ id: "L2", phone: "+447700900123" })],
    });
    assert.equal(decision.kind, "MERGE");
    if (decision.kind === "MERGE") {
      assert.equal(decision.rule, "PHONE");
      assert.equal(decision.leadId, "L2");
    }
  });

  test("same phone, email absent on the incoming side -> MERGE", () => {
    const decision = resolveIdentity(
      { ...probe, email: null },
      { ...none, leads: [lead({ id: "L2", phone: "+447700900123", email: "someone@acme.co.uk" })] },
    );
    assert.equal(decision.kind, "MERGE");
  });

  test("same phone but a different email -> REVIEW, never merged", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [lead({ id: "L3", phone: "+447700900123", email: "reception@acme.co.uk" })],
    });
    assert.deepEqual(decision, {
      kind: "REVIEW",
      conflictLeadId: "L3",
      rule: "PHONE_CONFLICT",
      notes: ["same_phone_different_email"],
    });
  });

  test("same name + company, no shared contact field -> NEW plus a weak candidate", () => {
    const decision = resolveIdentity(
      { ...probe, email: "jo.bloggs@gmail.com", phone: null },
      {
        ...none,
        leads: [lead({ id: "L4", firstName: "jo", lastName: "BLOGGS", companyName: "acme studio limited", email: "jb@acme.co.uk" })],
      },
    );
    assert.deepEqual(decision, { kind: "NEW", linkProspectId: null, weak: [{ kind: "LEAD", id: "L4" }] });
  });

  test("same name + company domain -> weak", () => {
    assert.equal(
      isWeakMatch(
        { ...probe, phone: null, companyName: null, email: "jo@acme.co.uk" },
        lead({ id: "x", firstName: "Jo", lastName: "Bloggs", email: "joanne@acme.co.uk" }),
      ),
      true,
    );
  });

  test("a free-mail domain is not company evidence", () => {
    assert.equal(
      isWeakMatch(
        { ...probe, phone: null, companyName: null, email: "jo@gmail.com" },
        lead({ id: "x", firstName: "Jo", lastName: "Bloggs", email: "joanne@gmail.com" }),
      ),
      false,
    );
  });

  test("a first name alone is never evidence", () => {
    assert.equal(
      isWeakMatch({ ...probe, lastName: null }, lead({ id: "x", firstName: "Jo", companyName: "Acme Studio Ltd" })),
      false,
    );
  });

  test("nothing matches -> NEW", () => {
    assert.deepEqual(resolveIdentity(probe, none), { kind: "NEW", linkProspectId: null, weak: [] });
  });

  test("with several email matches (pre-existing duplicates) the oldest wins", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [
        lead({ id: "newer", email: "jo@acme.co.uk", createdAt: "2026-05-01T00:00:00.000Z" }),
        lead({ id: "older", email: "jo@acme.co.uk", createdAt: "2026-02-01T00:00:00.000Z" }),
      ],
    });
    assert.equal(decision.kind === "MERGE" && decision.leadId, "older");
  });
});

describe("prospects", () => {
  test("a prospect already promoted routes to its lead instead of a duplicate", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      prospects: [prospect({ id: "P1", email: "jo@acme.co.uk", promotedToLeadId: "L-promoted" })],
    });
    assert.equal(decision.kind, "MERGE");
    if (decision.kind === "MERGE") {
      assert.equal(decision.leadId, "L-promoted");
      assert.equal(decision.rule, "PROSPECT_PROMOTION");
    }
  });

  test("an unpromoted prospect for the same person is linked to the new lead", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      prospects: [prospect({ id: "P2", email: "jo@acme.co.uk" })],
    });
    assert.deepEqual(decision, { kind: "NEW", linkProspectId: "P2", weak: [] });
  });

  test("a prospect sharing only the phone but with a different email is not linked", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      prospects: [prospect({ id: "P3", phone: "+447700900123", email: "other@acme.co.uk" })],
    });
    assert.deepEqual(decision, { kind: "NEW", linkProspectId: null, weak: [] });
  });

  test("a lead match outranks a prospect match", () => {
    const decision = resolveIdentity(probe, {
      ...none,
      leads: [lead({ id: "L1", email: "jo@acme.co.uk" })],
      prospects: [prospect({ id: "P1", email: "jo@acme.co.uk", promotedToLeadId: "L-other" })],
    });
    assert.equal(decision.kind === "MERGE" && decision.leadId, "L1");
  });
});

describe("race safety in the migration (0123)", () => {
  const dir = path.join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir).find((name) => name.startsWith("0123_"));
  const sql = file ? readFileSync(path.join(dir, file), "utf8") : "";

  test("the migration exists", () => assert.ok(file));

  test("unique identity indexes exclude archived, test and parked-duplicate leads", () => {
    for (const index of ["leads_identity_email_key", "leads_identity_phone_key"]) {
      const at = sql.indexOf(`create unique index ${index}`);
      assert.ok(at > 0, index);
      const body = sql.slice(at, sql.indexOf(";", at));
      assert.match(body, /archived_at is null/);
      assert.match(body, /not is_test/);
      assert.match(body, /identity_duplicate_of is null/);
    }
  });

  test("existing duplicates are reported and parked as merge candidates before the index is built", () => {
    const notice = sql.indexOf("raise notice '0123: % email duplicate");
    const park = sql.indexOf("'EXISTING_DUPLICATE_EMAIL'", notice);
    const stamp = sql.indexOf("set identity_duplicate_of = r.keeper", park);
    const index = sql.indexOf("create unique index leads_identity_email_key");
    assert.ok(notice > 0 && park > notice && stamp > park && index > stamp);
  });

  test("promotion links to an existing lead rather than duplicating it", () => {
    const fn = sql.slice(sql.indexOf("function public.promote_reviewed_prospect"));
    assert.match(fn, /l\.email_normalized = v_email/);
    assert.match(fn, /'PROSPECT_PROMOTION'/);
    assert.match(fn, /'PHONE_CONFLICT'/);
  });

  test("every merge is reversible: merge_events keeps a before-snapshot and a reverted_at", () => {
    const table = sql.slice(sql.indexOf("create table public.merge_events"));
    assert.match(table, /before jsonb not null/);
    assert.match(table, /reverted_at timestamptz/);
  });
});
