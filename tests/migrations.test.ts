import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Properties of the migration directory itself.
 *
 * Every assertion here corresponds to a failure that has actually happened in
 * this repository, and they share a shape: each one is invisible at review and
 * fails at `db push`, which means it lands on whoever deploys rather than on
 * whoever wrote it. That is the worst place for a mistake to surface — the
 * person hitting it usually has the least context on the change that caused it.
 *
 * These are cheap. The directory is a few dozen small files and reading all of
 * them costs single-digit milliseconds, so there is no reason for this to be a
 * separate script somebody has to remember to run.
 */

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

type Migration = {
  file: string;
  /** The numeric prefix, as written. `0072`, not 72 — leading zeros matter. */
  version: string;
  sql: string;
};

function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({
      file,
      version: file.split("_")[0],
      sql: readFileSync(path.join(MIGRATIONS, file), "utf8"),
    }));
}

const migrations = loadMigrations();

describe("the migration directory", () => {
  test("no two migrations share a version number", () => {
    // This has happened four times in one working session, every time because
    // two people numbered a file from the same starting point. Supabase keys
    // its history on the prefix alone, so the second one to reach the database
    // fails with a primary key violation — at deploy, never at review.
    const byVersion = new Map<string, string[]>();
    for (const migration of migrations) {
      const existing = byVersion.get(migration.version) ?? [];
      existing.push(migration.file);
      byVersion.set(migration.version, existing);
    }

    const collisions = [...byVersion.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([version, files]) => `${version}: ${files.join(", ")}`);

    assert.deepEqual(
      collisions,
      [],
      `Two migrations claim the same version. Renumber the newer one to the next free slot:\n  ${collisions.join("\n  ")}`,
    );
  });

  test("every migration is named `NNNN_snake_case_description.sql`", () => {
    // The version has to be parseable and the description has to say something.
    // `0093.sql` sorts correctly and tells the next person nothing.
    const malformed = migrations
      .filter((migration) => !/^\d{4,5}_[a-z0-9_]+\.sql$/.test(migration.file))
      .map((migration) => migration.file);

    assert.deepEqual(malformed, [], `Badly named migrations: ${malformed.join(", ")}`);
  });

  test("the header comment names the file it is in", () => {
    // Renaming a migration and forgetting its header produces a file whose
    // first line describes a different migration — which is exactly what a
    // person reads first when working out why a deploy failed. Caught here
    // because renumbering is now a routine consequence of the collision check
    // above, and a routine action that quietly corrupts a comment will.
    const mismatched: string[] = [];

    for (const migration of migrations) {
      const firstLine = migration.sql.split("\n", 1)[0] ?? "";
      // Only checked when the header follows the convention at all. A file
      // with a different comment style is a style question, not a defect.
      if (!/^--\s*\d{4,5}_/.test(firstLine)) continue;

      const declared = firstLine.replace(/^--\s*/, "").split(/[:\s]/)[0];
      const actual = migration.file.replace(/\.sql$/, "");
      if (declared !== actual) {
        mismatched.push(`${migration.file} says "${declared}"`);
      }
    }

    assert.deepEqual(
      mismatched,
      [],
      `A migration's header names a different file:\n  ${mismatched.join("\n  ")}`,
    );
  });

  test("no migration is empty", () => {
    // A file that reaches the directory with nothing in it still consumes a
    // version number, so the next person numbers around it and the gap looks
    // deliberate.
    const empty = migrations
      .filter((migration) => migration.sql.replace(/--[^\n]*/g, "").trim().length === 0)
      .map((migration) => migration.file);

    assert.deepEqual(empty, [], `Empty migrations: ${empty.join(", ")}`);
  });
});

/**
 * Row-level security is deliberately NOT checked here.
 *
 * It was, and the check had to come out. `0010_rls.sql` enables RLS by looping
 * a `format('alter table public.%I enable row level security', t)` over an
 * array of table names, so the table never appears as a literal anywhere a
 * regex can see it. A textual check reports two dozen correctly-protected
 * tables as offenders, and a failure everybody learns to ignore is worse than
 * no failure at all.
 *
 * The authoritative check already exists and runs against the live database:
 * "every public table has row-level security" in `tests/e2e-four-routes.ts`,
 * which reads `pg_class.relrowsecurity` and cannot be fooled by how the SQL
 * was written. That is the right layer for it.
 */
