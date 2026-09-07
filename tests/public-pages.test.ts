import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLANS, planOrder, TRIAL_DAYS, ANNUAL_DISCOUNT_PERCENT } from "../src/lib/billing/plans.ts";
import { SOURCING_ALLOWANCES } from "../src/lib/billing/sourcing-allowances.ts";
import {
  SECURITY_CONTROLS,
  unavailableControls,
  controlsByGroup,
} from "../src/lib/marketing/security.ts";
import { PROVIDERS } from "../src/lib/integrations/catalog.ts";
import {
  PRIMARY_NAV,
  FOOTER_PRODUCT,
  FOOTER_SOLUTIONS,
  FOOTER_RESOURCES,
  FOOTER_COMPANY,
  FOOTER_PARTNERS,
} from "../src/components/marketing/public/nav-data.ts";

/**
 * What the public evaluation pages are allowed to say.
 *
 * These pages make commercial and security claims to people deciding whether
 * to buy. Every one of those claims is derived from something in the codebase
 * rather than written by hand — these tests are what stop the derivation from
 * silently drifting away from the thing it derives from.
 */

/* ------------------------------------------------------------- pricing --- */

describe("pricing page reads production pricing", () => {
  test("plan prices are the repriced 2026-09-05 values, not the mockup's", () => {
    // The approved design mocked £49/£129/£249. Production is £99/£199/£399,
    // and the page must never render the mockup's numbers.
    assert.equal(PLANS.starter.monthlyPrice, 99);
    assert.equal(PLANS.growth.monthlyPrice, 199);
    assert.equal(PLANS.pro.monthlyPrice, 399);
    assert.equal(PLANS.enterprise.monthlyPrice, null);
  });

  test("annual pricing is a real discount off the monthly rate", () => {
    for (const plan of [PLANS.starter, PLANS.growth, PLANS.pro]) {
      assert.ok(plan.yearlyPrice !== null && plan.monthlyPrice !== null);
      const expected = Math.round(
        plan.monthlyPrice * 12 * (1 - ANNUAL_DISCOUNT_PERCENT / 100),
      );
      assert.equal(plan.yearlyPrice, expected, plan.id);
      // A "saving" that is not a saving would be a false commercial claim.
      assert.ok(plan.yearlyPrice < plan.monthlyPrice * 12, plan.id);
    }
  });

  test("exactly one plan is recommended, and it is a real one", () => {
    const recommended = planOrder().filter((plan) => plan.recommended);
    assert.equal(recommended.length, 1);
    // "Recommended" is a business choice; it is never rendered as a
    // popularity claim, so it must be a plan someone can actually buy.
    assert.equal(recommended[0].selfServe, true);
  });

  test("the trial the page advertises is the trial the product grants", () => {
    assert.equal(TRIAL_DAYS, 14);
  });

  test("only Enterprise is contact-sales", () => {
    for (const plan of planOrder()) {
      if (!plan.selfServe) assert.equal(plan.id, "enterprise");
    }
  });
});

/* -------------------------------------------------- sourcing allowances --- */

describe("advertised sourcing allowances match the seeded entitlements", () => {
  const sql = readFileSync(
    new URL("../supabase/migrations/0038_v4_core_extensions.sql", import.meta.url),
    "utf8",
  );

  /** Reads a seeded `soft_limit` straight out of the migration. */
  function seeded(plan: string, metric: string): number {
    const pattern = new RegExp(
      `\\('${plan}',\\s*'${metric}',\\s*(\\d+),`,
      "m",
    );
    const match = sql.match(pattern);
    assert.ok(match, `no seed row for ${plan}/${metric}`);
    return Number(match[1]);
  }

  const CHECKS = [
    ["verifiedProspects", "verified_prospect"],
    ["searchRuns", "search_run"],
    ["savedSearches", "saved_search"],
    ["intentMonitors", "intent_monitor"],
    ["senderIdentities", "sender_identity"],
    ["emailSends", "email_sent"],
  ] as const;

  for (const plan of ["trial", "starter", "growth", "pro", "enterprise"] as const) {
    for (const [field, metric] of CHECKS) {
      test(`${plan} ${metric}`, () => {
        assert.equal(
          SOURCING_ALLOWANCES[plan][field],
          seeded(plan, metric),
          `${plan}/${metric} on the pricing page disagrees with the migration`,
        );
      });
    }
  }

  test("allowances rise monotonically up the ladder", () => {
    // A higher tier that included less than a lower one would be a pricing
    // page that argues against itself.
    const ladder = ["starter", "growth", "pro", "enterprise"] as const;
    for (let i = 1; i < ladder.length; i += 1) {
      const lower = SOURCING_ALLOWANCES[ladder[i - 1]];
      const higher = SOURCING_ALLOWANCES[ladder[i]];
      assert.ok(higher.verifiedProspects > lower.verifiedProspects, ladder[i]);
      assert.ok(higher.emailSends > lower.emailSends, ladder[i]);
    }
  });

  test("the trial is smaller than every paid plan", () => {
    for (const plan of ["starter", "growth", "pro", "enterprise"] as const) {
      assert.ok(
        SOURCING_ALLOWANCES.trial.verifiedProspects <
          SOURCING_ALLOWANCES[plan].verifiedProspects,
      );
    }
  });
});

/* ------------------------------------------------------------ security --- */

