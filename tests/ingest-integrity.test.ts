/**
 * Ingest integrity: the release blockers where a lead or a prospect was stored
 * wrongly, or not at all, without anything noticing.
 *
 *   B11  every lead from an ad form inherited the first lead's campaign/ad.
 *   B12  a failed Google Ads insert was skipped and the cursor moved past it.
 *   B13  Meta/LinkedIn/TikTok returned silently on any insert error.
 *   B16  provenance was overwritten on re-discovery and mislabelled on promotion.
 *   B24  Google Places names, addresses and coordinates were persisted.
 *
 * The decisions live in small pure modules so they can be asserted here without
 * a database; the handlers call them.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import {
  ATTRIBUTION_COLUMNS,
  applyAttributionFilter,
  attributionTuple,
  sameAttribution,
} from "../src/lib/jobs/handlers/lead-source-key.ts";
import {
  LeadInsertError,
  googleAdsCursorAfter,
  leadInsertOutcome,
  toSubmittedAt,
} from "../src/lib/integrations/providers/ingest-outcome.ts";
import {
  discoveryGeoInside,
  fillBlanks,
  hasAnyLocation,
  placesCandidateFields,
  placeholderNameFor,
  registeredNameUpdate,
} from "../src/lib/find-leads/server/company-provenance.ts";

/* ------------------------------------------------------------------ B11 */

describe("B11 — lead source attribution is keyed on the full tuple", () => {
  const first = {
    provider: "meta" as const,
    pageId: "p1",
    formId: "f1",
    campaignId: "c1",
    adsetId: "s1",
    adId: "a1",
    campaignName: "Spring",
  };
  const second = { ...first, campaignId: "c2", adsetId: "s2", adId: "a2", campaignName: "Autumn" };

  test("two leads from one form but different ads are different sources", () => {
    assert.equal(sameAttribution(attributionTuple(first), attributionTuple(second)), false);
  });

  test("the same ad is the same source, whatever the display names say", () => {
    const renamed = { ...first, campaignName: "Renamed" };
    assert.equal(sameAttribution(attributionTuple(first), attributionTuple(renamed)), true);
  });

  test("the tuple covers provider, page, form, campaign, ad set and ad", () => {
    assert.deepEqual([...ATTRIBUTION_COLUMNS], [
      "provider",
      "page_id",
      "form_id",
      "campaign_id",
      "adset_id",
      "ad_id",
    ]);
  });

  test("blank ids are null, so '' and missing match each other", () => {
    const tuple = attributionTuple({ provider: "webform", formId: "  ", pageId: undefined });
    assert.equal(tuple.form_id, null);
    assert.equal(tuple.page_id, null);
  });

  test("the lookup is null-safe: null uses IS NULL, a value uses =", () => {
    const calls: string[] = [];
    const fake = {
      eq(column: string, value: string) {
        calls.push(`eq:${column}=${value}`);
        return fake;
      },
      is(column: string, value: null) {
        calls.push(`is:${column}=${value}`);
        return fake;
      },
    };
    applyAttributionFilter(fake, attributionTuple({ provider: "google_ads", formId: "f9", adId: "a9" }));
    assert.deepEqual(calls, [
      "eq:provider=google_ads",
      "is:page_id=null",
      "eq:form_id=f9",
      "is:campaign_id=null",
      "is:adset_id=null",
      "eq:ad_id=a9",
    ]);
  });
});

/* ------------------------------------------------------------------ B13 */

