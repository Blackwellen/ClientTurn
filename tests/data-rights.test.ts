import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ALL_RULES,
  PERSON_LINK_COLUMN,
  PERSONAL_DATA_RULES,
  retainedOnAnonymise,
  retainedOnDelete,
} from "../src/lib/data-rights/coverage.ts";
import { normaliseForHash, suppressionHash, tokenHash } from "../src/lib/data-rights/hash.ts";
import {
  claimsDeletion,
  CONFIRMATION,
  describeChanges,
  describeKept,
  describeOutcome,
  plural,
  suppressionOutcome,
} from "../src/lib/data-rights/wording.ts";
import { daysUntil, PRIVACY_REQUEST_TYPES } from "../src/lib/data-rights/types.ts";
import {
  buildSocialSourceDisclosure,
  SOCIAL_DISCLOSURE_MAX,
  socialDisclosureRequired,
} from "../src/lib/compliance/source-disclosure.ts";
import { serviceOperation } from "../src/lib/services/registry.ts";
import { callerAllowed, requiresConfirmation } from "../src/lib/services/types.ts";

/**
 * Data rights (Revenue Engine Phase 6).
 *
 * The first block is the one that matters over time: it scans the migrations
 * for every table that links a row to a person and fails when one has no
 * rule in `coverage.ts`. A new table holding personal data about a lead is
 * otherwise silently left behind by every erasure -- no error, no failed
 * test, just a person who asked to be forgotten and was not.
 */

/* ------------------------------------------------------------- migration scan */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

type ScannedTable = { name: string; file: string; columns: string[]; body: string };

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

function scanTables(): Map<string, ScannedTable> {
  const tables = new Map<string, ScannedTable>();
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = stripComments(readFileSync(path.join(MIGRATIONS, file), "utf8"));

    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      const columns: string[] = [];
      for (const line of m[2].split("\n")) {
        const c = line.trim().match(/^([a-z_0-9]+)\s+\w+/);
        if (c && !/^(constraint|unique|primary|check|foreign|exclude)$/.test(c[1])) columns.push(c[1]);
      }
      const existing = tables.get(m[1]);
      tables.set(m[1], {
        name: m[1],
        file,
        columns: existing ? [...existing.columns, ...columns] : columns,
        body: (existing?.body ?? "") + m[2],
      });
    }

    for (const m of sql.matchAll(/alter table (?:if exists )?(?:only )?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      const table = tables.get(m[1]);
      if (!table) continue;
      for (const c of m[2].matchAll(/add column (?:if not exists )?([a-z_0-9]+)\s+\w+/gi)) {
        table.columns.push(c[1]);
      }
      table.body += m[2];
    }

    for (const m of sql.matchAll(/drop table (?:if exists )?(?:public\.)?(\w+)/gi)) {
      tables.delete(m[1]);
    }
  }
  return tables;
}

const TABLES = scanTables();

const personLinked = [...TABLES.values()]
  .filter((table) => table.columns.some((column) => PERSON_LINK_COLUMN.test(column)))
  .map((table) => table.name)
  .sort();

const DATA_RIGHTS_SQL = stripComments(
  readFileSync(
    path.join(MIGRATIONS, readdirSync(MIGRATIONS).find((f) => /_data_rights\.sql$/.test(f))!),
    "utf8",
  ),
);