describe("the enterprise page cannot claim a control we do not hold", () => {
  test("no certification is claimed as held", () => {
    const certification = SECURITY_CONTROLS.find((c) => c.id === "certifications");
    assert.ok(certification);
    assert.equal(certification.status, "not_available");
  });

  test("SSO and workspace MFA are declared unavailable", () => {
    for (const id of ["sso", "workspace-mfa"]) {
      const control = SECURITY_CONTROLS.find((c) => c.id === id);
      assert.ok(control, id);
      assert.equal(control.status, "not_available", id);
    }
  });

  test("gaps are surfaced rather than omitted", () => {
    // A buyer who cannot find SSO on the page assumes it exists. The page
    // renders this list, so it must never be empty while gaps remain.
    const gaps = unavailableControls();
    assert.ok(gaps.length >= 3);
    assert.ok(gaps.every((gap) => gap.detail.length > 40));
  });

  test("no control uses hedging language to stand in for an audit", () => {
    // "Designed to support X" is how an uncertified product implies
    // certification. It is banned outright rather than reviewed case by case.
    for (const control of SECURITY_CONTROLS) {
      const text = `${control.name} ${control.detail}`.toLowerCase();
      assert.ok(
        !text.includes("designed to support"),
        `${control.id} hedges instead of stating a fact`,
      );
      if (control.status !== "not_available") {
        for (const banned of ["soc 2", "soc2", "iso 27001", "hipaa", "pci dss"]) {
          assert.ok(
            !text.includes(banned),
            `${control.id} names ${banned} outside a not-available entry`,
          );
        }
      }
    }
  });

  test("every group the page renders has something in it", () => {
    for (const group of ["access", "isolation", "data", "operations", "governance"] as const) {
      assert.ok(controlsByGroup(group).length > 0, group);
    }
  });
});

/* -------------------------------------------------------- integrations --- */

describe("integration availability is derived, never asserted", () => {
  test("a provider with no connect route is not self-connectable", () => {
    // This is the rule the marketing showcase and Settings → Connections both
    // apply. If it changes in one place it must change in both.
    for (const provider of PROVIDERS) {
      const connectable =
        provider.connectionMethod === "token" || Boolean(provider.connectPath);
      if (provider.connection === "workspace" && !connectable) {
        assert.equal(provider.connectPath, null, provider.id);
      }
    }
  });

  test("Meta is still not self-serve, so the pages must not imply it is", () => {
    // Guards the enterprise copy: Meta is the headline lead source but has no
    // in-app connect flow yet. If that changes, this test should fail and the
    // copy should be revisited.
    const meta = PROVIDERS.find((provider) => provider.id === "meta");
    assert.ok(meta);
    assert.equal(meta.connectPath, null);
  });

  test("providers without platform credentials use workspace tokens", () => {
    for (const provider of PROVIDERS) {
      if (provider.requiredEnv.length === 0) {
        assert.equal(provider.connection, "workspace", provider.id);
        assert.equal(provider.connectionMethod, "token", provider.id);
      }
    }
  });
});

/* -------------------------------------------------------------- routes --- */

describe("public navigation only points at routes that exist", () => {
  /** Routes under `src/app` that the public site is allowed to link to. */
  const REAL_ROUTES = new Set([
    "/",
    "/how-it-works",
    "/results",
    "/pricing",
    "/enterprise",
    "/contact-sales",
    "/product/find-leads",
    "/product/lead-conversion",
    "/privacy",
    "/terms",
    "/cookies",
    "/sub-processors",
    "/status",
    "/login",
    "/signup",
    "/affiliates",
    "/affiliates/login",
    "/affiliates/signup",
  ]);

  function assertResolvable(href: string, where: string) {
    if (href.startsWith("/#")) return; // homepage anchor
    if (href.startsWith("mailto:")) return;
    const path = href.split("?")[0].split("#")[0];
    assert.ok(
      REAL_ROUTES.has(path),
      `${where} links to ${href}, which is not a real route`,
    );
  }

  test("primary navigation", () => {
    for (const item of PRIMARY_NAV) {
      if (item.kind === "link") {
        assertResolvable(item.href, `nav "${item.label}"`);
      } else {
        for (const column of item.columns) {
          for (const link of column.links) {
            assertResolvable(link.href, `mega "${item.label}" → "${link.label}"`);
          }
        }
        if (item.footer) assertResolvable(item.footer.href, `mega "${item.label}" footer`);
      }
    }
  });

  test("footer columns", () => {
    const columns = {
      product: FOOTER_PRODUCT,
      solutions: FOOTER_SOLUTIONS,
      resources: FOOTER_RESOURCES,
      company: FOOTER_COMPANY,
      partners: FOOTER_PARTNERS,
    };
    for (const [name, links] of Object.entries(columns)) {
      for (const link of links) {
        assertResolvable(link.href, `footer ${name} → "${link.label}"`);
      }
    }
  });

  test("the five evaluation routes are reachable from the site chrome", () => {
    const hrefs = new Set<string>();
    for (const item of PRIMARY_NAV) {
      if (item.kind === "link") hrefs.add(item.href);
      else for (const column of item.columns) for (const l of column.links) hrefs.add(l.href);
    }
    for (const links of [FOOTER_PRODUCT, FOOTER_RESOURCES, FOOTER_COMPANY]) {
      for (const link of links) hrefs.add(link.href);
    }

    for (const route of [
      "/how-it-works",
      "/results",
      "/pricing",
      "/enterprise",
      "/contact-sales",
    ]) {
      assert.ok(hrefs.has(route), `${route} is not linked from the header or footer`);
    }
  });
});
