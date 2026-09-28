import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  MIN_REQUEST_INTERVAL_MS,
  RATE_LIMIT_COOLDOWN_MS,
  createContractsFinderClient,
  domainOf,
  lookbackWindow,
  matchedKeyword,
  parseReleases,
  searchUrl,
  tenderSignals,
  type FetchLike,
  type OcdsPackage,
} from "../src/lib/find-leads/contracts-finder.ts";
import { intentType, intentTypeAvailability } from "../src/lib/find-leads/intent-catalogue.ts";
import { SIGNAL_FEED_PROVIDERS } from "../src/lib/find-leads/signals.ts";
import { evidenceSignalType } from "../src/lib/find-leads/intent-evidence.ts";

/**
 * Contracts Finder: parsing, matching and the rate limit, on RECORDED
 * responses only (tests/fixtures/contracts-finder, two real pages of the OCDS
 * search, contact names and mailboxes redacted). No test reaches the network.
 */

const FIXTURES = path.join(process.cwd(), "tests", "fixtures", "contracts-finder");
const page1 = JSON.parse(readFileSync(path.join(FIXTURES, "search-page-1.json"), "utf8")) as OcdsPackage;
const page2 = JSON.parse(readFileSync(path.join(FIXTURES, "search-page-2.json"), "utf8")) as OcdsPackage;
const NOW = new Date("2026-09-27T12:00:00Z");

function recordedFetch(statusFor: (url: string) => number = () => 200) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const status = statusFor(url);
    return {
      status,
      headers: { get: () => null },
      async json() {
        return url.includes("cursor=") ? page2 : page1;
      },
    };
  };
  return { fetch, calls };
}

function clock() {
  let now = NOW.getTime();
  const slept: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => (now += ms),
    slept,
  };
}

describe("parsing a recorded page", () => {
  const notices = parseReleases(page1);

  test("each notice carries the buyer, its domain, the deadline and a notice link", () => {
    assert.equal(notices.length, 3);
    const first = notices[0];
    assert.equal(first.buyerName, "East Riding of Yorkshire Council");
    assert.equal(first.buyerDomain, "eastriding.gov.uk");
    assert.equal(first.deadline, "2026-10-26T12:00:00Z");
    assert.equal(first.title, "H&C1025 Sexual Health Services");
    assert.match(first.url, /^https:\/\/www\.contractsfinder\.service\.gov\.uk\/Notice\/[0-9a-f-]{36}$/);
    assert.deepEqual(first.value, { amount: 8400000, currency: "GBP" });
    assert.ok(first.cpv.includes("Health and social work services"));
  });

  test("no contact person's name, mailbox or phone survives parsing", () => {
    const text = JSON.stringify(parseReleases(page1).concat(parseReleases(page2)));
    assert.doesNotMatch(text, /procurement@|telephone|contactPoint|\[redacted\]/);
  });

  test("domains are the organisation's", () => {
    assert.equal(domainOf("http://www.eastsussex.gov.uk"), "eastsussex.gov.uk");
    assert.equal(domainOf("someone@Leeds.GOV.uk"), "leeds.gov.uk");
    assert.equal(domainOf("not a domain"), null);
  });
});

describe("matching tenders to the workspace and to companies", () => {
  const notices = [...parseReleases(page1), ...parseReleases(page2)];

  test("a keyword must appear as a whole phrase in the title, description or CPV", () => {
    assert.equal(matchedKeyword(notices[0], ["sexual health"]), "sexual health");
    assert.equal(matchedKeyword(notices[0], ["health and social work"]), "health and social work");
    assert.equal(matchedKeyword(notices[0], ["web design"]), null);
    assert.equal(matchedKeyword(notices[0], []), null, "no keywords, no match");
    assert.equal(matchedKeyword(notices[0], ["he"]), null, "too short to mean anything");
  });

  test("a signal is TENDER_PUBLISHED, organisation-level, with the buyer and the deadline", () => {
    const signals = tenderSignals({ notices, domains: ["https://www.eastriding.gov.uk", "example.com"], keywords: ["sexual health"], now: NOW });
    assert.equal(signals.length, 1);
    const [signal] = signals;
    assert.equal(signal.domain, "eastriding.gov.uk");
    assert.equal(signal.evidence.intentType, "TENDER_PUBLISHED");
    assert.equal(signal.evidence.kind, "TRIGGER_EVENT");
    assert.equal(signal.evidence.source, "Contracts Finder");
    assert.equal(signal.buyer.name, "East Riding of Yorkshire Council");
    assert.equal(signal.deadline, "2026-10-26T12:00:00Z");
    assert.match(signal.evidence.snippet, /East Riding of Yorkshire Council published a tender: .*closes 2026-10-26/);
    assert.equal(evidenceSignalType(signal.evidence), "TENDER_NOTICE");
  });

  test("a closed tender, an unknown buyer or an unmatched keyword gives nothing", () => {
    const later = new Date("2026-11-30T00:00:00Z");
    assert.deepEqual(tenderSignals({ notices, domains: ["eastriding.gov.uk"], keywords: ["sexual health"], now: later }), []);
    assert.deepEqual(tenderSignals({ notices, domains: ["nowhere.example"], keywords: ["sexual health"], now: NOW }), []);
    assert.deepEqual(tenderSignals({ notices, domains: ["eastriding.gov.uk"], keywords: ["taxi"], now: NOW }), []);
  });

  test("one signal per buyer and notice, however often it is listed", () => {
    const signals = tenderSignals({ notices: [...notices, ...notices], domains: ["eastsussex.gov.uk"], keywords: ["passenger assistant"], now: NOW });
    assert.equal(signals.length, 2, "two distinct East Sussex notices");
  });
});

