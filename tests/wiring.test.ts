import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { SETTINGS_SECTIONS } from "../src/lib/settings/types.ts";
import { INBOX_CHANNELS, CHANNEL_DEFINITIONS } from "../src/lib/inbox/types.ts";
import { PROVIDERS } from "../src/lib/integrations/catalog.ts";
import { PRIMARY_NAV, SECONDARY_NAV, titleForPath } from "../src/lib/app/nav.ts";

/**
 * Wiring tests.
 *
 * Every assertion here corresponds to a defect that shipped, was found by
 * reading code by hand, and could only have been caught mechanically. A link
 * to a query parameter nobody reads, a channel tab with no ingestion behind
 * it, an enum value the database will refuse — none of these fail a unit test
 * of any individual module, because each one is a disagreement *between* two
 * modules that are individually correct.
 *
 * They are deliberately cheap and structural: they read source text rather
 * than executing it, so they cost nothing to run and cannot flake.
 */

const SRC = path.join(process.cwd(), "src");
const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, match));
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

const SOURCE_FILES = walk(SRC, /\.(ts|tsx)$/);
const SOURCES = SOURCE_FILES.map((file) => ({
  file: path.relative(process.cwd(), file).replace(/\\/g, "/"),
  text: readFileSync(file, "utf8"),
}));

const MIGRATION_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.startsWith("9999"))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n");

/**
 * The SQL that describes the database as it ends up, rather than everything
 * ever written.
 *
 * Migrations are history: a function defined in 0047 and replaced in 0063 has
 * only the 0063 body at runtime, and a test that scanned both would report a
 * defect that no longer exists. Function bodies are therefore reduced to the
 * last definition of each name, in migration order, and everything outside a
 * function body is kept as-is.
 */
