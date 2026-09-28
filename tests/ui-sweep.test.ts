import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  GENERIC_ERROR_MESSAGE,
  errorReference,
  friendlyErrorMessage,
  isTechnicalMessage,
} from "../src/lib/errors/friendly.ts";

/**
 * The UI sweep (docs/revenue-engine/16-ui-sweep-audit.md) as regression tests:
 *
 *   1. errors reach customers as sentences, never as infrastructure text;
 *   2. every signed-in route has a loading and an error state, and every
 *      dynamic detail route that can 404 has its own not-found;
 *   3. no customer-facing component renders `error.message` directly, or
 *      hand-rolls a red inline error instead of <FormError>;
 *   4. detail pages, sub pages and wizards have a fixed back link.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

describe("friendlyErrorMessage", () => {
  test("passes hand-written action errors through unchanged", () => {
    assert.equal(
      friendlyErrorMessage("Only owners and admins can change connections."),
      "Only owners and admins can change connections.",
    );
    assert.equal(friendlyErrorMessage("Payment failed: the card was declined."), "Payment failed: the card was declined.");
  });

  test("strips an Error: prefix but keeps the sentence", () => {
    assert.equal(friendlyErrorMessage("Error: That file is too large."), "That file is too large.");
    assert.equal(friendlyErrorMessage(new Error("That file is too large.")), "That file is too large.");
  });

  const technical = [
    'duplicate key value violates unique constraint "leads_pkey"',
    'relation "public.leads" does not exist',
    "new row violates row-level security policy for table \"leads\"",
    "PGRST116: JSON object requested, multiple (or no) rows returned",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "fetch failed",
    "connect ECONNREFUSED 127.0.0.1:5432",
    "Request failed with status code 502",
    "JWT expired",
    'Expected string, received number',
    "Unexpected token < in JSON at position 0",
    "    at handler (/var/task/.next/server/app/page.js:1:2345)",
    "<!DOCTYPE html><html><body>Bad Gateway</body></html>",
  ];
  for (const raw of technical) {
    test(`hides technical text: ${raw.slice(0, 40)}`, () => {
      assert.ok(isTechnicalMessage(raw), raw);
      assert.equal(friendlyErrorMessage(raw, "Try again."), "Try again.");
    });
  }

  test("a WriteError always becomes the fallback", () => {
    const error = new Error("leads: insert failed: something");
    error.name = "WriteError";
    assert.equal(friendlyErrorMessage(error, "Not saved."), "Not saved.");
  });

  test("empty, non-string and runaway input become the fallback", () => {
    assert.equal(friendlyErrorMessage(""), GENERIC_ERROR_MESSAGE);
    assert.equal(friendlyErrorMessage(null), GENERIC_ERROR_MESSAGE);
    assert.equal(friendlyErrorMessage({ foo: 1 }), GENERIC_ERROR_MESSAGE);
    assert.equal(friendlyErrorMessage("x".repeat(401)), GENERIC_ERROR_MESSAGE);
    assert.equal(friendlyErrorMessage({ message: "Pick a date first." }), "Pick a date first.");
  });

  test("errorReference uses the digest when there is one", () => {
    assert.equal(errorReference("1234567890abcdef"), "1234567890ab");
    assert.match(errorReference(), /^[0-9A-F]{10}$/);
  });
});

describe("route states", () => {
  const APP = path.join(ROOT, "src/app/(app)/app");
  const pages = walk(APP, (f) => f.endsWith(`${path.sep}page.tsx`));

  /** Nearest `name` file from the page's folder up to (and including) `stop`. */
  function nearest(dir: string, name: string, stop: string): string | null {
    for (let d = dir; d.startsWith(stop); d = path.dirname(d)) {
      if (existsSync(path.join(d, name))) return path.join(d, name);
      if (d === stop) break;
    }
    return null;
  }

  test("there are app routes to check", () => {
    assert.ok(pages.length >= 25, `found ${pages.length}`);
  });

  for (const page of pages) {
    const dir = path.dirname(page);
    const route = rel(dir).replace("src/app/(app)", "") || "/";
    const source = readFileSync(page, "utf8");
    // Pure redirects (settings/billing -> ?section=billing) render nothing.
    const redirectOnly = /^\s*redirect\(/m.test(source) && !/return\s*\(/.test(source);
    if (redirectOnly) continue;

    test(`${route} has a loading state`, () => {
      assert.ok(nearest(dir, "loading.tsx", APP), `${route}: add loading.tsx`);
    });

    test(`${route} has its own section error boundary`, () => {
      // The (app) root boundary is the last resort; each section names what
      // failed and where to go back to.
      assert.ok(nearest(dir, "error.tsx", APP), `${route}: add error.tsx`);
    });

    if (/\[[^\]]+\]/.test(route) && /notFound\(\)/.test(source)) {
      test(`${route} has a section not-found`, () => {
        // Nearest one below the app root: the app-wide 404 has no way back
        // into the section the record belonged to.
        const found = nearest(dir, "not-found.tsx", APP);
        assert.ok(found && path.dirname(found) !== APP, `${route}: add not-found.tsx`);
      });
    }
  }

  for (const root of ["src/app/onboarding", "src/app/start-trial", "src/app/(auth)", "src/app/admin/(ops)", "src/app/admin/login"]) {
    test(`${root} has an error boundary`, () => {
      assert.ok(existsSync(path.join(ROOT, root, "error.tsx")), `${root}/error.tsx`);
    });
  }

  test("every route error boundary uses the shared RouteError", () => {
    const boundaries = [
      ...walk(path.join(ROOT, "src/app/(app)"), (f) => f.endsWith(`${path.sep}error.tsx`)),
      ...walk(path.join(ROOT, "src/app/admin"), (f) => f.endsWith(`${path.sep}error.tsx`)),
      ...["onboarding", "start-trial", "(auth)"].map((d) => path.join(ROOT, "src/app", d, "error.tsx")),
    ];
    for (const file of boundaries) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /<RouteError\b/, `${rel(file)} should render <RouteError>`);
      assert.doesNotMatch(source, /error\.message/, `${rel(file)} must not show error.message`);
    }
  });
});