describe("B13 — only a duplicate is swallowed on lead insert", () => {
  test("a created row is returned", () => {
    assert.deepEqual(leadInsertOutcome({ id: "x" }, null), { duplicate: false, row: { id: "x" } });
  });

  test("23505 is a duplicate, not a failure", () => {
    assert.deepEqual(leadInsertOutcome(null, { code: "23505", message: "dup" }), { duplicate: true });
  });

  test("any other error throws, even with no row", () => {
    assert.throws(
      () => leadInsertOutcome(null, { code: "23502", message: "null value in column" }),
      LeadInsertError,
    );
  });

  test("no row and no error is not silently treated as a duplicate", () => {
    assert.throws(() => leadInsertOutcome(null, null), LeadInsertError);
  });

  // Phase 1 (design 03 §1): the four pollers no longer insert at all. Each
  // hands its lead to ingestLead(), which dedupes on the provider's own lead
  // id and throws on any other database error, so the B13 guarantee now lives
  // in one place instead of four copies.
  for (const file of ["meta-lead-ads.ts", "linkedin-ads.ts", "tiktok-ads.ts", "google-ads.ts"]) {
    test(`${file} no longer contains the swallowing pattern`, () => {
      const source = readFileSync(
        path.join(process.cwd(), "src", "lib", "integrations", "providers", file),
        "utf8",
      );
      assert.equal(/error\?\.code === "23505" \|\| !created/.test(source), false);
      assert.match(source, /await ingestLead\(/);
      assert.doesNotMatch(source, /\.from\("leads"\)\s*\.(insert|upsert)\(/);
    });
  }

  test("ingestLead throws on a failed lead write rather than returning quietly", () => {
    const source = readFileSync(path.join(process.cwd(), "src", "lib", "ingest", "service.ts"), "utf8");
    assert.match(source, /fail\("lead insert", error/);
    assert.match(source, /fail\("touch insert", touchError\)/);
    // Only the same provider record (or legacy external id) is a benign duplicate.
    assert.match(source, /conflict === "EXTERNAL_ID"/);
  });
});

/* ------------------------------------------------------------------ B12 */

describe("B12 — the Google Ads cursor never passes a failed row", () => {
  const since = "2026-09-01 00:00:00+01:00";

  test("no failure advances to the newest submission", () => {
    assert.equal(
      googleAdsCursorAfter(since, ["2026-09-02 10:00:00+01:00", "2026-09-03 10:00:00+01:00"], undefined),
      "2026-09-03 10:00:00+01:00",
    );
  });

  test("a failure stops the cursor strictly before the failed row", () => {
    assert.equal(
      googleAdsCursorAfter(
        since,
        ["2026-09-02 10:00:00+01:00", "2026-09-03 10:00:00+01:00"],
        "2026-09-03 10:00:00+01:00",
      ),
      "2026-09-02 10:00:00+01:00",
    );
  });

  test("a row sharing the failed row's second is refetched, not skipped", () => {
    // The query is `> cursor`, so a cursor equal to the failed row's time would lose it.
    assert.equal(
      googleAdsCursorAfter(since, ["2026-09-02 10:00:00+01:00"], "2026-09-02 10:00:00+01:00"),
      since,
    );
  });

  test("a failed row without a timestamp holds the cursor where it was", () => {
    assert.equal(googleAdsCursorAfter(since, ["2026-09-05 10:00:00+01:00"], null), since);
  });

  test("the cursor never moves backwards", () => {
    assert.equal(googleAdsCursorAfter(since, ["2026-08-01 10:00:00+01:00"], undefined), since);
  });

  test("poll stops at a failed ingest and holds the cursor before it", () => {
    // The insert moved into ingestLead(), which throws on a failed write; the
    // poll catches that per submission, stops the walk and saves the cursor
    // strictly before the failed row.
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "integrations", "providers", "google-ads.ts"),
      "utf8",
    );
    assert.match(source, /await ingestSubmission\(businessId, data\);\s*\} catch \(error\) \{\s*failure = /);
    assert.match(source, /googleAdsCursorAfter/);
    assert.match(source, /if \(failure\) throw failure\.error;/);
  });

  test("submission time is kept, parsed to ISO", () => {
    assert.equal(toSubmittedAt("2026-09-02 10:00:00+01:00"), "2026-09-02T09:00:00.000Z");
    assert.equal(toSubmittedAt(1_788_000_000_000), new Date(1_788_000_000_000).toISOString());
    assert.equal(toSubmittedAt("2026-09-02T10:00:00+0000"), "2026-09-02T10:00:00.000Z");
    assert.equal(toSubmittedAt("not a date"), null);
    assert.equal(toSubmittedAt(undefined), null);
  });
});

/* ------------------------------------------------------------------ B16 */

describe("B16 — re-discovery fills blanks, never overwrites", () => {
  test("a non-null field is kept", () => {
    const patch = fillBlanks(
      { name: "Acme Studio Ltd", description: "Our own words", industry: null, location_json: {} },
      { name: "acme.co.uk", description: "Someone else's", industry: "Design", location_json: { city: "Leeds" } },
    );
    assert.deepEqual(patch, { industry: "Design", location_json: { city: "Leeds" } });
  });

  test("an incoming null never blanks a value", () => {
    assert.deepEqual(fillBlanks({ description: "kept" }, { description: null }), {});
  });

  test("external ids merge by key without replacing", () => {
    assert.deepEqual(
      fillBlanks(
        { external_ids: { apollo: "1" } },
        { external_ids: { apollo: "2", google_places: "ChIJ" } },
      ),
      { external_ids: { apollo: "1", google_places: "ChIJ" } },
    );
  });

  test("sourcing-run stamps source_provider on sourced prospects", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "jobs", "handlers", "sourcing-run.ts"),
      "utf8",
    );
    assert.match(source, /source_provider: provider/);
  });

  test("promotion derives intake_method from the prospect's origin", () => {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const file = readdirSync(dir).find((name) => name.startsWith("0114_"));
    assert.ok(file, "migration 0114 exists");
    const sql = readFileSync(path.join(dir, file!), "utf8");
    const body = sql.slice(sql.indexOf("function public.promote_reviewed_prospect"));
    // Sourcing is one branch among several, not the unconditional value.
    assert.match(body, /when p\.source_run_id is not null then 'CLIENTTURN_SOURCING'/);
    assert.match(body, /'import'\s+then 'IMPORT'/);
    assert.match(body, /workspace_app_events/);
    assert.doesNotMatch(body, /\n\s+'CLIENTTURN_SOURCING',\n\s+'SOURCING',/);
  });
});

