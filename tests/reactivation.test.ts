import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  applyReactivationFilters,
  filterCampaignRows,
  paginateCampaignRows,
  parseReactivationFilters,
  resolveFilterRange,
  sortCampaignRows,
  hasActiveReactivationFilters,
  advancedFilterCount,
  PAGE_SIZE,
} from "../src/lib/campaigns/reactivation-filters.ts";
import {
  allowedActions,
  bookingRate,
  campaignIconKey,
  canPerform,
  isFinal,
  progressTone,
  qualificationRate,
  replyRate,
  STATUS_BANNER,
} from "../src/lib/campaigns/reactivation-types.ts";
import {
  fixtureRows,
  fixtureDetail,
  REACTIVATION_FIXTURES,
} from "../src/lib/campaigns/reactivation-fixtures.ts";
import {
  initialWizardState,
  resolvedAudienceLabel,
  splitTags,
} from "../src/components/reactivation/wizard/state.ts";

const NOW = new Date("2024-11-01T12:00:00.000Z");
const rows = fixtureRows(NOW.getTime());

const base = parseReactivationFilters({});

/* ------------------------------------------------------------ parsing --- */

describe("filter parsing", () => {
  test("defaults to the card view, no filters, sorted by last updated", () => {
    assert.equal(base.view, "cards");
    assert.equal(base.status, "all");
    assert.equal(base.sort, "updated");
    assert.equal(base.page, 1);
    assert.equal(hasActiveReactivationFilters(base), false);
  });

  test("an explicit view in the URL beats the stored preference", () => {
    assert.equal(parseReactivationFilters({ view: "list" }, "cards").view, "list");
    assert.equal(parseReactivationFilters({}, "list").view, "list");
  });

  test("junk values fall back rather than throwing", () => {
    const parsed = parseReactivationFilters({
      status: "NONSENSE",
      sort: "sideways",
      view: "grid",
      page: "-4",
      range: "eventually",
    });
    assert.equal(parsed.status, "all");
    assert.equal(parsed.sort, "updated");
    assert.equal(parsed.view, "cards");
    assert.equal(parsed.page, 1);
    assert.equal(parsed.range, "all");
  });

  test("advanced filters are counted for the More filters badge", () => {
    const parsed = parseReactivationFilters({
      channel: "sms",
      hasReplies: "1",
    });
    assert.equal(advancedFilterCount(parsed), 2);
    assert.equal(hasActiveReactivationFilters(parsed), true);
  });
});

/* ----------------------------------------------------------- filtering --- */

describe("filtering", () => {
  test("search covers name, description, audience and tags", () => {
    const byName = filterCampaignRows(rows, { ...base, q: "autumn" }, NOW);
    assert.deepEqual(byName.map((r) => r.name), ["Autumn Roof Check"]);

    const byDescription = filterCampaignRows(rows, { ...base, q: "winter" }, NOW);
    assert.deepEqual(byDescription.map((r) => r.name), ["Guttering Reminder"]);

    const byAudience = filterCampaignRows(
      rows,
      { ...base, q: "commercial leads" },
      NOW,
    );
    assert.deepEqual(byAudience.map((r) => r.name), ["Commercial Outreach"]);

    const byTag = filterCampaignRows(rows, { ...base, q: "emergency" }, NOW);
    assert.equal(byTag.length, 1);
  });

  test("search is case insensitive", () => {
    assert.equal(
      filterCampaignRows(rows, { ...base, q: "AUTUMN" }, NOW).length,
      1,
    );
  });

  test("status narrows to one lifecycle state", () => {
    const running = filterCampaignRows(rows, { ...base, status: "RUNNING" }, NOW);
    assert.equal(running.length, 3);
    assert.ok(running.every((r) => r.status === "RUNNING"));
  });

  test("audience matches the exact label", () => {
    const filtered = filterCampaignRows(
      rows,
      { ...base, audience: "Expired quotes" },
      NOW,
    );
    assert.deepEqual(filtered.map((r) => r.name), ["Quote Follow Up"]);
  });

  test("has-replies and has-bookings drop empty campaigns", () => {
    const withReplies = filterCampaignRows(rows, { ...base, hasReplies: true }, NOW);
    assert.ok(withReplies.every((r) => r.replies > 0));
    // The draft has sent nothing, so it must not survive either filter.
    assert.ok(!withReplies.some((r) => r.name === "Spring Maintenance"));
  });

  test("channel filter separates SMS from WhatsApp", () => {
    const whatsapp = filterCampaignRows(rows, { ...base, channel: "whatsapp" }, NOW);
    assert.deepEqual(whatsapp.map((r) => r.name), ["Guttering Reminder"]);
  });

  test("filters combine rather than replace each other", () => {
    // "expired" appears only in Quote Follow Up's description, so this also
    // pins that a RUNNING+search pair intersects rather than unions.
    const combined = filterCampaignRows(
      rows,
      { ...base, status: "RUNNING", q: "expired" },
      NOW,
    );
    assert.deepEqual(combined.map((r) => r.name), ["Quote Follow Up"]);
  });

  test("search reaches tags, not just the visible name and description", () => {
    // "Past Quotes" is a tag on Autumn Roof Check and nowhere in its text.
    const byTag = filterCampaignRows(rows, { ...base, q: "past quotes" }, NOW);
    assert.ok(byTag.some((r) => r.name === "Autumn Roof Check"));
  });

  test("a filter matching nothing returns empty, not everything", () => {
    assert.equal(
      filterCampaignRows(rows, { ...base, q: "zzzznomatch" }, NOW).length,
      0,
    );
  });
});

