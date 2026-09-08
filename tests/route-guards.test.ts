import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * Route guards.
 *
 * ClientTurn performs no authorisation in `proxy.ts`. The proxy refreshes the
 * Supabase session and rewrites the status host; it decides nothing about who
 * may see what. Every access decision lives in a layout, a page or a route
 * handler.
 *
 * That is a defensible design — a guard next to the query it protects is
 * easier to reason about than a regex list in a middleware file, and it cannot
 * drift out of step with the data it guards. It has exactly one failure mode:
 * a route added without one is silently public, and nothing says so. There is
 * no missing-guard error, no 500, no red test. The page simply renders for
 * whoever asks.
 *
 * This file is that missing error. It does not find a bug today — every route
 * on disk is guarded, and each assertion below records *which* mechanism each
 * one uses. It exists so that the next route added has to declare itself, and
 * a route that declares one thing and does another fails the build.
 *
 * Structural on purpose: it reads source text rather than executing handlers,
 * so it needs no server, no database and no session, and it cannot flake.
 */

const APP = path.join(process.cwd(), "src", "app");

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

/** Path relative to `src/app`, forward-slashed, so it reads like a route. */
function rel(file: string): string {
  return path.relative(APP, file).replace(/\\/g, "/");
}

const PAGES = walk(APP, /^page\.tsx$/).map(rel).sort();
const ROUTES = walk(APP, /^route\.ts$/).map(rel).sort();

// ---------------------------------------------------------------------------
// Page trees
// ---------------------------------------------------------------------------

/**
 * A tree whose pages are protected by a layout above them.
 *
 * `layout` is the file that holds the decision and `guard` is the call that
 * makes it. Naming the specific call matters: `admin/(ops)` guarded by
 * `requireWorkspace` instead of `requirePlatformAdmin` would still compile,
 * still redirect a signed-out visitor, and still hand the platform operations
 * console to any signed-in customer.
 */
const GUARDED_TREES: { prefix: string; layout: string; guard: string; why: string }[] = [
  {
    prefix: "(app)/",
    layout: "(app)/layout.tsx",
    guard: "requireWorkspace",
    why: "the customer application: a workspace membership is the minimum to see anything",
  },
  {
    prefix: "admin/(ops)/",
    layout: "admin/(ops)/layout.tsx",
    guard: "requirePlatformAdmin",
    why: "platform operations, checked against platform_role server-side with step-up",
  },
  {
    prefix: "affiliates/app/",
    layout: "affiliates/app/layout.tsx",
    guard: "getAffiliateAccount",
    why: "the partner portal: a signed-in user with no affiliate account is sent to the programme page, not into the portal",
  },
];

/**
 * A page that guards itself, because no layout above it can.
 *
 * `/onboarding` is the honest example: its whole purpose is to serve a user
 * whose workspace is *not* yet complete, which is the one state the app
 * layout redirects away from. It cannot sit under that layout, so it resolves
 * the workspace itself.
 */
const SELF_GUARDED: Record<string, string> = {
  "onboarding/page.tsx": "requireWorkspace",
};

/**
 * Trees that are unauthenticated by design, each with the reason.
 *
 * This list is the point of the test. Adding a page under a new top-level
 * path fails until somebody writes down which of these two categories it is
 * in — and writing that sentence is the moment the question gets asked.
 */
const PUBLIC_TREES: { prefix: string; why: string }[] = [
  { prefix: "(marketing)/", why: "the public website" },
  { prefix: "(auth)/", why: "sign in, sign up and password reset: reaching these signed out is the point" },
  { prefix: "admin/login/", why: "the separate admin front door (resolved conflict 4)" },
  { prefix: "affiliates/login/", why: "partner sign-in" },
  { prefix: "affiliates/signup/", why: "partner registration" },
  { prefix: "affiliates/verify-email/", why: "reached from an email link before any session exists" },
  { prefix: "affiliates/onboarding/", why: "partner application, completed before an affiliate account exists" },
  { prefix: "status/", why: "the status page, deliberately readable during an outage with no session" },
  { prefix: "unsubscribe/", why: "a token in an email link is the credential; a recipient must never need an account to opt out" },
  { prefix: "dev/", why: "visual harnesses, gated to non-production by each page (see below)" },
];

