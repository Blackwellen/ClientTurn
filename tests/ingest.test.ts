/**
 * ingestLead() — the one intake path (docs/revenue-engine/03-phase1-spine-design.md §1).
 *
 * The decisions live in pure modules (normalise.ts, plan.ts, identity/resolve.ts)
 * so every outcome of the contract is asserted here without a database; the
 * structural checks at the end hold service.ts to the pipeline order.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  companyDomainOf,
  companyKey,
  normaliseEmail,
  normaliseIngest,
  normalisePhoneE164,
  normaliseSubmittedAt,
} from "../src/lib/ingest/normalise.ts";
import {
  domainEventFor,
  idempotencyKeyFor,
  insertConflictKind,
  processModeFor,
  replayOf,
  suppressionVerdict,
  validityProblem,
  writePlan,
} from "../src/lib/ingest/plan.ts";
import {
  INGEST_OUTCOMES,
  createdViaFor,
  defaultRelationshipFor,
  ingestInputSchema,
  intakeMethodFor,
  INGEST_SOURCE_TYPES,
} from "../src/lib/ingest/types.ts";
import {
  MERGEABLE_LEAD_FIELDS,
  PROVENANCE_FIELDS,
  mergePatch,
} from "../src/lib/identity/resolve.ts";
import {
  googleAdsWebhookSchema,
  googleAdsWebhookToIngest,
  googleKeyMatches,
} from "../src/lib/ingest/google-ads-webhook.ts";

const BUSINESS = "11111111-1111-4111-8111-111111111111";
const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

function input(overrides: Record<string, unknown> = {}) {
  return ingestInputSchema.parse({
    businessId: BUSINESS,
    source: { type: "AD_FORM", provider: "meta", providerRecordId: "L1", caller: { type: "SYSTEM" } },
    person: { email: " Jo@Acme.co.uk ", phone: "07700 900123", firstName: "  Jo ", lastName: "Bloggs" },
    ...overrides,
  });
}

/* ------------------------------------------------------------ normalise */

describe("normalisation", () => {
  test("email is trimmed and lower-cased", () => {
    assert.deepEqual(normaliseEmail("  Jo.Bloggs@Acme.CO.UK "), { ok: true, value: "jo.bloggs@acme.co.uk" });
  });

  test("an email that is not an address fails rather than becoming an identity key", () => {
    for (const bad of ["jo", "jo@", "@acme.com", "jo@acme", "jo bloggs@acme.com", "a,b@acme.com"]) {
      assert.equal(normaliseEmail(bad).ok, false, bad);
    }
    assert.deepEqual(normaliseEmail(""), { ok: true, value: null });
    assert.deepEqual(normaliseEmail(undefined), { ok: true, value: null });
  });

  test("phone is E.164 with GB as the default region", () => {
    const cases: [string, string][] = [
      ["07700 900123", "+447700900123"],
      ["+44 (0)7700 900123", "+447700900123"],
      ["0044 7700 900123", "+447700900123"],
      ["447700900123", "+447700900123"],
      ["7700900123", "+447700900123"],
      ["+44 07700 900123", "+447700900123"],
      ["+1 (415) 555-0100", "+14155550100"],
      ["whatsapp:+447700900123", "+447700900123"],
    ];
    for (const [raw, expected] of cases) {
      assert.deepEqual(normalisePhoneE164(raw), { ok: true, value: expected }, raw);
    }
  });

  test("a phone that cannot be placed fails", () => {
    for (const bad of ["12", "call me", "+12345678901234567", "0"]) {
      assert.equal(normalisePhoneE164(bad).ok, false, bad);
    }
  });

  test("names are trimmed and UTM values lower-cased", () => {
    const n = normaliseIngest(
      input({
        source: {
          type: "WEB_FORM",
          provider: "webform",
          utm: { source: " Google ", medium: "CPC", campaign: "Spring_Sale" },
          caller: { type: "SYSTEM" },
        },
      }),
    );
    assert.equal(n.person.firstName, "Jo");
    assert.equal(n.person.email, "jo@acme.co.uk");
    assert.equal(n.person.phone, "+447700900123");
    assert.deepEqual(n.utm, { source: "google", medium: "cpc", campaign: "spring_sale", term: null, content: null });
  });

  test("an invalid email is dropped with a reason when a phone arrived with it", () => {
    const n = normaliseIngest(input({ person: { email: "not-an-email", phone: "07700900123" } }));
    assert.equal(n.person.email, null);
    assert.equal(n.person.phone, "+447700900123");
    assert.deepEqual(n.reasons, ["email_invalid"]);
    assert.equal(validityProblem(n.person, { type: "AD_FORM" }), null);
  });

  test("submission time is the provider's, parsed to ISO", () => {
    assert.equal(normaliseSubmittedAt("2026-09-02 10:00:00+01:00"), "2026-09-02T09:00:00.000Z");
    assert.equal(normaliseSubmittedAt("2026-09-02T10:00:00+0000"), "2026-09-02T10:00:00.000Z");
    assert.equal(normaliseSubmittedAt(1_788_000_000_000), new Date(1_788_000_000_000).toISOString());
    assert.equal(normaliseSubmittedAt("soon"), null);
  });

  test("company keys and domains for weak matching", () => {
    assert.equal(companyKey("Acme Studio Ltd."), companyKey("acme studio limited"));
    assert.equal(companyDomainOf("jo@acme.co.uk"), "acme.co.uk");
    assert.equal(companyDomainOf("jo@gmail.com"), null);
  });
});