/* -------------------------------------------------------------- dates --- */

describe("date range", () => {
  test("presets resolve to a start date and open end", () => {
    const range = resolveFilterRange({ ...base, range: "30d" }, NOW);
    assert.ok(range.from instanceof Date);
    assert.equal(range.to, null);
  });

  test("this year starts on 1 January", () => {
    const range = resolveFilterRange({ ...base, range: "year" }, NOW);
    assert.equal(range.from?.toISOString().slice(0, 10), "2024-01-01");
  });

  test("a custom range uses the supplied days inclusively", () => {
    const range = resolveFilterRange(
      { ...base, range: "custom", from: "2024-10-01", to: "2024-10-31" },
      NOW,
    );
    assert.equal(range.from?.toISOString().slice(0, 10), "2024-10-01");
    assert.equal(range.to?.toISOString().slice(0, 10), "2024-10-31");
  });

  test("a range filters on the created date", () => {
    const october = filterCampaignRows(
      rows,
      { ...base, range: "custom", from: "2024-10-01", to: "2024-10-31" },
      NOW,
    );
    assert.equal(october.length, 4);
  });

  test("an incomplete custom range does not filter anything out", () => {
    const range = resolveFilterRange({ ...base, range: "custom" }, NOW);
    assert.equal(range.from, null);
    assert.equal(range.to, null);
  });
});

/* ------------------------------------------------------------ sorting --- */

describe("sorting", () => {
  test("name A–Z and Z–A are exact reverses", () => {
    const asc = sortCampaignRows(rows, "name_asc").map((r) => r.name);
    const desc = sortCampaignRows(rows, "name_desc").map((r) => r.name);
    assert.deepEqual(asc, [...desc].reverse());
    assert.equal(asc[0], "Autumn Roof Check");
  });

  test("most sent leads with the largest campaign", () => {
    assert.equal(sortCampaignRows(rows, "sent")[0].name, "Dormant Leads Q3");
  });

  test("most booked leads with the most bookings", () => {
    assert.equal(sortCampaignRows(rows, "booked")[0].booked, 36);
  });

  test("highest conversion ranks by booked per message sent", () => {
    const top = sortCampaignRows(rows, "conversion")[0];
    const ratio = (r: (typeof rows)[number]) =>
      r.sent === 0 ? 0 : r.booked / r.sent;
    assert.ok(rows.every((r) => ratio(r) <= ratio(top)));
  });

  test("created oldest puts the earliest campaign first", () => {
    assert.equal(sortCampaignRows(rows, "created_asc")[0].name, "Emergency Repair");
  });

  test("sorting does not mutate the input array", () => {
    const before = rows.map((r) => r.id);
    sortCampaignRows(rows, "name_desc");
    assert.deepEqual(rows.map((r) => r.id), before);
  });
});

/* --------------------------------------------------------- pagination --- */