function functionBody(name: string): string {
  const start = DATA_RIGHTS_SQL.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is not defined in the data-rights migration`);
  const open = DATA_RIGHTS_SQL.indexOf("$$", start);
  const close = DATA_RIGHTS_SQL.indexOf("$$", open + 2);
  return DATA_RIGHTS_SQL.slice(open + 2, close);
}

function retainedList(body: string): string[] {
  const lists = [...body.matchAll(/'retained', to_jsonb\(array\[([\s\S]*?)\]::text\[\]\)/g)];
  assert.ok(lists.length > 0, "no retained list found");
  return lists.flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
}

const SCRUB = functionBody("data_rights_scrub");
const DELETE = functionBody("data_rights_delete");

describe("every table holding personal data about a person has a rule", () => {
  test("the scan found the tables it is supposed to", () => {
    // A scan that silently found nothing would make the next test vacuous.
    for (const table of ["leads", "messages", "conversations", "prospects", "contact_permissions"]) {
      assert.ok(personLinked.includes(table), `${table} was not found`);
    }
    assert.ok(personLinked.length > 40, `only ${personLinked.length} person-linked tables found`);
  });

  test("no person-linked table is missing from coverage.ts", () => {
    const covered = new Set(ALL_RULES.map((rule) => rule.table));
    const missing = personLinked.filter((table) => !covered.has(table));
    assert.deepEqual(
      missing,
      [],
      `These tables link rows to a lead or prospect but have no data-rights rule. ` +
        `Add a rule to src/lib/data-rights/coverage.ts and handle them in ` +
        `data_rights_scrub:\n  ${missing.join("\n  ")}`,
    );
  });

  test("no rule names a table that does not exist", () => {
    const stale = ALL_RULES.map((rule) => rule.table).filter((table) => !TABLES.has(table));
    assert.deepEqual(stale, [], `Rules for tables no migration creates: ${stale.join(", ")}`);
  });

  test("each table has exactly one rule", () => {
    const names = ALL_RULES.map((rule) => rule.table);
    assert.equal(new Set(names).size, names.length);
  });

  test("anything kept says why it may be kept", () => {
    for (const rule of ALL_RULES) {
      if (rule.anonymise === "RETAIN" || rule.delete === "RETAIN") {
        assert.ok(
          rule.retainedBecause && rule.retainedBecause.length > 20,
          `${rule.table} is retained without a reason`,
        );
      }
    }
  });
});

describe("the SQL executor does what the rules say", () => {
  test("every table the rules redact, remove, stop or hash is touched by data_rights_scrub", () => {
    const untouched = ALL_RULES.filter((rule) => rule.anonymise !== "RETAIN")
      .map((rule) => rule.table)
      .filter((table) => !new RegExp(`public\\.${table}\\b`).test(SCRUB));
    assert.deepEqual(untouched, [], `Declared but never touched by the scrub: ${untouched.join(", ")}`);
  });

  test("what anonymising keeps is exactly the scrub's retained list", () => {
    assert.deepEqual(retainedList(SCRUB).sort(), retainedOnAnonymise().sort());
  });

  test("what deleting keeps is exactly the delete's retained list", () => {
    assert.deepEqual(retainedList(DELETE).sort(), retainedOnDelete().sort());
  });

  test("every table a delete removes is removed by cascade, by the scrub, or explicitly", () => {
    const removedExplicitly = new Set(
      [...DELETE.matchAll(/delete from public\.(\w+)/g)].map((m) => m[1]),
    );
    const parents = /references public\.(leads|prospects|conversations|messages)\(id\) on delete cascade/;

    const unexplained = ALL_RULES.filter((rule) => rule.delete === "REMOVE")
      .filter((rule) => rule.anonymise !== "REMOVE")
      .filter((rule) => !removedExplicitly.has(rule.table))
      .filter((rule) => !parents.test(TABLES.get(rule.table)?.body ?? ""))
      .map((rule) => rule.table);
    assert.deepEqual(unexplained, [], `Said to be removed on delete, but nothing removes them: ${unexplained.join(", ")}`);
  });

  test("the executors are service-role only and record their own action", () => {
    for (const fn of ["data_rights_anonymise", "data_rights_delete", "data_rights_suppress"]) {
      assert.match(DATA_RIGHTS_SQL, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s*from public, anon, authenticated`));
      assert.match(DATA_RIGHTS_SQL, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s*to service_role`));
      assert.match(functionBody(fn), /insert into public\.data_rights_actions/);
    }
    // The scrub itself has no grant at all: only the executors may call it.
    assert.doesNotMatch(DATA_RIGHTS_SQL, /grant execute on function public\.data_rights_scrub/);
  });

  test("check_suppression keeps its signature and grants, and matches hashes", () => {
    const body = functionBody("check_suppression");
    assert.match(
      DATA_RIGHTS_SQL,
      /create or replace function public\.check_suppression\(\s*p_business_id uuid,\s*p_channel text,\s*p_email citext default null,\s*p_phone text default null,\s*p_social text default null\s*\)\s*returns table \(reason text, scope text, created_at timestamptz\)/,
    );
    assert.match(
      DATA_RIGHTS_SQL,
      /revoke all on function public\.check_suppression\(uuid, text, citext, text, text\) from public, anon, authenticated;/,
    );
    for (const column of ["email_hash", "phone_hash", "social_hash"]) {
      assert.match(body, new RegExp(`s\\.${column} = h\\.${column}`));
    }
    // Still matches plaintext while the contact exists (decision Q5).
    assert.match(body, /s\.email = p_email/);
  });

  test("the salt table is server-only", () => {
    assert.match(DATA_RIGHTS_SQL, /alter table public\.platform_secrets enable row level security;/);
    assert.doesNotMatch(DATA_RIGHTS_SQL, /create policy[^;]*platform_secrets/);
    assert.match(DATA_RIGHTS_SQL, /revoke all on public\.platform_secrets from public, anon, authenticated;/);
  });

  test("the data-rights record is append-only and server-only", () => {
    assert.match(DATA_RIGHTS_SQL, /before update on public\.data_rights_actions/);
    assert.match(DATA_RIGHTS_SQL, /alter table public\.data_rights_actions enable row level security;/);
  });

  test("a restriction is a LEGAL suppression on every channel", () => {
    const body = functionBody("data_rights_suppress");
    assert.match(body, /if p_reason = 'LEGAL' then\s*v_channel := 'ALL';/);
    assert.match(body, /when p_reason = 'LEGAL' then 'RESTRICT'/);
  });
});

/* ---------------------------------------------------------------- hashing */

describe("suppression hash normalisation", () => {
  test("email is trimmed and lower-cased", () => {
    assert.equal(normaliseForHash("email", "  Jane.Doe@Example.COM "), "jane.doe@example.com");
  });

  test("phone keeps only digits and +", () => {
    assert.equal(normaliseForHash("phone", " +44 (0)7700-900 123 "), "+4407700900123");
    assert.equal(normaliseForHash("phone", "+447700900123"), "+447700900123");
  });

  test("social is trimmed and otherwise untouched (ids are case-sensitive)", () => {
    assert.equal(normaliseForHash("social", "  meta_psid:AbC123 "), "meta_psid:AbC123");
  });

  test("empty and missing values hash to nothing", () => {
    for (const kind of ["email", "phone", "social"] as const) {
      assert.equal(normaliseForHash(kind, null), null);
      assert.equal(normaliseForHash(kind, "   "), null);
      assert.equal(suppressionHash("salt", kind, ""), null);
    }
  });

  test("the hash is sha256 hex of salt || normalised value", () => {
    const a = suppressionHash("s3cret", "email", "Jane@Example.com");
    const b = suppressionHash("s3cret", "email", " jane@example.com");
    assert.equal(a, b);
    assert.match(a!, /^[0-9a-f]{64}$/);
    assert.notEqual(a, suppressionHash("other", "email", "jane@example.com"));
  });

  test("the SQL normalises exactly the same way", () => {
    const body = functionBody("suppression_hash");
    assert.match(body, /when 'email' then lower\(btrim\(p_value\)\)/);
    assert.match(body, /when 'phone' then regexp_replace\(btrim\(p_value\), '\[\^0-9\+\]', '', 'g'\)/);
    assert.match(body, /when 'social' then btrim\(p_value\)/);
    assert.match(body, /digest\(v_salt \|\| v_norm, 'sha256'\)/);
  });

  test("verification tokens are stored as a sha256", () => {
    assert.match(tokenHash("abc"), /^[0-9a-f]{64}$/);
    assert.notEqual(tokenHash("abc"), "abc");
  });
});

/* ---------------------------------------------------------------- wording */

describe("never 'deleted' when something remains (brief §15)", () => {
  test("every confirmation avoids claiming deletion", () => {
    for (const [mode, copy] of Object.entries(CONFIRMATION)) {
      for (const text of [copy.scope, copy.consequence]) {
        assert.equal(claimsDeletion(text), false, `${mode}: "${text}"`);
      }
    }
  });

  test("anonymise and erase both say what is kept, and that it cannot be undone", () => {
    for (const mode of ["ANONYMISE", "DELETE"] as const) {
      assert.match(CONFIRMATION[mode].consequence, /^Kept/);
      assert.match(CONFIRMATION[mode].consequence, /hash/);
      assert.match(CONFIRMATION[mode].consequence, /cannot be undone/);
    }
  });

  test("an erase outcome lists what was kept and never says deleted", () => {
    const outcome = describeOutcome("DELETE", {
      leads: { redacted: 1, removed: 1 },
      messages: { redacted: 12 },
      suppression_entries: { hashed: 2 },
      legacy_suppression_list: { removed: 1 },
    });
    assert.ok(outcome.kept.length > 0);
    for (const line of [outcome.headline, ...outcome.changed, ...outcome.kept]) {
      assert.equal(claimsDeletion(line), false, line);
    }
    assert.match(outcome.headline, /erased/);
    assert.match(outcome.headline, /kept/);
  });

  test("an anonymise outcome keeps the record for reporting", () => {
    const kept = describeKept("ANONYMISE");
    assert.match(kept[0], /lead record itself/);
    assert.ok(kept.some((line) => /Do-not-contact|hash/i.test(line)) || retainedOnAnonymise().length > 0);
  });

  test("changes are described per table with counts", () => {
    const lines = describeChanges({ messages: { redacted: 3 }, suppression_entries: { hashed: 1 } });
    // Rule order, not insertion order.
    assert.deepEqual(lines, [
      "Do-not-contact entries: converted to a salted hash (1 record).",
      "Message text, subjects and attachments: personal values removed (3 records).",
    ]);
  });

  test("zero counts are not reported as changes", () => {
    assert.deepEqual(describeChanges({ messages: { redacted: 0 } }), []);
  });

  test("the deletion detector catches the claims it exists for", () => {
    assert.equal(claimsDeletion("All their data was deleted."), true);
    assert.equal(claimsDeletion("Lead deleted"), true);
    assert.equal(claimsDeletion("Removed; kept as a hash."), false);
  });

  test("a suppression outcome says the lead is kept", () => {
    const line = suppressionOutcome({
      mode: "SUPPRESS",
      channel: "ALL",
      entriesAdded: 2,
      destinations: { email: 1, phone: 1, social: 0 },
    });
    assert.match(line, /2 addresses suppressed on every channel\. 2 entries added\./);
    assert.match(line, /kept/);
  });

  test("a lead with no address is told plainly", () => {
    const line = suppressionOutcome({
      mode: "RESTRICT",
      channel: "ALL",
      entriesAdded: 0,
      destinations: { email: 0, phone: 0, social: 0 },
    });
    assert.match(line, /nothing to add/);
  });

  test("plurals", () => {
    assert.equal(plural(1, "entry"), "1 entry");
    assert.equal(plural(2, "entry"), "2 entries");
    assert.equal(plural(3, "address"), "3 addresses");
    assert.equal(plural(4, "record"), "4 records");
  });
});

/* ------------------------------------------------------ Article 14 social */

describe("Article 14 at social first contact", () => {
  const base = {
    provenanceTypes: ["LICENSED_PROVIDER", "WEBSITE"],
    legalName: "Acme Ltd",
    privacyPolicyUrl: "https://acme.example/privacy",
  };

  test("names the most recognisable source and the notice, within the limit", () => {
    const disclosure = buildSocialSourceDisclosure(base);
    assert.equal(disclosure.blocked, false);
    assert.ok(disclosure.line!.length <= SOCIAL_DISCLOSURE_MAX);
    assert.match(disclosure.line!, /your company's own website/);
    assert.match(disclosure.line!, /https:\/\/acme\.example\/privacy/);
  });

  test("blocks exactly when the email disclosure would", () => {
    assert.equal(buildSocialSourceDisclosure({ ...base, provenanceTypes: [] }).blocked, true);
    assert.equal(buildSocialSourceDisclosure({ ...base, privacyPolicyUrl: null }).blocked, true);
  });

  test("shortens rather than overflowing, and refuses when it cannot fit", () => {
    const tight = buildSocialSourceDisclosure({ ...base, maxLength: 90 });
    assert.equal(tight.blocked, false);
    assert.ok(tight.line!.length <= 90);
    const impossible = buildSocialSourceDisclosure({ ...base, maxLength: 20 });
    assert.equal(impossible.blocked, true);
  });

  test("only a first contact the person did not start owes it", () => {
    assert.equal(socialDisclosureRequired({ isFirstContact: true, personInitiated: false }), true);
    assert.equal(socialDisclosureRequired({ isFirstContact: true, personInitiated: true }), false);
    assert.equal(socialDisclosureRequired({ isFirstContact: false, personInitiated: false }), false);
  });
});

/* ------------------------------------------------------------ operations */

describe("data-rights operations in the catalogue", () => {
  test("anonymise and erase are destructive, confirmed, and never an agent's", () => {
    for (const name of ["lead.anonymise", "lead.delete", "lead.suppress"]) {
      const op = serviceOperation(name);
      assert.ok(op, `${name} missing`);
      assert.equal(op!.risk, "DESTRUCTIVE");
      assert.equal(requiresConfirmation(op!.risk), true);
      assert.equal(callerAllowed(op!, "AGENT"), false);
      assert.equal(claimsDeletion(op!.effect ?? ""), false, `${name} effect claims deletion`);
    }
  });

  test("erase and anonymise are owner/admin only", () => {
    assert.equal(serviceOperation("lead.delete")!.minimumRole, "admin");
    assert.equal(serviceOperation("lead.anonymise")!.minimumRole, "admin");
  });

  test("Copilot holds no suppression or erasure authority (the standing Copilot rule)", () => {
    for (const name of ["lead.suppress", "lead.anonymise", "lead.delete"]) {
      assert.equal(callerAllowed(serviceOperation(name)!, "COPILOT"), false, name);
    }
  });

  test("export hands over everything, so it is admin-only and kept out of model context", () => {
    const op = serviceOperation("lead.export")!;
    assert.equal(op.minimumRole, "admin");
    assert.equal(callerAllowed(op, "COPILOT"), false);
    assert.equal(callerAllowed(op, "AGENT"), false);
  });

  test("privacy requests are admin business", () => {
    for (const name of ["privacy_request.list", "privacy_request.create", "privacy_request.update"]) {
      assert.equal(serviceOperation(name)?.minimumRole, "admin", name);
    }
  });

  test("the intake vocabulary is what the migration permits", () => {
    for (const type of PRIVACY_REQUEST_TYPES) {
      assert.match(DATA_RIGHTS_SQL, new RegExp(`'${type}'`), type);
    }
  });
});

describe("request clocks", () => {
  test("days until a deadline, negative when overdue", () => {
    const now = Date.UTC(2026, 8, 25, 12);
    assert.equal(daysUntil(new Date(now + 3 * 86_400_000).toISOString(), now), 3);
    assert.equal(daysUntil(new Date(now - 2 * 86_400_000).toISOString(), now), -2);
    assert.equal(daysUntil(null, now), null);
  });

  test("the database, not the writer, sets acknowledge_by and due_at", () => {
    const body = functionBody("privacy_requests_set_clocks");
    assert.match(body, /new\.acknowledge_by := new\.received_at \+ interval '30 days'/);
    assert.match(body, /new\.due_at := new\.received_at \+ interval '1 month'/);
  });
});

void PERSONAL_DATA_RULES;