/* -------------------------------------------------------------- validity */

describe("validation", () => {
  test("the schema rejects a non-uuid workspace and an unknown source type", () => {
    assert.equal(ingestInputSchema.safeParse({ ...input(), businessId: "x" }).success, false);
    assert.equal(
      ingestInputSchema.safeParse({ ...input(), source: { type: "FAX", provider: "x", caller: { type: "SYSTEM" } } }).success,
      false,
    );
  });

  test("no email and no phone is INVALID", () => {
    assert.equal(validityProblem({ email: null, phone: null }, { type: "AD_FORM" }), "no_contact_point");
  });

  test("except a social DM, whose thread id is the identity", () => {
    assert.equal(validityProblem({ email: null, phone: null }, { type: "SOCIAL_DM", providerRecordId: "messenger:1" }), null);
    assert.equal(validityProblem({ email: null, phone: null }, { type: "SOCIAL_DM" }), "no_contact_point");
  });

  test("and a manual landline-only lead, only when the trusted caller says so", () => {
    assert.equal(
      validityProblem({ email: null, phone: null }, { type: "MANUAL" }, { allowWithoutContactPoint: true }),
      null,
    );
    assert.equal(
      validityProblem({ email: null, phone: null }, { type: "API" }, { allowWithoutContactPoint: true }),
      "no_contact_point",
    );
  });

  test("the outcome vocabulary is the contract", () => {
    assert.deepEqual([...INGEST_OUTCOMES], ["CREATED", "MERGED", "DUPLICATE", "SUPPRESSED", "INVALID", "REVIEW", "REJECTED"]);
  });
});

/* ----------------------------------------------------------- idempotency */

describe("idempotency", () => {
  test("the caller's key wins, then the provider record, else none", () => {
    assert.equal(idempotencyKeyFor({ idempotencyKey: "abc", provider: "api", providerRecordId: "x" }), "key:abc");
    assert.equal(idempotencyKeyFor({ provider: "meta", providerRecordId: "L1" }), "record:meta:L1");
    assert.equal(idempotencyKeyFor({ provider: "manual" }), null);
  });

  test("a repeated key returns the first outcome unchanged, as DUPLICATE", () => {
    const replay = replayOf(
      { outcome: "CREATED", lead_id: "lead-1", touch_id: "touch-1", matched_by: null, reasons: ["x"], request_hash: "h1" },
      "h1",
    );
    assert.deepEqual(replay, {
      outcome: "DUPLICATE",
      leadId: "lead-1",
      touchId: "touch-1",
      matchedBy: "IDEMPOTENCY_KEY",
      reasons: ["x"],
      originalOutcome: "CREATED",
    });
  });

  test("a key reused with a different body is reported, never silently the same request", () => {
    const replay = replayOf(
      { outcome: "MERGED", lead_id: "l", touch_id: "t", matched_by: "EMAIL", reasons: [], request_hash: "h1" },
      "h2",
    );
    assert.ok(replay.reasons.includes("idempotency_key_reused_with_different_body"));
    assert.equal(replay.outcome, "DUPLICATE");
  });
});