describe("no raw error text in customer-facing UI", () => {
  const CUSTOMER = [
    ...walk(path.join(ROOT, "src/components"), (f) => f.endsWith(".tsx")),
    ...walk(path.join(ROOT, "src/app"), (f) => f.endsWith(".tsx")),
  ].filter((f) => !/[\\/](admin|dev)[\\/]/.test(f));

  test("no {error.message} / {err.message} / {String(error)} rendered in JSX", () => {
    const offenders: string[] = [];
    for (const file of CUSTOMER) {
      const source = readFileSync(file, "utf8");
      const hits = source.match(/>\s*\{\s*(?:error|err|e|caught)\??\.message\s*\}|>\s*\{\s*String\(\s*(?:error|err|e)\s*\)\s*\}/g);
      if (hits) offenders.push(`${rel(file)}: ${hits[0].trim()}`);
    }
    assert.deepEqual(offenders, []);
  });

  test("action errors use <FormError>, not a hand-rolled red paragraph", () => {
    // `{error && <p className="... text-danger-700">{error}</p>}` showed
    // whatever the server returned, in red, with no retry. Field validation
    // (errors.x, fieldErrors.x, an id wired to aria-describedby) is exempt.
    const pattern =
      /\{(error|submitError|launchError|saveError|actionError) && \(?\s*<(p|span|div)(?![^>]*\bid=)[^>]*text-danger-[67]00[^>]*>\s*\{\1\}\s*<\/\2>/g;
    const offenders: string[] = [];
    for (const file of CUSTOMER) {
      const source = readFileSync(file, "utf8");
      if (pattern.test(source)) offenders.push(rel(file));
      pattern.lastIndex = 0;
    }
    assert.deepEqual(offenders, []);
  });

  test("error toasts and FormError run through friendlyErrorMessage", () => {
    assert.match(read("src/components/ui/toast.tsx"), /friendlyErrorMessage\(/);
    assert.match(read("src/components/ui/feedback.tsx"), /export function FormError[\s\S]*friendlyErrorMessage\(/);
  });

  test("server actions use actionFailure instead of returning error.message", () => {
    const source = read("src/lib/integrations/connection-actions.ts");
    assert.doesNotMatch(source, /error instanceof Error \? error\.message/);
    assert.match(source, /actionFailure\(/);
  });
});

describe("back navigation", () => {
  // Every detail page, sub page and wizard, and the file that renders its
  // back link. A fixed parent, never router.back(): a page opened from a
  // notification or a shared link has no history to go back to.
  const BACK_LINKS: Record<string, { file: string; href: string }> = {
    "/app/leads/[id]": { file: "src/app/(app)/app/leads/[id]/page.tsx", href: "/app/leads" },
    "/app/leads/import": { file: "src/app/(app)/app/leads/import/page.tsx", href: "/app/leads" },
    "/app/agents/[id]": { file: "src/app/(app)/app/agents/[id]/page.tsx", href: "/app/agents" },
    "/app/agents/new": { file: "src/app/(app)/app/agents/new/page.tsx", href: "/app/agents" },
    "/app/reactivation/new": { file: "src/app/(app)/app/reactivation/new/page.tsx", href: "/app/reactivation" },
    "/app/find-leads/campaigns/new": { file: "src/app/(app)/app/find-leads/campaigns/new/page.tsx", href: "/app/find-leads?view=campaigns" },
    "/app/find-leads/campaigns/[campaignId]": { file: "src/components/find-leads/campaigns/detail/campaign-header.tsx", href: "/app/find-leads?view=campaigns" },
    "/app/find-leads/runs/[runId]": { file: "src/components/find-leads/runs/sourcing-run-view.tsx", href: "/app/find-leads" },
    "/app/find-leads/scoring/[prospectId]": { file: "src/components/find-leads/scoring/explainable-scoring.tsx", href: "/app/find-leads?view=prospects" },
    "/app/find-leads/search/[sessionId]": { file: "src/components/find-leads/search/search-session-view.tsx", href: "/app/find-leads" },
  };

  test("every detail and sub route under /app is listed here", () => {
    const pages = walk(path.join(ROOT, "src/app/(app)/app"), (f) => f.endsWith(`${path.sep}page.tsx`))
      .map((f) => rel(path.dirname(f)).replace("src/app/(app)", ""))
      .filter((route) => /\[|\/new$|\/import$/.test(route))
      .filter((route) => !route.startsWith("/app/help"));
    for (const route of pages) assert.ok(BACK_LINKS[route], `${route} has no back link registered`);
  });

  for (const [route, { file, href }] of Object.entries(BACK_LINKS)) {
    test(`${route} links back to ${href}`, () => {
      const source = read(file);
      const hasBackLink = source.includes(`<BackLink href="${href}"`);
      const hasBreadcrumb = /Breadcrumb/.test(source) && source.includes(`"${href}"`);
      assert.ok(hasBackLink || hasBreadcrumb, `${file} should link back to ${href}`);
      assert.doesNotMatch(source, /router\.back\(\)/, `${file} must not depend on history`);
    });
  }

  test("BackLink links to a fixed href, not history", () => {
    const source = read("src/components/app/back-link.tsx");
    assert.match(source, /<Link\s/);
    assert.doesNotMatch(source, /router\.back|history\.back/);
  });
});

describe("responsive shell", () => {
  test("the mobile topbar title shrinks instead of pushing the account menu off-screen", () => {
    const source = read("src/components/app/top-bar.tsx");
    assert.match(source, /<h1 className="min-w-0 flex-1 truncate/);
    assert.doesNotMatch(source, /<h1 className="[^"]*shrink-0/);
  });

  test("buttons get a 44px touch target on coarse pointers", () => {
    const source = read("src/components/ui/button.tsx");
    assert.match(source, /pointer-coarse:after:-inset-1\.5/);
  });

  test("single-column grids cannot widen the page", () => {
    assert.match(read("src/app/globals.css"), /@layer base \{\s*\.grid > \* \{\s*min-width: 0;/);
  });
});