describe("pagination", () => {
  test("the card view fits eight per page and the list ten", () => {
    assert.equal(PAGE_SIZE.cards, 8);
    assert.equal(PAGE_SIZE.list, 10);
  });

  test("all eight reference campaigns fit on one card page", () => {
    const page = paginateCampaignRows(rows, base);
    assert.equal(page.total, 8);
    assert.equal(page.rows.length, 8);
    assert.equal(page.page, 1);
  });

  test("a page beyond the end clamps rather than rendering empty", () => {
    const page = paginateCampaignRows(rows, { ...base, page: 99 });
    assert.equal(page.page, 1);
    assert.equal(page.rows.length, 8);
  });

  test("a second page returns the remainder", () => {
    const many = [...rows, ...rows].map((row, index) => ({
      ...row,
      id: row.id + "-" + index,
    }));
    const second = paginateCampaignRows(many, { ...base, page: 2 });
    assert.equal(second.total, 16);
    assert.equal(second.rows.length, 8);
    assert.equal(second.page, 2);
  });
});

/* ------------------------------------------------------ full pipeline --- */

describe("the filter pipeline", () => {
  test("filters, sorts and paginates in that order", () => {
    const page = applyReactivationFilters(
      rows,
      { ...base, status: "RUNNING", sort: "name_asc" },
      NOW,
    );
    assert.deepEqual(page.rows.map((r) => r.name), [
      "Autumn Roof Check",
      "Commercial Outreach",
      "Quote Follow Up",
    ]);
    assert.equal(page.total, 3);
  });

  test("switching view keeps the same filtered set", () => {
    const filters = { ...base, status: "PAUSED" as const };
    const cards = applyReactivationFilters(rows, filters, NOW);
    const list = applyReactivationFilters(
      rows,
      { ...filters, view: "list" },
      NOW,
    );
    assert.deepEqual(
      cards.rows.map((r) => r.id),
      list.rows.map((r) => r.id),
    );
  });
});

/* -------------------------------------------------- status transitions --- */