/* ----------------------------------------------------------- suppression */

describe("suppression", () => {
  const person = { email: "jo@acme.co.uk", phone: "+447700900123" };

  test("nothing suppressed", () => {
    assert.deepEqual(suppressionVerdict(person, { email: null, sms: null, whatsapp: null }), {
      fullySuppressed: false,
      reasons: [],
    });
  });

  test("every supplied destination suppressed is SUPPRESSED", () => {
    const verdict = suppressionVerdict(person, {
      email: { reason: "OPT_OUT" },
      sms: { reason: "OPT_OUT" },
      whatsapp: { reason: "OPT_OUT" },
    });
    assert.equal(verdict.fullySuppressed, true);
    assert.equal(verdict.reasons.length, 3);
  });

  test("a partly suppressed person is still contactable on the rest, and says which", () => {
    const verdict = suppressionVerdict(person, { email: null, sms: { reason: "OPT_OUT" }, whatsapp: null });
    assert.equal(verdict.fullySuppressed, false);
    assert.deepEqual(verdict.reasons, ["suppressed:SMS:OPT_OUT"]);
  });

  test("an SMS-only STOP does not make a phone-only person fully suppressed (WhatsApp may still be permitted)", () => {
    const verdict = suppressionVerdict({ email: null, phone: "+447700900123" }, { email: null, sms: { reason: "OPT_OUT" }, whatsapp: null });
    assert.equal(verdict.fullySuppressed, false);
  });
});

/* ------------------------------------------------------ outcome per case */

describe("outcome per identity decision", () => {
  test("same provider record -> DUPLICATE, no write", () => {
    assert.deepEqual(writePlan({ kind: "DUPLICATE", leadId: "L", rule: "PROVIDER_RECORD", confidence: 1 }, false), {
      action: "DUPLICATE",
      leadId: "L",
    });
  });

  test("strong match -> MERGED, or SUPPRESSED when every destination is blocked", () => {
    const merge = { kind: "MERGE" as const, leadId: "L", rule: "EMAIL" as const, confidence: 1, notes: [] };
    assert.equal((writePlan(merge, false) as { outcome: string }).outcome, "MERGED");
    assert.equal((writePlan(merge, true) as { outcome: string }).outcome, "SUPPRESSED");
  });

  test("conflict -> REVIEW, recorded as a new lead, never merged", () => {
    const plan = writePlan({ kind: "REVIEW", conflictLeadId: "OTHER", rule: "PHONE_CONFLICT", notes: [] }, false);
    assert.deepEqual(plan, { action: "INSERT", outcome: "REVIEW", conflictLeadId: "OTHER", linkProspectId: null });
  });

  test("new person -> CREATED, or SUPPRESSED (recorded, never contacted)", () => {
    const fresh = { kind: "NEW" as const, linkProspectId: "P", weak: [] };
    assert.deepEqual(writePlan(fresh, false), { action: "INSERT", outcome: "CREATED", conflictLeadId: null, linkProspectId: "P" });
    assert.equal((writePlan(fresh, true) as { outcome: string }).outcome, "SUPPRESSED");
  });

  test("an identity-index conflict on insert is retried as a merge; an external id one is a duplicate", () => {
    assert.equal(
      insertConflictKind({ code: "23505", message: 'duplicate key value violates unique constraint "leads_identity_email_key"' }),
      "IDENTITY",
    );
    assert.equal(
      insertConflictKind({ code: "23505", message: 'duplicate key value violates unique constraint "leads_business_id_external_id_key"' }),
      "EXTERNAL_ID",
    );
    assert.equal(insertConflictKind({ code: "23502", message: "null value" }), null);
    assert.equal(insertConflictKind(null), null);
  });
});

/* ----------------------------------------------------- no provenance overwrite */