const EFFECTIVE_SQL = (() => {
  const bodies = new Map<string, string>();
  const outside: string[] = [];
  let cursor = 0;

  const definition =
    /create (?:or replace )?function (?:public\.)?([a-z_0-9]+)\s*\(([\s\S]*?)\$(\w*)\$([\s\S]*?)\$\3\$/gi;

  for (const match of MIGRATION_SQL.matchAll(definition)) {
    outside.push(MIGRATION_SQL.slice(cursor, match.index));
    // Keyed by name only. Overload by argument type is not used anywhere in
    // this schema, and if it ever is, the later definition still wins here,
    // which fails safe towards reporting rather than hiding.
    bodies.set(match[1], match[0]);
    cursor = match.index + match[0].length;
  }
  outside.push(MIGRATION_SQL.slice(cursor));

  return [...outside, ...bodies.values()].join("\n");
})();

/* ------------------------------------------------------ settings links --- */

describe("settings deep links", () => {
  /**
   * Settings is one route with a `?section=` query. Twenty-one links across
   * Find Leads, Inbox and Agents used `?view=` instead, so every "Open
   * Connections" and "See plans" affordance in the V4 surfaces silently landed
   * on the default section. Nothing failed; the user simply arrived in the
   * wrong place.
   */
  test("every /app/settings link uses ?section=, not ?view=", () => {
    const offenders = SOURCES.filter((s) => s.text.includes("/app/settings?view=")).map(
      (s) => s.file,
    );
    assert.deepEqual(
      offenders,
      [],
      `Settings reads ?section=. These files link with ?view=:\n${offenders.join("\n")}`,
    );
  });

  test("every /app/settings?section= link names a real section", () => {
    const valid = new Set(SETTINGS_SECTIONS.map((section) => section.id) as string[]);
    const bad: string[] = [];

    for (const { file, text } of SOURCES) {
      // Only the customer app. The affiliate portal has its own settings route
      // with its own section vocabulary, and `/affiliates/app/settings` ends
      // with the same characters.
      for (const match of text.matchAll(/(?<!affiliates)\/app\/settings\?section=([a-z-]+)/g)) {
        const before = text.slice(Math.max(0, match.index - 12), match.index);
        if (before.includes("affiliates")) continue;
        if (!valid.has(match[1])) bad.push(`${file}: ?section=${match[1]}`);
      }
    }

    assert.deepEqual(
      bad,
      [],
      `Unknown settings section in a link:\n${bad.join("\n")}\nValid: ${[...valid].join(", ")}`,
    );
  });
});

/* ------------------------------------------------- status value casing --- */

describe("status value casing", () => {
  /**
   * `promote_reviewed_prospect` inserted `status = 'new'` into a column whose
   * CHECK constraint has permitted only `'NEW'` since 0003. Every promotion
   * raised 23514, both callers swallowed it, and the manual one reported the
   * failure as an unrelated business rule — so the defect looked like correct
   * behaviour for as long as it existed.
   *
   * The root cause is that the schema mixes lower-case and upper-case status
   * vocabularies with no rule, which made `'new'` look plausible. This test
   * reads the literals a routine writes and checks them against the constraint
   * on the column it writes them to.
   */
  function allowedValues(table: string, column: string): string[] | null {
    const pattern = new RegExp(
      `create table (?:if not exists )?(?:public\\.)?${table}\\b[\\s\\S]*?\\n\\);`,
      "i",
    );
    const body = MIGRATION_SQL.match(pattern)?.[0];
    if (!body) return null;
    const check = body.match(
      new RegExp(`${column} text[^,]*?check \\(${column} in \\(([^)]*)\\)`, "is"),
    );
    if (!check) return null;
    return [...check[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  }

  test("leads.status permits exactly the seven documented values", () => {
    assert.deepEqual(allowedValues("leads", "status"), [
      "NEW",
      "CONTACTED",
      "RESPONDED",
      "QUALIFIED",
      "BOOKED",
      "WON",
      "LOST",
    ]);
  });

  test("no SQL routine inserts a lead status the constraint would refuse", () => {
    const allowed = new Set(allowedValues("leads", "status") ?? []);
    assert.ok(allowed.size > 0, "leads.status constraint not found");

    const bad: string[] = [];
    // `insert into public.leads ( … ) values ( … )` across the whole migration
    // set, looking at the literal in the position `status` occupies.
    for (const match of EFFECTIVE_SQL.matchAll(
      /insert into public\.leads\s*\(([\s\S]*?)\)\s*values\s*\(([\s\S]*?)\)\s*returning/gi,
    )) {
      const columns = match[1].split(",").map((c) => c.trim().replace(/--.*$/gm, "").trim());
      const index = columns.indexOf("status");
      if (index === -1) continue;

      // Split the values list on top-level commas only: a value may itself be a
      // parenthesised subquery containing commas.
      const values: string[] = [];
      let depth = 0;
      let current = "";
      for (const ch of match[2]) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
        if (ch === "," && depth === 0) {
          values.push(current);
          current = "";
        } else current += ch;
      }
      values.push(current);

      const literal = values[index]?.replace(/--[^\n]*/g, "").trim();
      const quoted = literal?.match(/^'([^']*)'$/);
      if (quoted && !allowed.has(quoted[1])) {
        bad.push(`inserts status '${quoted[1]}' — allowed: ${[...allowed].join(", ")}`);
      }
    }

    assert.deepEqual(bad, [], bad.join("\n"));
  });
});

/* --------------------------------------------------- action authority --- */

describe("server action authority", () => {
  /**
   * A server action is a public endpoint. Next.js gives it an id the browser
   * can call directly, so "the UI only shows this button to admins" is not a
   * control — it is a hint. Every action that reaches the database has to
   * resolve an actor itself.
   *
   * This found `checkSlugAvailable`: an unauthenticated action that queried
   * `affiliate_links` by slug, which is a membership oracle. It had no caller
   * and was deleted.
   *
   * The check resolves one level of indirection, because that is what the
   * codebase uses — `adminAccess()` wraps `requireRole("admin")`, and admin
   * actions wrap everything in `guarded()`, which resolves the operator, takes
   * the step-up and writes the audit row in one place.
   */
  const PRIMITIVE =
    /\b(requireRole|requireWorkspace|requirePlatformAdmin|requireAffiliate|requireActiveAffiliate|getActiveWorkspace|getUser)\s*\(/;

  /** Actions that legitimately run before an actor exists. */
  const PRE_AUTH = new Set([
    "signUp", //          creates the account
    "signIn", //          authenticates
    "adminSignIn", //     authenticates
    "signUpPartner", //   creates the partner account
    "requestPasswordReset",
    "updatePassword",
    "submitSalesEnquiry", // public marketing form, rate-limited
  ]);

  function localGuards(src: string): Set<string> {
    const guards = new Set<string>();
    for (const m of src.matchAll(
      /(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\([\s\S]{0,400}?\{([\s\S]{0,900}?)\n\}/g,
    )) {
      if (PRIMITIVE.test(m[2])) guards.add(m[1]);
    }
    for (const m of src.matchAll(
      /const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([\s\S]{0,200}?\)\s*=>\s*\{([\s\S]{0,900}?)\n\}/g,
    )) {
      if (PRIMITIVE.test(m[2])) guards.add(m[1]);
    }
    return guards;
  }

  test("every server action that touches the database resolves an actor", () => {
    const unguarded: string[] = [];

    for (const { file, text } of SOURCES) {
      if (!/^["']use server["']/m.test(text)) continue;

      const wrappers = [...localGuards(text), "guarded", "adminAction"];
      const wrapperRe = new RegExp(`\\b(${wrappers.join("|")})\\s*\\(`);

      const exports = [
        ...text.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z0-9_]+)/gm),
      ];

      exports.forEach((m, index) => {
        const body = text.slice(
          m.index,
          index + 1 < exports.length ? exports[index + 1].index : text.length,
        );
        if (!/\.from\(|\.rpc\(/.test(body)) return;
        if (PRE_AUTH.has(m[1])) return;
        if (PRIMITIVE.test(body) || wrapperRe.test(body)) return;
        unguarded.push(`${m[1]}  (${file})`);
      });
    }

    assert.deepEqual(
      unguarded,
      [],
      `A server action is a public endpoint. These reach the database without ` +
        `resolving an actor:\n  ${unguarded.join("\n  ")}`,
    );
  });
});

/* --------------------------------------------------------- suppression --- */

describe("one suppression list", () => {
  /**
   * ClientTurn kept two suppression lists that never saw each other.
   * `contact_suppressions` was written by SMS STOP handling, the agent tool and
   * email bounces, and read by the warm send guard. `suppression_entries` was
   * written by the cold reply classifier and read by `check_suppression()`,
   * which the cold dispatcher uses.
   *
   * So a lead who texted STOP could still be emailed by an acquisition
   * campaign, and a prospect who replied "unsubscribe" could still be sent warm
   * SMS — while `suppressProspect()` set channel ALL with a comment saying an
   * opt-out means every channel. The split silently defeated the stated intent.
   *
   * 0069 unified them. This is what stops a new send path quietly reattaching
   * to the deprecated table: the compliance guarantee is that there is exactly
   * one list, and one list is a property of the source, not of a code review.
   */
  test("no application code touches the deprecated contact_suppressions table", () => {
    const offenders: string[] = [];

    for (const { file, text } of SOURCES) {
      if (file.endsWith("database.types.ts")) continue;

      text.split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        // Prose about the migration is not a use of the table.
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (/["'`]contact_suppressions["'`]/.test(line)) {
          offenders.push(`${file}:${index + 1}  ${trimmed}`);
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      `contact_suppressions is deprecated (0069). Every read and write goes ` +
        `through lib/policy/suppression.ts, which is the only thing that makes ` +
        `an opt-out apply to both the warm and the cold path:\n${offenders.join("\n")}`,
    );
  });

  test("suppression_entries is only reached through the policy module", () => {
    // The distinction is what the read is *for*. Displaying or managing the
    // list — analytics counting rows for a chart, an operator reviewing and
    // lifting entries — may query directly. Anything that gates a *send* must
    // go through the module, because that is where the platform-scope and
    // expiry rules live and a raw query would silently miss both.
    const ALLOWED = [
      "src/lib/policy/suppression.ts",
      "src/lib/analytics/v4-extras.ts",
      "src/lib/admin/compliance.ts",
      "src/lib/admin/compliance-actions.ts",
      "src/lib/compliance/queries.ts",
    ];
    const offenders: string[] = [];

    for (const { file, text } of SOURCES) {
      if (file.endsWith("database.types.ts")) continue;
      if (ALLOWED.includes(file)) continue;
      if (/from\(["'`]suppression_entries["'`]\)/.test(text)) offenders.push(file);
    }

    assert.deepEqual(
      offenders,
      [],
      `Use lib/policy/suppression.ts rather than querying suppression_entries ` +
        `directly — it carries the platform-scope and expiry rules a raw query ` +
        `would miss:\n${offenders.join("\n")}`,
    );
  });
});

/* ------------------------------------------------------- nav targets --- */

describe("navigation targets", () => {
  /**
   * `titleForPath` mapped `/app/status` to "Status" for a page that lives at
   * `/status`, outside the app shell — a dead entry that would have quietly
   * mistitled the route if one were ever added there.
   *
   * Every destination the shell offers must resolve to a route that exists.
   */
  function routeExists(href: string): boolean {
    const segments = href.replace(/^\//, "").split("/");
    // The customer app lives under the `(app)` route group.
    const candidates = [
      path.join(SRC, "app", "(app)", ...segments, "page.tsx"),
      path.join(SRC, "app", ...segments, "page.tsx"),
    ];
    return candidates.some((candidate) => SOURCE_FILES.includes(candidate));
  }

  test("every sidebar destination resolves to a real page", () => {
    const missing = [...PRIMARY_NAV, ...SECONDARY_NAV]
      .map((item) => item.href)
      .filter((href) => !routeExists(href));

    assert.deepEqual(missing, [], `Sidebar links with no page:\n${missing.join("\n")}`);
  });

  test("every page title prefix resolves to a real page", () => {
    // `titleForPath` returns "Dashboard" for anything it does not know, so a
    // stale prefix is invisible at runtime. Probing it is how the dead entry
    // becomes detectable.
    const claimed = [
      "/app/agents",
      "/app/inbox",
      "/app/leads",
      "/app/find-leads",
      "/app/follow-up",
      "/app/reactivation",
      "/app/analytics",
      "/app/settings",
      "/app/support",
      "/app/help",
      "/app/status",
    ];

    const wrong = claimed.filter(
      (href) => titleForPath(href) !== "Dashboard" && !routeExists(href),
    );

    assert.deepEqual(
      wrong,
      [],
      `titleForPath names a route that does not exist:\n${wrong.join("\n")}`,
    );
  });
});

/* -------------------------------------------------------- rate units --- */

describe("rate units", () => {
  /**
   * The product had five different "reply rate" computations: three counting
   * messages, two counting people, three returning fractions, two returning
   * percentage points, three returning null on an empty denominator and two
   * returning zero. None matched the definition published to the customer in
   * `v4-metrics.METRICS`.
   *
   * The convention is now: **a rate is a fraction in [0, 1], produced by
   * `rate()`, and null when the denominator is empty.** `formatMetric(value,
   * "percent")` renders it; `formatPercent` takes percentage points and is for
   * values that were never fractions.
   *
   * This test looks for the shape of the old mistake — dividing and then
   * multiplying by 100 — anywhere a rate is produced.
   */
  const RATE_PRODUCERS = [
    "src/lib/analytics/",
    "src/lib/campaigns/",
    "src/lib/leads/",
    "src/lib/dashboard/",
    "src/lib/billing/usage-service.ts",
  ];

  /**
   * Not every `/ x * 100` is a rate. A progress bar, a period-over-period
   * change and a share-of-total breakdown are all genuinely percentage points
   * and are read as such. Those carry an explicit marker, so the exception is
   * visible in review rather than inferred by a regex.
   */
  const OPT_OUT = "percentage-points:";

  function scan(
    predicate: (line: string) => boolean,
  ): string[] {
    const offenders: string[] = [];

    for (const { file, text } of SOURCES) {
      if (!RATE_PRODUCERS.some((prefix) => file.startsWith(prefix))) continue;
      if (file.endsWith("v4-metrics.ts")) continue;

      const lines = text.split("\n");
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        // Prose about the rule is not a violation of it.
        if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
        if (line.includes(OPT_OUT)) return;
        // An opt-out comment covers the statement below it. Scanning back to
        // the nearest blank line is what makes that reliable: the marker sits
        // above a comment block, which sits above an assignment, which wraps
        // before the arithmetic, and a fixed line window kept missing it.
        let back = index - 1;
        let excused = false;
        while (back >= 0 && lines[back].trim() !== "") {
          if (lines[back].includes(OPT_OUT)) {
            excused = true;
            break;
          }
          back -= 1;
        }
        if (excused) return;
        if (predicate(line)) offenders.push(`${file}:${index + 1}  ${trimmed}`);
      });
    }

    return offenders;
  }

  test("no module computes a rate as percentage points", () => {
    // `(a / b) * 100` — the percentage-point idiom. A bare `* 100` is fine:
    // converting a fraction for display is correct, dividing and scaling in one
    // expression is what produced the divergence.
    const offenders = scan((line) => /\/[^/\n]*\)\s*\*\s*100\b/.test(line));

    assert.deepEqual(
      offenders,
      [],
      `A rate must be a fraction from rate(), not percentage points. If this is ` +
        `genuinely a progress bar, a trend or a share of total, mark it with a ` +
        `"${OPT_OUT}" comment:\n${offenders.join("\n")}`,
    );
  });

  test("rate() is the only place the empty-denominator rule lives", () => {
    // `x === 0 ? 0 : a / b` guarding a division is the hand-rolled version of
    // rate(), and it always gets the empty case wrong by returning zero.
    //
    // The else-branch must be a bare ratio. `Math.ceil(units / multi)` counts
    // SMS segments — a count, not a rate — and a denominator of zero genuinely
    // means zero segments there.
    const offenders = scan(
      (line) =>
        /===\s*0\s*\?\s*0\s*:/.test(line) &&
        /\?\s*0\s*:\s*[\w.[\]]+\s*\/\s*[\w.[\]]+\s*[,;)]?\s*$/.test(line),
    );

    assert.deepEqual(
      offenders,
      [],
      `Use rate(numerator, denominator) — it returns null, not 0, when there is ` +
        `nothing to divide by:\n${offenders.join("\n")}`,
    );
  });
});

/* ----------------------------------------------------- inbox channels --- */

describe("inbox channels", () => {
  /**
   * The Inbox presents six channel tabs. Three of them — Messenger, Instagram
   * and LinkedIn — have no ingestion path anywhere in the codebase, so they can
   * never contain a conversation. A tab that can only ever be empty is a claim
   * the product cannot honour.
   *
   * This test does not demand that they be built. It demands that the tab list
   * and the ingestion reality agree, so removing a channel or building one both
   * keep the product honest, and forgetting does not.
   */
  /**
   * A channel is `ingestion: "live"` only if something in the codebase can
   * actually produce a message on it. Derived from the source rather than
   * asserted by hand, so building Messenger ingestion makes this test start
   * demanding the flag change, rather than letting the flag rot.
   */
  function hasIngestionPath(channel: string): boolean {
    if (channel === "all") return true;
    const haystack = SOURCES.filter(
      (s) =>
        s.file.startsWith("src/lib/jobs/handlers/") ||
        s.file.startsWith("src/app/api/webhooks/") ||
        s.file.startsWith("src/lib/email/") ||
        s.file.startsWith("src/lib/messaging/"),
    )
      .map((s) => s.text)
      .join("\n");
    return haystack.includes(`"${channel}"`);
  }

  test("a channel is only marked live if something can ingest it", () => {
    for (const channel of INBOX_CHANNELS) {
      const definition = CHANNEL_DEFINITIONS[channel];
      if (definition.ingestion !== "live") continue;
      assert.ok(
        hasIngestionPath(channel),
        `Inbox channel "${channel}" is marked ingestion: "live" but no webhook, ` +
          `job handler or provider references it. A tab that can never fill is a ` +
          `promise the product cannot keep.`,
      );
    }
  });

  test("a channel that cannot fill says so plainly instead of looking empty", () => {
    for (const channel of INBOX_CHANNELS) {
      const definition = CHANNEL_DEFINITIONS[channel];
      if (definition.ingestion === "live") continue;

      assert.ok(
        definition.emptyExplanation.length > 60,
        `Channel "${channel}" cannot fill and does not explain why.`,
      );

      // "Connect X and it will work" is exactly the wrong thing to say about a
      // channel where connecting changes nothing -- but it is the *right* thing
      // to say about a `recorded` channel, where connecting a sending account
      // is precisely what starts putting threads in the tab. The two states are
      // separated here rather than lumped together as "not live", because the
      // sentence the customer reads differs between them.
      if (definition.ingestion === "recorded") {
        assert.ok(
          definition.requires && definition.requires.length > 0,
          `Channel "${channel}" is filled by work the customer does, so it must ` +
            `say what to connect before that work can start.`,
        );
        // The explanation still has to be honest about the mechanism. A
        // recorded thread is not a synced one, and a customer who believes
        // their inbox is syncing will assume silence means no replies.
        assert.match(
          definition.emptyExplanation.toLowerCase(),
          /record/,
          `Channel "${channel}" is recorded rather than synced, and its empty ` +
            `state must say so -- otherwise silence reads as "no replies" when ` +
            `it means "nobody has entered one".`,
        );
        continue;
      }

      assert.equal(
        definition.requires,
        null,
        `Channel "${channel}" has ingestion "${definition.ingestion}" but tells the ` +
          `user to connect something first. Connecting will not make it work.`,
      );
    }
  });
});

/* --------------------------------------------------- provider adapters --- */

describe("integration catalogue", () => {
  /**
   * `connectPath` is the single thing that decides whether the UI offers a
   * working Connect button: `integrations/queries.ts` blocks a provider with a
   * null path as "Not yet available", and the setup drawer disables the button.
   * So a provider without an adapter is already handled — as long as its
   * `connectPath` stays null.
   *
   * The failure this guards is the opposite one: giving a provider a
   * `connectPath` before registering its adapter. That combination renders an
   * enabled Connect button that navigates to a raw 503, and nothing else in the
   * codebase would notice.
   */
  test("every provider with a connect path has a registered adapter", () => {
    const adapterSource = SOURCES.filter((s) =>
      s.file.startsWith("src/lib/integrations/providers/"),
    )
      .map((s) => s.text)
      .join("\n");

    const missing: string[] = [];
    for (const provider of PROVIDERS) {
      if (!provider.connectPath) continue;
      if (provider.connectionMethod !== "oauth") continue;
      if (!adapterSource.includes(`registerOAuthProvider("${provider.id}"`)) {
        missing.push(provider.id);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `These providers advertise a connect path with no registered OAuth ` +
        `adapter, so Connect dead-ends on a 503:\n  ${missing.join("\n  ")}`,
    );
  });

  /**
   * The inverse direction — an adapter with no `connectPath` — is deliberately
   * *not* asserted.
   *
   * It was, briefly, and it was wrong. A registered adapter the catalogue does
   * not expose harms nobody: the card reads "Not yet available" and the button
   * is disabled. That is the correct state for an adapter that exists in code
   * but has not been exercised against the real provider yet, which is exactly
   * where Meta Lead Ads sits.
   *
   * Asserting it turned "someone is part-way through building an integration"
   * into a build failure, and pushed towards exposing an unverified flow to
   * customers to make a test pass. `public-pages.test.ts` already guards the
   * direction that matters commercially: if Meta ever becomes self-serve, that
   * test fails and the enterprise copy gets revisited.
   */
});

/* ------------------------------------------------- migration hygiene --- */

describe("the migration set can be replayed onto an empty database", () => {
  /**
   * Migrations are applied once each, in order, and the Supabase CLI decides
   * which are outstanding by comparing the **version** — the filename prefix
   * before the first underscore — against `supabase_migrations.schema_migrations`.
   *
   * Everything below follows from that one fact. These are filename checks, so
   * they need no database and cannot flake; `scripts/schema-drift.mjs` is the
   * counterpart that checks the live schema and the ledger, and it needs
   * credentials.
   */
  const FILES = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql") && !f.startsWith("9999"))
    .sort();

  const versionOf = (file: string) => file.slice(0, file.indexOf("_"));

  test("there are migrations to check", () => {
    // A glob that matched nothing would make every assertion below vacuous.
    assert.ok(FILES.length > 50, `only ${FILES.length} migrations found`);
  });

  test("every filename is version_name.sql", () => {
    for (const file of FILES) {
      assert.match(
        file,
        /^\d{4,5}_[a-z0-9_]+\.sql$/,
        `${file} does not parse into a version and a name`,
      );
    }
  });

  test("no two migrations claim the same version", () => {
    // This shipped: `0077_company_phone.sql` and
    // `0077_social_relationship_policy.sql` existed together, one applied and
    // one not. The ledger is keyed on version, so only one of them could ever
    // be recorded — and the next push would skip the other silently, with no
    // error and no missing-migration warning. It is the failure mode that gets
    // worse with time rather than better: the longer both sit there, the more
    // likely one is applied by hand and nothing records which.
    const seen = new Map<string, string>();
    for (const file of FILES) {
      const version = versionOf(file);
      const first = seen.get(version);
      assert.ok(
        first === undefined,
        `${file} and ${first} both claim version ${version}. ` +
          `Renumber the one that has not been applied.`,
      );
      seen.set(version, file);
    }
  });

  /**
   * Three migrations carry a five-digit prefix -- `00241_agent_runtime`,
   * `00242_pg_cron_worker`, `00243_ai_token_allowance` -- numbered as though
   * they were "0024.1" and so on, to slot in after `0024_platform_admin_ops`.
   *
   * They do not. Lexically `00241_` sorts *before* `0024_`, because `1` comes
   * before `_`. So the three run before the migration they were numbered to
   * follow, in every tool that reads this directory in sorted order: the CLI,
   * the drift script, and this test.
   *
   * It is harmless here, and that was checked rather than assumed -- none of
   * the three references `platform_error_triage`, `platform_provider_checks`
   * or `admin_event_series`, which is everything `0024` creates. They are
   * grandfathered by name below.
   *
   * What must not happen is a fourth. The next migration numbered this way
   * could easily depend on the one it appears to follow, and the failure would
   * only ever appear when somebody rebuilt an environment from scratch --
   * which is to say during a disaster recovery, which is the worst possible
   * moment to discover the migration set does not replay.
   */
  const GRANDFATHERED_WIDE = new Set([
    "00241_agent_runtime.sql",
    "00242_pg_cron_worker.sql",
    "00243_ai_token_allowance.sql",
  ]);

  test("no new migration uses a prefix width that sorts wrongly", () => {
    for (const file of FILES) {
      if (GRANDFATHERED_WIDE.has(file)) continue;
      assert.equal(
        versionOf(file).length,
        4,
        `${file} has a ${versionOf(file).length}-digit version. Mixed widths ` +
          `sort by character, not by number: "00241" comes before "0024". Use ` +
          `the next free four-digit number.`,
      );
    }
  });

  test("the grandfathered exceptions still exist", () => {
    // If one is renamed or removed, the exemption above becomes a licence for
    // a new file to take its name, which is the opposite of what it is for.
    for (const file of GRANDFATHERED_WIDE) {
      assert.ok(FILES.includes(file), `${file} is exempted but no longer exists`);
    }
  });

  test("four-digit migrations run in numeric order", () => {
    // With the three exceptions removed, filename order and numeric order must
    // agree -- otherwise a migration replays before one it depends on.
    const versions = FILES.filter((f) => !GRANDFATHERED_WIDE.has(f)).map(versionOf);
    assert.deepEqual(
      versions,
      [...versions].sort((a, b) => Number(a) - Number(b)),
      "filename order and numeric order disagree",
    );
  });

  test("a migration never edits an already-applied migration's identity", () => {
    // Not enforceable from filenames alone, but one half is: a migration whose
    // name changes gets a new version and is applied twice. Names are stable
    // once written, so the guard is simply that the set only grows — asserted
    // here as a floor that has to be raised deliberately.
    assert.ok(
      FILES.length >= 81,
      `the migration set has shrunk to ${FILES.length}. A deleted migration ` +
        `cannot be replayed, so an environment rebuilt from this set would ` +
        `differ from production in a way nothing records.`,
    );
  });
});