/* ------------------------------------------------------------------ B24 */

describe("B24 — Google Places is discovery-only", () => {
  const place = {
    id: "ChIJ123",
    displayName: { text: "Acme Web Design" },
    websiteUri: "https://www.acme.co.uk/",
    primaryType: "web_designer",
    formattedAddress: "1 High St, Leeds LS1 1AA, UK",
    location: { latitude: 53.8, longitude: -1.55 },
    addressComponents: [{ longText: "LS1 1AA", types: ["postal_code"] }],
  };

  test("only the place id and the website pointer survive", () => {
    const fields = placesCandidateFields(place);
    assert.ok(fields);
    assert.equal(fields.externalId, "ChIJ123");
    assert.equal(fields.domain, "acme.co.uk");
    assert.equal(fields.websiteUrl, "https://www.acme.co.uk/");
    // Not Places' business name: a placeholder until the site/Companies House says otherwise.
    assert.equal(fields.name, "acme.co.uk");
    assert.equal(fields.industry, null);
    assert.deepEqual(fields.location, {
      country: null,
      region: null,
      city: null,
      postcode: null,
      lat: null,
      lon: null,
    });
    const serialised = JSON.stringify({ ...fields, discoveryOnly: undefined });
    assert.doesNotMatch(serialised, /Acme Web Design|High St|LS1 1AA|53\.8|web_designer/);
  });

  test("coordinates travel only in the transient discovery field", () => {
    const fields = placesCandidateFields(place);
    assert.deepEqual(fields?.discoveryOnly, { lat: 53.8, lon: -1.55 });
  });

  test("a place with no website is dropped: there is no first-party source to name it", () => {
    assert.equal(placesCandidateFields({ ...place, websiteUri: undefined }), null);
  });

  test("the placeholder name is the domain", () => {
    assert.equal(placeholderNameFor("acme.co.uk"), "acme.co.uk");
  });

  test("a discovery geo verdict is read back without coordinates", () => {
    assert.equal(discoveryGeoInside({ discoveryGeo: "INSIDE", lat: null, lon: null }), true);
    assert.equal(discoveryGeoInside({ lat: 1, lon: 2 }), false);
    assert.equal(discoveryGeoInside(null), false);
  });

  test("Companies House replaces the placeholder name, never a real one", () => {
    assert.deepEqual(
      registeredNameUpdate({ name: "acme.co.uk", domain: "acme.co.uk" }, "ACME WEB DESIGN LIMITED"),
      { name: "ACME WEB DESIGN LIMITED" },
    );
    assert.deepEqual(
      registeredNameUpdate({ name: "Acme Studio", domain: "acme.co.uk" }, "ACME WEB DESIGN LIMITED"),
      {},
    );
    assert.deepEqual(registeredNameUpdate({ name: "acme.co.uk", domain: "acme.co.uk" }, null), {});
  });

  test("an all-null location never overwrites a stored one", () => {
    assert.equal(
      hasAnyLocation({ country: null, region: null, city: null, postcode: null, lat: null, lon: null }),
      false,
    );
    assert.equal(hasAnyLocation({ country: "GB", region: null, city: null, postcode: null, lat: null, lon: null }), true);
  });

  test("the provider no longer requests address or display-name fields", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src", "lib", "find-leads", "server", "providers", "google-places.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /places\.formattedAddress|places\.addressComponents|places\.displayName/);
  });
});