describe("status transitions", () => {
  test("a running campaign can pause and cancel but not resume or delete", () => {
    assert.equal(canPerform("RUNNING", "pause"), true);
    assert.equal(canPerform("RUNNING", "cancel"), true);
    assert.equal(canPerform("RUNNING", "resume"), false);
    assert.equal(canPerform("RUNNING", "delete"), false);
  });

  test("a paused campaign can resume but not pause again", () => {
    assert.equal(canPerform("PAUSED", "resume"), true);
    assert.equal(canPerform("PAUSED", "pause"), false);
  });

  test("only a draft can be deleted or launched", () => {
    assert.equal(canPerform("DRAFT", "delete"), true);
    assert.equal(canPerform("DRAFT", "launch"), true);
    for (const status of ["RUNNING", "PAUSED", "SCHEDULED", "COMPLETED", "CANCELLED"] as const) {
      assert.equal(canPerform(status, "delete"), false, status + " must not delete");
    }
  });

  test("a finished campaign can only be duplicated", () => {
    for (const status of ["COMPLETED", "CANCELLED"] as const) {
      assert.deepEqual(allowedActions(status), ["duplicate"]);
      assert.equal(isFinal(status), true);
      assert.equal(canPerform(status, "resume"), false);
      assert.equal(canPerform(status, "cancel"), false);
      assert.equal(canPerform(status, "edit"), false);
    }
  });

  test("every status can be duplicated", () => {
    for (const status of [
      "DRAFT",
      "SCHEDULED",
      "RUNNING",
      "PAUSED",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      assert.equal(canPerform(status, "duplicate"), true, status);
    }
  });

  test("every status has banner copy and a progress tone", () => {
    for (const status of [
      "DRAFT",
      "SCHEDULED",
      "RUNNING",
      "PAUSED",
      "COMPLETED",
      "CANCELLED",
    ] as const) {
      assert.ok(STATUS_BANNER[status].title.length > 0, status);
      assert.ok(progressTone(status).length > 0, status);
    }
  });
});

/* -------------------------------------------------------------- rates --- */

describe("conversion rates", () => {
  test("rates follow the funnel, each measured against the step before", () => {
    assert.equal(replyRate(2480, 412).toFixed(1), "16.6");
    assert.equal(qualificationRate(412, 86).toFixed(1), "20.9");
    assert.equal(bookingRate(412, 32).toFixed(1), "7.8");
  });

  test("a zero denominator is zero, never NaN or Infinity", () => {
    assert.equal(replyRate(0, 0), 0);
    assert.equal(qualificationRate(0, 5), 0);
    assert.equal(bookingRate(0, 5), 0);
  });
});

/* --------------------------------------------------------- icon tiles --- */

describe("campaign icon tiles", () => {
  test("a cancelled campaign always reads as an alert", () => {
    assert.equal(
      campaignIconKey({
        status: "CANCELLED",
        channel: "sms",
        audienceLabel: "Commercial leads",
        name: "Anything",
      }),
      "alert",
    );
  });

  test("audience and channel pick the tile for a live campaign", () => {
    assert.equal(
      campaignIconKey({
        status: "RUNNING",
        channel: "sms",
        audienceLabel: "Commercial leads",
        name: "Commercial Outreach",
      }),
      "audience",
    );
    assert.equal(
      campaignIconKey({
        status: "SCHEDULED",
        channel: "whatsapp",
        audienceLabel: "Guttering enquiries",
        name: "Guttering Reminder",
      }),
      "message",
    );
    assert.equal(
      campaignIconKey({
        status: "RUNNING",
        channel: "sms",
        audienceLabel: "Past quote requests",
        name: "Autumn Roof Check",
      }),
      "email",
    );
  });
});

/* ----------------------------------------------------- reference data --- */

describe("the reference campaign set", () => {
  test("covers all six statuses", () => {
    const statuses = new Set(REACTIVATION_FIXTURES.map((f) => f.status));
    assert.equal(statuses.size, 6);
  });

  test("a draft has no results and no progress", () => {
    const draft = rows.find((r) => r.status === "DRAFT")!;
    assert.equal(draft.sent, 0);
    assert.equal(draft.replies, 0);
    assert.equal(draft.progress, 0);
  });

  test("finished campaigns read as complete", () => {
    for (const row of rows.filter((r) => isFinal(r.status))) {
      assert.equal(row.progress, 100, row.name);
    }
  });

  test("detail resolves for a known campaign and not for an unknown one", () => {
    const detail = fixtureDetail("autumn-roof-check", NOW.getTime());
    assert.ok(detail);
    assert.equal(detail.totals.sent, 2480);
    assert.equal(detail.totals.booked, 32);
    assert.equal(detail.messages.length, 2);
    assert.equal(fixtureDetail("does-not-exist", NOW.getTime()), null);
  });
});

/* ----------------------------------------------------- wizard metadata --- */

describe("campaign metadata entered in the wizard", () => {
  const draft = () => initialWizardState("sms");

  test("tags are split, trimmed and de-blanked", () => {
    assert.deepEqual(splitTags("Seasonal, Roofing ,, Past Quotes "), [
      "Seasonal",
      "Roofing",
      "Past Quotes",
    ]);
  });

  test("an empty tag box yields no tags rather than one blank tag", () => {
    assert.deepEqual(splitTags(""), []);
    assert.deepEqual(splitTags("  ,  , "), []);
  });

  test("a typed audience name wins", () => {
    const state = { ...draft(), audienceLabel: "  Past quote requests  " };
    assert.equal(resolvedAudienceLabel(state), "Past quote requests");
  });

  test("a CSV campaign falls back to the uploaded file's label", () => {
    const state = {
      ...draft(),
      audienceSource: "csv" as const,
      csvUpload: { sourceId: "s1", label: "winter-list.csv", imported: 40 },
    };
    assert.equal(resolvedAudienceLabel(state), "winter-list.csv");
  });

  test("an existing-leads campaign falls back to the dormancy rule", () => {
    const state = draft();
    state.audienceFilters.olderThanDays = 120;
    assert.equal(resolvedAudienceLabel(state), "Dormant leads 120+ days");
  });

  test("the audience name is never blank, whatever the source", () => {
    for (const source of ["existing", "csv"] as const) {
      const state = { ...draft(), audienceSource: source };
      assert.ok(resolvedAudienceLabel(state).trim().length > 0, source);
    }
  });
});