describe("every page is either guarded or deliberately public", () => {
  test("no page falls outside both lists", () => {
    const unclassified = PAGES.filter(
      (page) =>
        !GUARDED_TREES.some((t) => page.startsWith(t.prefix)) &&
        !PUBLIC_TREES.some((t) => page.startsWith(t.prefix)) &&
        !(page in SELF_GUARDED),
    );

    assert.deepEqual(
      unclassified,
      [],
      `These pages are in no declared tree, so nothing in this repository states ` +
        `whether they require a session. Add the tree to GUARDED_TREES or ` +
        `PUBLIC_TREES with a reason:\n  ${unclassified.join("\n  ")}`,
    );
  });

  test("every declared tree still has pages in it", () => {
    // A prefix that matches nothing is a guard nobody is relying on any more,
    // and it would go on silently passing after the tree it named was deleted.
    for (const tree of [...GUARDED_TREES, ...PUBLIC_TREES]) {
      assert.ok(
        PAGES.some((page) => page.startsWith(tree.prefix)),
        `${tree.prefix} is declared but contains no pages — delete the entry`,
      );
    }
  });
});

describe("each guarded tree's layout performs its own check", () => {
  for (const tree of GUARDED_TREES) {
    test(`${tree.prefix} calls ${tree.guard}() — ${tree.why}`, () => {
      const file = path.join(APP, tree.layout);
      assert.ok(existsSync(file), `${tree.layout} is missing; ${tree.prefix} is now unguarded`);

      const text = readFileSync(file, "utf8");
      assert.match(
        text,
        new RegExp(`\\b${tree.guard}\\s*\\(`),
        `${tree.layout} no longer calls ${tree.guard}(). Every page under ` +
          `${tree.prefix} depends on it.`,
      );
    });
  }

  test("the admin console is not guarded by the customer check", () => {
    // The failure this prevents is specific: requireWorkspace() succeeds for
    // every paying customer. Used here it would return a session, satisfy a
    // careless reading of "it redirects when signed out", and open the
    // platform console to the entire customer base.
    const text = readFileSync(path.join(APP, "admin/(ops)/layout.tsx"), "utf8");
    assert.doesNotMatch(
      text,
      /\brequireWorkspace\s*\(/,
      "admin/(ops) must resolve a platform operator, not a workspace member",
    );
  });

  for (const [page, guard] of Object.entries(SELF_GUARDED)) {
    test(`${page} guards itself with ${guard}()`, () => {
      const text = readFileSync(path.join(APP, page), "utf8");
      assert.match(text, new RegExp(`\\b${guard}\\s*\\(`), `${page} has no guard of its own`);
    });
  }
});

describe("the development harnesses cannot be reached in production", () => {
  const devPages = PAGES.filter((page) => page.startsWith("dev/"));

  test("there are dev pages to check", () => {
    assert.ok(devPages.length > 0);
  });

  for (const page of devPages) {
    test(`${page} 404s outside development`, () => {
      const text = readFileSync(path.join(APP, page), "utf8");
      // These render real product components against fixed data, with no
      // workspace resolved. In production that is an unauthenticated view of
      // internal screens.
      assert.match(
        text,
        /process\.env\.NODE_ENV\s*===\s*["']production["'][\s\S]{0,40}notFound\(\)/,
        `${page} is a development harness with no production gate`,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * How each API route decides whether to answer.
 *
 * Route handlers get no layout, so there is no shared place a guard could
 * live even in principle — each one carries its own. Every route on disk must
 * appear here, and its file must contain the marker for the mechanism it
 * claims.
 */
const MECHANISMS: Record<string, RegExp> = {
  // A signed-in workspace member.
  session: /\b(requireWorkspace|requireRole|getActiveWorkspace)\s*\(/,
  // The pg_cron shared secret (docs/CRON.md).
  "cron-secret": /serverEnv\.cronSecret/,
  // An HMAC over the raw body, compared in constant time.
  hmac: /timingSafeEqual\s*\(/,
  "stripe-signature": /webhooks\.constructEvent\s*\(/,
  "twilio-signature": /verifyTwilioSignature\s*\(/,
  // Meta signs with sha256 over the raw body; the comparison is constant-time
  // inside the helper, which is where it belongs.
  "meta-signature": /verifyMetaSignature\s*\(/,
  // Meta's deauthorize and data-deletion callbacks use a different scheme from
  // its webhooks: a `signed_request` form field carrying its own base64url
  // signature, rather than an X-Hub-Signature header over the body. Same secret,
  // different envelope — so it gets its own guard rather than being folded into
  // "meta-signature", which would let a route claim a check it does not do.
  "meta-signed-request": /parseSignedRequest\s*\(/,
  // A signed-in user who also has an affiliate account. The partner portal is
  // a separate identity from a workspace membership.
  affiliate: /getAffiliate(Account)?\s*\(/,
  // A platform API key, resolved and scope-checked by one wrapper.
  "api-key": /\bwithApiKey\s*[<(]/,
  // An MCP bearer token or OAuth grant.
  "mcp-token": /\bauthenticate\s*\(\s*request\.headers/,
  // Unauthenticated on purpose. Every entry needs a reason in PUBLIC_ROUTES.
  public: /.*/,
  // Non-production only.
  "dev-only": /process\.env\.NODE_ENV\s*===\s*["']production["']/,
};

const ROUTE_AUTH: Record<string, keyof typeof MECHANISMS> = {
  "affiliates/app/payouts/[id]/breakdown/route.ts": "affiliate",
  "affiliates/app/payouts/[id]/statement/route.ts": "affiliate",
  "affiliates/app/payouts/export/route.ts": "affiliate",
  "affiliates/app/referrals/export/route.ts": "affiliate",
  "affiliates/app/resources/[id]/download/route.ts": "affiliate",
  "affiliates/app/settings/connect/refresh/route.ts": "affiliate",
  "auth/callback/route.ts": "public",
  "r/[slug]/route.ts": "public",
  "api/analytics/export/route.ts": "session",
  "api/avatar/[scope]/[id]/route.ts": "session",
  "api/apps/[id]/events/route.ts": "hmac",
  "api/cron/daily/route.ts": "cron-secret",
  "api/cron/worker/route.ts": "cron-secret",
  "api/dev/seed/route.ts": "dev-only",
  "api/exports/attribution/route.ts": "session",
  "api/exports/prospects/route.ts": "session",
  "api/find-leads/runs/[runId]/route.ts": "session",
  "api/integrations/[provider]/callback/route.ts": "public",
  "api/integrations/[provider]/connect/route.ts": "session",
  "api/marketing/track/route.ts": "public",
  "api/mcp/route.ts": "mcp-token",
  "api/search/route.ts": "session",
  "api/v1/route.ts": "public",
  "api/v1/events/route.ts": "api-key",
  "api/v1/leads/route.ts": "api-key",
  "api/v1/leads/[id]/route.ts": "api-key",
  "api/v1/me/route.ts": "api-key",
  "api/webhooks/linkedin-ads/route.ts": "hmac",
  "api/webhooks/meta/route.ts": "meta-signature",
  "api/webhooks/meta/data-deletion/route.ts": "meta-signed-request",
  "api/webhooks/meta/deauthorize/route.ts": "meta-signed-request",
  "api/webhooks/stripe/route.ts": "stripe-signature",
  "api/webhooks/twilio/route.ts": "twilio-signature",
};

/**
 * The three routes that answer without a caller identity, and why that is
 * correct rather than an oversight.
 */
const PUBLIC_ROUTES: Record<string, string> = {
  "auth/callback/route.ts":
    "the Supabase auth callback. The single-use PKCE code in the query string is the credential, exchanged for a session here; " +
    "requiring a session to reach the endpoint that creates one is circular.",
  "r/[slug]/route.ts":
    "an affiliate referral link, which is a public URL by definition -- it is printed in adverts. It resolves the slug, records a click and redirects, " +
    "and only to a destination on the allow-list, so a tampered row cannot produce an open redirect.",
  "api/integrations/[provider]/callback/route.ts":
    "the OAuth callback: the provider redirects the browser here with no session cookie guaranteed. " +
    "Its credential is the single-use `state`, consumed by consumeOAuthState() before any token exchange.",
  "api/marketing/track/route.ts":
    "anonymous marketing analytics from the public website, where there is no account by definition. Rate limited.",
  "api/v1/route.ts":
    "the API index. Describes the shape of the API and nothing about any workspace, so a developer whose key is failing can still see the service is up.",
};

describe("every API route declares how it authenticates", () => {
  test("no route is missing from the table", () => {
    const undeclared = ROUTES.filter((route) => !(route in ROUTE_AUTH));
    assert.deepEqual(
      undeclared,
      [],
      `A route handler gets no layout, so an undeclared route is an unauthenticated ` +
        `endpoint. Add it to ROUTE_AUTH:\n  ${undeclared.join("\n  ")}`,
    );
  });

  test("no entry in the table has lost its route", () => {
    const onDisk = new Set(ROUTES);
    for (const declared of Object.keys(ROUTE_AUTH)) {
      assert.ok(onDisk.has(declared), `${declared} is declared but no longer exists`);
    }
  });

  for (const [route, mechanism] of Object.entries(ROUTE_AUTH)) {
    if (mechanism === "public") continue;
    test(`${route} uses ${mechanism}`, () => {
      const text = readFileSync(path.join(APP, route), "utf8");
      assert.match(
        text,
        MECHANISMS[mechanism],
        `${route} is declared as ${mechanism} but does not call it. Either the ` +
          `guard was removed, or the route changed mechanism and the table did not.`,
      );
    });
  }

  test("each public route has a written reason", () => {
    const declaredPublic = Object.entries(ROUTE_AUTH)
      .filter(([, mechanism]) => mechanism === "public")
      .map(([route]) => route);

    for (const route of declaredPublic) {
      const reason = PUBLIC_ROUTES[route];
      assert.ok(reason, `${route} is public with no reason given`);
      assert.ok(reason.length > 60, `${route}'s reason is too thin to be an argument`);
    }

    assert.deepEqual(
      Object.keys(PUBLIC_ROUTES).sort(),
      declaredPublic.sort(),
      "PUBLIC_ROUTES and the `public` entries in ROUTE_AUTH disagree",
    );
  });

  test("the avatar proxy checks the host before it fetches", () => {
    // This route fetches a URL read out of a database column. Without a host
    // allow-list that column is an SSRF primitive: anything that can write a
    // conversation or prospect row can make the server request an arbitrary
    // internal address and stream the response back. The workspace check
    // establishes who is asking; it says nothing about where the server is
    // being sent.
    //
    // The specific hosts are deliberately not asserted -- they change as
    // channels are added, and a test that pinned them would fail for a correct
    // change. What is asserted is the property that does the security work:
    // the URL is restricted to https, the host is tested against a list, and
    // the test happens *before* the fetch. An allow-list consulted after the
    // request has gone out protects nothing.
    const file = ROUTES.find((route) => route.startsWith("api/avatar/"));
    assert.ok(file, "the avatar proxy has moved or been deleted");

    const text = readFileSync(path.join(APP, file), "utf8");
    assert.match(
      text,
      /url\.protocol !== "https:"/,
      "the avatar proxy no longer requires https",
    );

    const guard = text.search(/(is)?[Aa]llowedHost/);
    const fetched = text.indexOf("await fetch(");
    assert.ok(guard > -1, "the avatar proxy no longer restricts the upstream host");
    assert.ok(fetched > -1, "the avatar proxy no longer fetches");
    assert.ok(
      guard < fetched,
      "the host must be checked before the request is made",
    );
  });

  test("the OAuth callback consumes its state before exchanging a code", () => {
    // The one public route that takes an action. Order is the whole guard: a
    // token exchanged before the state is verified is a token obtained by
    // anyone who can craft the redirect.
    const text = readFileSync(
      path.join(APP, "api/integrations/[provider]/callback/route.ts"),
      "utf8",
    );
    const consumed = text.indexOf("consumeOAuthState");
    const exchanged = text.indexOf("exchangeCodeForToken(");
    assert.ok(consumed > -1, "the callback no longer verifies OAuth state");
    assert.ok(exchanged > -1, "the callback no longer exchanges a code");
    assert.ok(
      consumed < exchanged,
      "state must be verified before the authorisation code is exchanged",
    );
  });
});

describe("the proxy is not mistaken for a guard", () => {
  test("proxy.ts performs no authorisation", () => {
    // If a guard is ever added here, this test should be deleted and the
    // trees above re-examined — but a half-migration, where some routes trust
    // the proxy and others guard themselves, is how gaps open.
    const text = readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
    assert.doesNotMatch(
      text,
      /\b(requireWorkspace|requirePlatformAdmin|requireRole)\s*\(/,
      "proxy.ts now authorises. Authorisation lives beside the query it protects; " +
        "two places that both partly decide is worse than either one alone.",
    );
  });

  test("the status host rewrite cannot reach the application", () => {
    // The status subdomain rewrites unknown paths to /status. It must not
    // become a second front door onto /app with a different hostname.
    const text = readFileSync(path.join(process.cwd(), "src", "proxy.ts"), "utf8");
    assert.match(text, /url\.pathname\s*=\s*["']\/status["']/);
  });
});