describe("the client respects the service", () => {
  test("pages are followed through links.next and requests are spaced", async () => {
    const { fetch, calls } = recordedFetch();
    const c = clock();
    const client = createContractsFinderClient({ fetch, now: c.now, sleep: c.sleep });
    const outcome = await client.search(new Date("2026-09-20T00:00:00Z"), new Date("2026-09-27T00:00:00Z"));
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.pages, 2);
    assert.equal(outcome.notices.length, 6);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\/Published\/Notices\/OCDS\/Search\?publishedFrom=2026-09-20T00%3A00%3A00Z&publishedTo=2026-09-27T00%3A00%3A00Z&stages=tender&limit=100/);
    assert.ok(c.slept.every((ms) => ms <= MIN_REQUEST_INTERVAL_MS) && c.slept.length >= 1, "the second request waited");
  });

  test("a 403 stops at once and blocks every request for five minutes", async () => {
    const { fetch, calls } = recordedFetch(() => 403);
    const c = clock();
    const client = createContractsFinderClient({ fetch, now: c.now, sleep: c.sleep });
    const first = await client.search(new Date("2026-09-20T00:00:00Z"), NOW);
    assert.deepEqual(first.ok ? null : first.code, "PROVIDER_RATE_LIMIT");
    const second = await client.search(new Date("2026-09-20T00:00:00Z"), NOW);
    assert.equal(second.ok, false);
    assert.equal(calls.length, 1, "no request while cooling down");
    assert.ok(client.blockedUntil() - c.now() >= RATE_LIMIT_COOLDOWN_MS - MIN_REQUEST_INTERVAL_MS);
    c.advance(RATE_LIMIT_COOLDOWN_MS + 1);
    await client.search(new Date("2026-09-20T00:00:00Z"), NOW);
    assert.equal(calls.length, 2, "tries again after the cooldown");
  });

  test("a rate limit on a later page keeps what the earlier pages found", async () => {
    const { fetch } = recordedFetch((url) => (url.includes("cursor=") ? 403 : 200));
    const c = clock();
    const client = createContractsFinderClient({ fetch, now: c.now, sleep: c.sleep });
    const outcome = await client.search(new Date("2026-09-20T00:00:00Z"), NOW);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.ok && outcome.truncated, true);
    assert.equal(outcome.notices.length, 3);
  });

  test("a next link to another host is never followed", async () => {
    const hostile = { ...page1, links: { next: "https://evil.example/steal" } };
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      return { status: 200, headers: { get: () => null }, json: async () => hostile };
    };
    const c = clock();
    const client = createContractsFinderClient({ fetch, now: c.now, sleep: c.sleep });
    const outcome = await client.search(new Date("2026-09-20T00:00:00Z"), NOW);
    assert.equal(calls.length, 1);
    assert.equal(outcome.ok && outcome.truncated, true);
  });

  test("the look-back is capped at 30 days and the URL is the documented search", () => {
    const { from } = lookbackWindow(NOW, 365);
    assert.equal(Math.round((NOW.getTime() - from.getTime()) / 86_400_000), 30);
    assert.match(searchUrl(from, NOW, 100), /^https:\/\/www\.contractsfinder\.service\.gov\.uk\/Published\/Notices\/OCDS\/Search\?/);
  });
});

describe("the catalogue", () => {
  test("TENDER_PUBLISHED is detected from public tenders, and no longer says 'not connected'", () => {
    const entry = intentType("TENDER_PUBLISHED");
    assert.ok(entry.sources.some((s) => s.source === "PUBLIC_TENDERS" && s.role === "DETECTED"));
    assert.doesNotMatch(entry.caveat ?? "", /not connected/i);
    assert.deepEqual(SIGNAL_FEED_PROVIDERS.PUBLIC_TENDERS, ["contracts_finder"]);
    const availability = intentTypeAvailability("TENDER_PUBLISHED", new Set(["PUBLIC_TENDERS"]));
    assert.equal(availability.available, true);
    assert.deepEqual(availability.liveSources, ["PUBLIC_TENDERS"]);
  });
});