describe("a merge fills blanks only and never touches provenance", () => {
  test("present values are kept; blanks are filled; the before-snapshot names only what changed", () => {
    const { patch, before } = mergePatch(
      { first_name: "Jo", last_name: null, email: "jo@acme.co.uk", phone: "", postcode: "BH1 1AA" },
      { first_name: "Joanna", last_name: "Bloggs", email: "other@acme.co.uk", phone: "+447700900123", postcode: null },
    );
    assert.deepEqual(patch, { last_name: "Bloggs", phone: "+447700900123" });
    assert.deepEqual(before, { last_name: null, phone: "" });
  });

  test("an incoming null never blanks a value", () => {
    assert.deepEqual(mergePatch({ company_name: "Acme" }, { company_name: null }).patch, {});
  });

  test("no provenance column is mergeable", () => {
    const mergeable = new Set<string>(MERGEABLE_LEAD_FIELDS);
    for (const field of PROVENANCE_FIELDS) {
      assert.equal(mergeable.has(field), false, `${field} must never be rewritten by a later touch`);
    }
  });

  test("the service's merge update is built from mergePatch alone", () => {
    const service = read("src", "lib", "ingest", "service.ts");
    const mergeBlock = service.slice(service.indexOf("// MERGE: fill blanks only"), service.indexOf("/* touch ---"));
    assert.match(mergeBlock, /mergePatch\(/);
    for (const field of ["intake_method", "created_via", "source_id", "relationship_type", "external_id"]) {
      assert.equal(mergeBlock.includes(field), false, `the merge path writes ${field}`);
    }
  });
});

/* ------------------------------------------------------ lead.process mode */

describe("lead.process mode", () => {
  test("only a brand-new contactable lead gets the full run", () => {
    assert.equal(processModeFor({ outcome: "CREATED", sourceType: "AD_FORM" }), "FULL");
    assert.equal(processModeFor({ outcome: "MERGED", sourceType: "AD_FORM" }), "RECORD_ONLY");
    assert.equal(processModeFor({ outcome: "SUPPRESSED", sourceType: "AD_FORM" }), "RECORD_ONLY");
    assert.equal(processModeFor({ outcome: "REVIEW", sourceType: "AD_FORM" }), "RECORD_ONLY");
    assert.equal(processModeFor({ outcome: "CREATED", sourceType: "SOCIAL_DM" }), "RECORD_ONLY");
    assert.equal(processModeFor({ outcome: "CREATED", sourceType: "CSV", requested: "RECORD_ONLY" }), "RECORD_ONLY");
  });

  test("the domain event is lead.created for a new lead and lead.touched otherwise", () => {
    assert.deepEqual(domainEventFor({ outcome: "CREATED", inserted: true, leadId: "L", touchId: "T" }), {
      type: "lead.created",
      dedupeKey: "lead.created:L",
    });
    assert.deepEqual(domainEventFor({ outcome: "MERGED", inserted: false, leadId: "L", touchId: "T" }), {
      type: "lead.touched",
      dedupeKey: "lead.touched:T",
    });
  });
});

/* ---------------------------------------------------------- vocabularies */

describe("provenance vocabularies match the database", () => {
  // 0135 widened the leads CHECK; the latest definition is the one that binds.
  const leadsIntake = read("supabase", "migrations", "0135_ad_platform_intake_methods.sql");
  const createdVia = read("supabase", "migrations", "0040_manual_lead_intake.sql");

  test("every intake_method and created_via ingest writes is allowed by its CHECK", () => {
    for (const type of INGEST_SOURCE_TYPES) {
      for (const provider of ["meta", "google_ads", "linkedin_ads", "tiktok_ads", "pipedrive", "api"]) {
        assert.ok(leadsIntake.includes(`'${intakeMethodFor(type, provider)}'`), `${type}/${provider}`);
      }
      assert.ok(createdVia.includes(`'${createdViaFor(type)}'`), type);
    }
  });

  test("each ad platform's form lead is recorded under its own intake method", () => {
    assert.equal(intakeMethodFor("AD_FORM", "google_ads"), "GOOGLE_ADS");
    assert.equal(intakeMethodFor("AD_FORM", "linkedin_ads"), "LINKEDIN_ADS");
    assert.equal(intakeMethodFor("AD_FORM", "tiktok_ads"), "TIKTOK_ADS");
    assert.equal(intakeMethodFor("AD_FORM", "meta"), "META");
    assert.equal(intakeMethodFor("AD_FORM", "someone_new"), "OTHER");
  });

  test("forms and DMs default to THEY_CONTACTED_US; everything else must say", () => {
    assert.equal(defaultRelationshipFor("AD_FORM"), "THEY_CONTACTED_US");
    assert.equal(defaultRelationshipFor("WEB_FORM"), "THEY_CONTACTED_US");
    assert.equal(defaultRelationshipFor("SOCIAL_DM"), "THEY_CONTACTED_US");
    assert.equal(defaultRelationshipFor("CSV"), "UNKNOWN");
    assert.equal(defaultRelationshipFor("API"), "UNKNOWN");
  });
});

/* ------------------------------------------------------- pipeline order */

describe("service.ts follows the pipeline order", () => {
  const service = read("src", "lib", "ingest", "service.ts");

  test("validate, normalise, idempotency, suppression, identity, write, touch, permission, queue, emit", () => {
    const steps = [
      "ingestInputSchema.safeParse(",
      "normaliseIngest(",
      '.from("ingest_requests")',
      "await suppressionFacts(",
      "resolveIdentity(",
      '.from("leads").insert(',
      '.from("lead_touches")',
      "await upsertPermission(",
      '"lead.process"',
      "await emitDomainEvent(",
    ];
    let at = service.indexOf("export async function ingestLead(");
    for (const step of steps) {
      const next = service.indexOf(step, at);
      assert.ok(next > at, `${step} is out of order`);
      at = next;
    }
  });

  test("lead.process is keyed by the touch id", () => {
    assert.match(service, /idempotencyKey: `lead\.process:touch:\$\{touchId\}`/);
  });

  test("WhatsApp consent scope only on an explicit WhatsApp opt-in", () => {
    assert.match(service, /input\.consent\?\.whatsapp === true \? \["WHATSAPP"\] : \[\]/);
  });
});

/* ------------------------------------------------ Google Ads webhook payload */

describe("Google Ads lead-form webhook", () => {
  const body = googleAdsWebhookSchema.parse({
    lead_id: "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    api_version: "1.0",
    form_id: 40000000,
    campaign_id: 20000000,
    adgroup_id: 30000000,
    creative_id: 50000000,
    google_key: "secret",
    is_test: true,
    gcl_id: "gcl-1",
    user_column_data: [
      { column_id: "FULL_NAME", column_name: "Full Name", string_value: "Jo Bloggs" },
      { column_id: "EMAIL", column_name: "User Email", string_value: "jo@acme.co.uk" },
      { column_id: "PHONE_NUMBER", column_name: "User Phone", string_value: "+447700900123" },
      { column_name: "What do you need?", string_value: "A new website" },
    ],
  });

  test("maps onto the one intake contract", () => {
    const mapped = ingestInputSchema.parse(googleAdsWebhookToIngest(BUSINESS, "22222222-2222-4222-8222-222222222222", body));
    assert.equal(mapped.source.type, "AD_FORM");
    assert.equal(mapped.source.provider, "google_ads");
    assert.equal(mapped.source.providerRecordId, body.lead_id);
    assert.equal(mapped.source.formId, "40000000");
    assert.equal(mapped.source.adsetId, "30000000");
    assert.equal(mapped.source.gclid, "gcl-1");
    assert.equal(mapped.person.firstName, "Jo");
    assert.equal(mapped.person.lastName, "Bloggs");
    assert.equal(mapped.person.email, "jo@acme.co.uk");
    assert.deepEqual(mapped.answers, { "What do you need?": "A new website" });
  });

  test("the key is compared in constant time and a missing stored key never matches", () => {
    assert.equal(googleKeyMatches("secret", "secret"), true);
    assert.equal(googleKeyMatches("secret", "Secret"), false);
    assert.equal(googleKeyMatches("secret", "secret-but-longer"), false);
    assert.equal(googleKeyMatches("secret", null), false);
    assert.equal(googleKeyMatches("", ""), false);
  });

  test("the route verifies, records, acknowledges and queues, and never ingests in the request", () => {
    const route = read("src", "app", "api", "webhooks", "google-ads", "route.ts");
    const verify = route.indexOf("googleKeyMatches(");
    const record = route.indexOf('.from("webhook_events")');
    const queue = route.indexOf('"ingest.webhook"');
    assert.ok(verify > 0 && record > verify && queue > record);
    assert.doesNotMatch(route, /ingestLead\(/);
    assert.match(route, /Response\.json\(\{\}, \{ status: 200 \}\)/);
    // The key is a credential: verified, then dropped from what is stored.
    assert.match(route, /const \{ google_key: _key, \.\.\.stored \} = lead;/);
  });
});
