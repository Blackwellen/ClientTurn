/**
 * Regression tests for the Find Leads and engagement repairs of 2026-09-29.
 *
 * Each block names the break it pins. Pure functions are exercised directly;
 * where the defect was a missing call in a server module, the wiring is
 * asserted on the source (the modules are server-only and cannot load under
 * plain `node --test`). The end-to-end proof of the same repairs, against the
 * demo workspace with fakes at the network edge, is
 * tests/stories/find-leads-engagement.test.ts.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { lawfulBasisFor, provenanceTypeForProvider } from "../src/lib/find-leads/contact-legality.ts";
import { reviewPassedByActivation } from "../src/lib/outreach/campaign-state.ts";
import { approvalBlockedReason } from "../src/lib/find-leads/prospect-approval.ts";
import { composeSearchReply } from "../src/lib/find-leads/search-reply.ts";
import {
  extractTextSignals,
  statedDateIsExplicit,
} from "../src/lib/qualification-intelligence/signals.ts";
import {
  companyNumbersFromText,
  isDomainPlaceholderName,
  normaliseCompanyNumber,
} from "../src/lib/find-leads/company-number.ts";
import { verdictForSources } from "../src/lib/compliance/types.ts";

const src = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("provenance: a sourced prospect records where it came from", () => {
  test("first-party providers map to the source kinds a workspace permits", () => {
    assert.equal(provenanceTypeForProvider("website_contacts"), "WEBSITE");
    assert.equal(provenanceTypeForProvider("companies_house"), "REGISTRY");
    assert.equal(provenanceTypeForProvider("meta_engagement"), "FIRST_PARTY");
    assert.equal(provenanceTypeForProvider("linkedin_list_import"), "IMPORT");
    assert.equal(provenanceTypeForProvider("import"), "IMPORT");
    assert.equal(provenanceTypeForProvider("manual_prospect"), "MANUAL");
    assert.equal(provenanceTypeForProvider("hunter"), "LICENSED_PROVIDER");
    assert.equal(provenanceTypeForProvider("some-new-vendor"), null, "an unclassified provider records nothing (stays UNKNOWN)");
    assert.equal(provenanceTypeForProvider(null), null);
  });

  test("the lawful basis of the two free first-party sources is no longer UNKNOWN", () => {
    assert.equal(lawfulBasisFor("website_contacts"), "PUBLISHED_BY_SUBJECT");
    assert.equal(lawfulBasisFor("companies_house"), "PUBLIC_REGISTER");
    assert.equal(lawfulBasisFor("manual_prospect"), "CUSTOMER_ASSERTED");
  });

  test("a website-sourced prospect is PERMITTED for a first-party-only workspace; no row is UNKNOWN", () => {
    const allowed = ["BUSINESS_WEBSITE", "PUBLIC_CORPORATE_REGISTER"] as const;
    assert.equal(verdictForSources([provenanceTypeForProvider("website_contacts")!], [...allowed]), "PERMITTED");
    assert.equal(verdictForSources(["REGISTRY", "WEBSITE"], [...allowed]), "PERMITTED");
    // The old mislabelling: Companies House written as LICENSED_PROVIDER.
    assert.equal(verdictForSources(["LICENSED_PROVIDER"], [...allowed]), "NOT_PERMITTED");
    assert.equal(verdictForSources([], [...allowed]), "UNKNOWN");
  });

  test("the sourcing run, the CSV import and the manual prospect all write a per-prospect provenance row", () => {
    const run = src("src/lib/jobs/handlers/sourcing-run.ts");
    const insertProspect = run.slice(run.indexOf("async function insertProspect"), run.indexOf("/* ------------------------------------------------------ 5. pre-filtering"));
    assert.match(insertProspect, /from\("prospect_data_sources"\)\.insert\(/);
    assert.match(insertProspect, /prospect_id: prospect\.id/);
    assert.match(insertProspect, /provenanceTypeForProvider\(provider\)/);
    assert.doesNotMatch(run, /source_type: "LICENSED_PROVIDER",/, "enrichment must not label Companies House a licensed vendor");
    assert.match(src("src/lib/imports/actions.ts"), /source_type: "IMPORT"/);
    assert.match(src("src/lib/leads/add-lead/actions.ts"), /source_type: "MANUAL"/);
  });
});

describe("campaigns: 'Start after manual review' can actually start", () => {
  test("only a person activating from READY passes the review", () => {
    assert.equal(reviewPassedByActivation({ from: "READY", to: "ACTIVE", actorUserId: "u1" }), true);
    assert.equal(reviewPassedByActivation({ from: "READY", to: "ACTIVE", actorUserId: null }), false, "a system actor never lifts a review");
    assert.equal(reviewPassedByActivation({ from: "PAUSED", to: "ACTIVE", actorUserId: "u1" }), false);
    assert.equal(reviewPassedByActivation({ from: "READY", to: "STOPPED", actorUserId: "u1" }), false);
  });

  test("both activation paths clear review_before_outreach and queue a dispatch", () => {
    const lifecycle = src("src/lib/outreach/campaigns/lifecycle.ts");
    assert.match(lifecycle, /reviewPassed \? \{ review_before_outreach: false \} : \{\}/);
    assert.match(lifecycle, /!campaign\.review_before_outreach \|\| reviewPassed/);
    const actions = src("src/lib/outreach/actions.ts");
    assert.match(actions, /reviewPassed \? \{ review_before_outreach: false \} : \{\}/);
    assert.match(actions, /!campaign\.review_before_outreach \|\| reviewPassed/);
  });

  test("auto-contact creates recipient runs for exactly the prospects it enrolled", () => {
    const run = src("src/lib/jobs/handlers/sourcing-run.ts");
    const enrol = run.slice(run.indexOf("async function enrolAndDispatch"));
    assert.match(enrol, /materializeAudience\(\{[\s\S]*onlyProspectIds: enrolledIds/);
    assert.ok(enrol.indexOf("materializeAudience(") < enrol.indexOf('"outreach.dispatch"'), "runs exist before the dispatch is queued");
    assert.match(src("src/lib/outreach/campaigns/materialize.ts"), /if \(input\.onlyProspectIds\) query = query\.in\("id", input\.onlyProspectIds\)/);
  });
});

describe("prospect approval resolves a review (one rule for drawer, single and bulk)", () => {
  const base = { status: "REVIEW", outreachEligibility: "REVIEW", promotedToLeadId: null };
  test("a REVIEW prospect can be approved; the reason is null", () => {
    assert.equal(approvalBlockedReason(base), null);
    assert.equal(approvalBlockedReason({ ...base, status: "READY", outreachEligibility: "ELIGIBLE" }), null);
  });
  test("suppression, bounce, promotion and prior approval still refuse", () => {
    assert.match(approvalBlockedReason({ ...base, outreachEligibility: "SUPPRESSED" })!, /opted out/);
    assert.match(approvalBlockedReason({ ...base, status: "BOUNCED" })!, /opted out|cannot be reached/);
    assert.match(approvalBlockedReason({ ...base, promotedToLeadId: "l1" })!, /already a lead/);
    assert.match(approvalBlockedReason({ ...base, status: "APPROVED" })!, /already been approved/);
    assert.match(approvalBlockedReason({ ...base, status: "DISCOVERED" })!, /not at a stage/);
  });
  test("the drawer and the single action use it", () => {
    assert.match(src("src/components/find-leads/prospect-drawer.tsx"), /approvalBlockedReason\(/);
    assert.match(src("src/lib/find-leads/actions.ts"), /approvalBlockedReason\(/);
  });
});

describe("search agent: the clarifying question is shown once", () => {
  test("a question already in the reply is not appended again", () => {
    assert.equal(
      composeSearchReply("I can help. What area should I target?", "What area should I target?"),
      "I can help. What area should I target?",
    );
    assert.equal(composeSearchReply("Plan updated.", "Which roles?"), "Plan updated.\n\nWhich roles?");
    assert.equal(composeSearchReply("Plan updated.", null), "Plan updated.");
  });
});

describe("qualification signals: urgency is not a stated deadline", () => {
  const now = new Date("2026-09-28T16:30:00Z");
  test("'Today.' (a callback time) records a TIMEFRAME with no stated date", () => {
    const hits = extractTextSignals("Today.", now);
    const timeframe = hits.find((h) => h.type === "TIMEFRAME");
    assert.ok(timeframe, "urgency still scores as a timeframe");
    assert.equal(timeframe!.statedDate ?? null, null, "no fabricated deadline for a re-engagement check-in");
    assert.equal(statedDateIsExplicit("asap please"), false);
  });
  test("a named month or a number of weeks is still a stated date", () => {
    assert.equal(statedDateIsExplicit("we want it live by March"), true);
    assert.equal(statedDateIsExplicit("in 6 weeks"), true);
    const hits = extractTextSignals("We need the new site live by March.", now);
    assert.ok(hits.find((h) => h.type === "TIMEFRAME")?.statedDate, "named month keeps its date");
  });
});

describe("Companies House identity for a company Google Places found", () => {
  test("reads the registered number from a website footer", () => {
    assert.deepEqual(
      companyNumbersFromText("© 2026 Northwind Studio Ltd. Registered in England and Wales. Company No. 09876543. VAT GB123456789"),
      ["09876543"],
    );
    assert.deepEqual(companyNumbersFromText("Company registration number: SC 123456"), ["SC123456"]);
    assert.deepEqual(companyNumbersFromText("Registered company number 1234567"), ["01234567"]);
  });
  test("a phone or VAT number next to 'registered office' is not a company number", () => {
    assert.deepEqual(companyNumbersFromText("Registered office: 1 High St, Bristol. Tel 01179 123456"), []);
    assert.deepEqual(companyNumbersFromText("VAT registration number 123456789"), []);
    assert.deepEqual(companyNumbersFromText("Call us on 07700 900123"), []);
  });
  test("normalisation and the placeholder test", () => {
    assert.equal(normaliseCompanyNumber("oc 12345"), "OC012345");
    assert.equal(normaliseCompanyNumber("123"), null);
    assert.equal(isDomainPlaceholderName("northwindstudio.co.uk", "northwindstudio.co.uk"), true);
    assert.equal(isDomainPlaceholderName("Northwind Studio Ltd", "northwindstudio.co.uk"), false);
  });
  test("enrichment looks a placeholder up by the number on its own site", () => {
    const ch = src("src/lib/find-leads/server/providers/companies-house.ts");
    assert.match(ch, /isDomainPlaceholderName\(company\.name, company\.domain\)/);
    assert.match(ch, /companyNumberFromWebsite\(company\.domain\)/);
    assert.match(ch, /isPathAllowed\(robots, path\)/);
  });
});

describe("website contact discovery actually returns people, politely", () => {
  test("confidence banding applies only to tasks whose answer has a confidence", () => {
    const schemas = src("src/lib/ai/schemas.ts");
    const banded = schemas.slice(schemas.indexOf("export const CONFIDENCE_BANDED_TASKS"));
    const set = banded.slice(0, banded.indexOf("]);"));
    assert.doesNotMatch(set, /website_contacts/, "website_contacts has no confidence field; banding it discarded every answer");
    for (const task of ["intent_classification", "answer_extraction", "social_reply_classification"]) assert.match(set, new RegExp(task));
    assert.match(src("src/lib/ai/model-router.ts"), /CONFIDENCE_BANDED_TASKS\.has\(input\.taskType\)/);
  });
  test("website-contacts reads robots.txt and skips disallowed paths", () => {
    const provider = src("src/lib/find-leads/server/providers/website-contacts.ts");
    assert.match(provider, /readRobots\(company\.domain\)/);
    assert.match(provider, /if \(!isPathAllowed\(robots, path\)\) continue;/);
  });
});

describe("merge fields: a single-brace token is never sent to a lead", () => {
  test("renderTemplate pauses on {first_name} instead of sending it verbatim", async () => {
    const { renderTemplate, unknownTokens, singleBraceTokens } = await import("../src/lib/messaging/merge-fields.ts");
    const out = renderTemplate("Hi {first_name}, thanks for your enquiry about {service}.", { first_name: "Wendy" }, "follow-up");
    assert.equal(out.ok, false);
    assert.deepEqual((out as { missing: string[] }).missing.sort(), ["{first_name}", "{service}"]);
    assert.deepEqual(unknownTokens("Hi {first_name}", "follow-up"), ["{first_name}"], "refused at save time too");
    const good = renderTemplate("Hi {{first_name}}, a {brace} in a value is fine", { first_name: "{Wendy}" }, "follow-up");
    assert.equal(good.ok, false, "a literal {brace} word in the template is still refused");
    assert.deepEqual(singleBraceTokens("Hi {{first_name}}"), []);
    const value = renderTemplate("Hi {{first_name}}", { first_name: "{odd}" }, "follow-up");
    assert.deepEqual(value, { ok: true, text: "Hi {odd}" }, "a lead's own value is never scanned");
  });
});

describe("send window: the campaign's hours are enforced", () => {
  test("inside, outside, wrap-around and none", async () => {
    const { withinSendWindow } = await import("../src/lib/outreach/send-window.ts");
    const at = (iso: string) => new Date(iso);
    assert.equal(withinSendWindow({ at: at("2026-09-30T10:00:00Z"), timeZone: "Europe/London", start: "09:00", end: "17:00" }), true);
    assert.equal(withinSendWindow({ at: at("2026-09-30T22:30:00Z"), timeZone: "Europe/London", start: "09:00", end: "17:00" }), false);
    assert.equal(withinSendWindow({ at: at("2026-09-30T07:30:00Z"), timeZone: "Europe/London", start: "09:00", end: "17:00" }), false, "08:30 BST is before 09:00");
    assert.equal(withinSendWindow({ at: at("2026-09-30T23:30:00Z"), timeZone: "Europe/London", start: "22:00", end: "02:00" }), true);
    assert.equal(withinSendWindow({ at: at("2026-09-30T03:00:00Z"), timeZone: "Europe/London", start: null, end: null }), true);
  });
  test("the dispatcher checks it before claiming anyone", () => {
    const dispatch = src("src/lib/outreach/dispatch.ts");
    assert.match(dispatch, /haltReason: "OUTSIDE_SEND_WINDOW"/);
  });
});

describe("agent scheduler can be scoped (harness) without changing the cron", () => {
  test("scope filters, and the cron still calls it bare", () => {
    assert.match(src("src/lib/agents/scheduler.ts"), /if \(scope\) dueQuery = dueQuery\.eq\("business_id", scope\.businessId\)/);
    assert.match(src("src/app/api/cron/worker/route.ts"), /scheduleAgents\(\)/);
  });
});

describe("search plan: an agent-written location is read, never reduced to the middle of Great Britain", () => {
  test("aliases and miles are normalised; a place-less location is dropped", async () => {
    const { normaliseAgentLocation, mergePlanPatch, emptyPlan } = await import("../src/lib/find-leads/plan.ts");
    assert.deepEqual(normaliseAgentLocation({ name: "Bournemouth", radiusMiles: 15 }), { country: "GB", city: "Bournemouth", region: null, radiusKm: 24 });
    assert.deepEqual(normaliseAgentLocation({ county: "Dorset" }), { country: "GB", city: null, region: "Dorset", radiusKm: null });
    assert.equal(normaliseAgentLocation({ country: "GB" }), null);
    const { plan } = mergePlanPatch(emptyPlan(), { locations: [{ country: "GB" }, { place: "Poole", radius_km: 10 }] });
    assert.equal(plan.locations.length, 1);
    assert.equal(plan.locations[0].city, "Poole");
    assert.equal(plan.locations[0].radiusKm, 10);
  });
  test("the resolver never geocodes a bare country, and the planner is told the shape", () => {
    assert.match(src("src/lib/find-leads/server/locations.ts"), /if \(!name\) return \{ \.\.\.location, lat: null, lon: null, resolved: false \};/);
    assert.match(src("src/lib/find-leads/server/search-agent.ts"), /LOCATION SHAPE \(each entry of locations\)/);
  });
});

describe("sourcing cost is bounded by what was asked for", () => {
  test("contact discovery stops at a ceiling derived from the target, and sites are read four at a time", () => {
    const run = src("src/lib/jobs/handlers/sourcing-run.ts");
    assert.match(run, /export function contactCeiling\(target: number\): number \{\n  return Math\.max\(25, Math\.ceil\(target\) \* 5\);/);
    assert.match(run, /if \(contacts >= ceiling\) break;/);
    assert.match(run, /limit: Math\.min\(slice\.length \* 3, ceiling - contacts\)/);
    const site = src("src/lib/find-leads/server/providers/website-contacts.ts");
    assert.match(site, /const CONCURRENT_SITES = 4;/);
    assert.match(site, /while \(next < input\.companies\.length && collected < input\.limit\)/);
  });
});

describe("a resumed sourcing run continues, never repeats", () => {
  test("the contact stage starts at the checkpoint offset and stores a person once per run", () => {
    const run = src("src/lib/jobs/handlers/sourcing-run.ts");
    assert.match(run, /case "FINDING_CONTACTS":\n      return findContacts\(context, checkpoint\);/);
    assert.match(run, /for \(let index = startOffset; index < companies\.length; index \+= CONTACT_BATCH\)/);
    assert.match(run, /One person once per run/);
  });
});

describe("Twilio: an API key authenticates with its own secret", () => {
  test("REST calls with an SK key use the key secret; the account SID uses the auth token; webhooks keep the auth token", () => {
    const twilio = src("src/lib/messaging/twilio.ts");
    assert.match(twilio, /if \(authSid\.startsWith\("SK"\) && secrets\.apiKeySecret\) return secrets\.apiKeySecret;/);
    assert.match(twilio, /authToken: restSecretFor\(sid, \{ apiKeySecret: env\.apiKeySecret, authToken: env\.authToken \}\)/);
    assert.match(twilio, /const token = serverEnv\.twilio\.authToken;/, "webhook signatures still use the account auth token");
    assert.match(src("src/lib/env.ts"), /apiKeySecret: optional\("TWILIO_API_KEY_SECRET"\) \?\? optional\("TWILIO_CLIENT_SECRET"\)/);
  });
});
