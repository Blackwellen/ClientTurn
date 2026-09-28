import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_TIMEZONE,
  dayGroupLabel,
  formatDate,
  formatDateTime,
  formatInZone,
  formatTime,
  resolveTimezone,
} from "../src/lib/dates.ts";

/**
 * Dates render in the workspace's zone (Europe/London by default), never the
 * runtime's. Vercel runs in UTC and a browser in whatever zone its user is in,
 * so formatting without an explicit `timeZone` put UK times an hour out during
 * BST and made server and client disagree (a hydration mismatch).
 */

const root = path.resolve(import.meta.dirname, "..");

// 13:05:09 UTC on 15 July 2026 is 14:05:09 in London (BST, UTC+1).
const SUMMER = "2026-07-15T13:05:09.000Z";
// 23:30 UTC on 14 July is already 15 July in London.
const LATE_EVENING = "2026-07-14T23:30:00.000Z";
// Winter: London is on GMT, so wall clock equals UTC.
const WINTER = "2026-01-15T13:05:09.000Z";

describe("UK wall-clock formatting", () => {
  test("a fixed UTC instant in BST renders the UK wall-clock time", () => {
    assert.equal(formatTime(SUMMER), "14:05");
    assert.equal(formatDateTime(SUMMER), "15 Jul, 14:05");
    assert.equal(formatDateTime(SUMMER, { year: true }), "15 Jul 2026, 14:05");
    assert.equal(formatInZone(SUMMER, "datetime"), "15/07/2026, 14:05:09");
    assert.equal(formatInZone(SUMMER, "time"), "14:05:09");
  });

  test("the date is the London calendar day, not the UTC one", () => {
    assert.equal(formatDate(LATE_EVENING), "15 Jul 2026");
    assert.equal(formatInZone(LATE_EVENING, "date"), "15/07/2026");
  });

  test("in winter London is on GMT", () => {
    assert.equal(formatTime(WINTER), "13:05");
  });

  test("a workspace timezone passed down is honoured", () => {
    assert.equal(formatTime(SUMMER, { timeZone: "America/New_York" }), "09:05");
    assert.equal(formatInZone(SUMMER, { hour: "2-digit", minute: "2-digit" }, "Asia/Tokyo"), "22:05");
  });

  test("an unknown or missing timezone falls back to Europe/London", () => {
    assert.equal(DEFAULT_TIMEZONE, "Europe/London");
    assert.equal(resolveTimezone(undefined), "Europe/London");
    assert.equal(resolveTimezone("Not/AZone"), "Europe/London");
    assert.equal(formatTime(SUMMER, { timeZone: "Not/AZone" }), "14:05");
  });

  test("options cannot override the zone", () => {
    assert.equal(formatInZone(SUMMER, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }), "14:05");
  });

  test("empty and invalid input render a dash", () => {
    assert.equal(formatInZone(null), "—");
    assert.equal(formatInZone("not a date", "datetime"), "—");
    assert.equal(dayGroupLabel("nope"), "—");
  });

  test("presets match the old toLocale*String output in London", () => {
    const date = new Date(SUMMER);
    const london = { timeZone: "Europe/London" };
    assert.equal(formatInZone(date, "date"), date.toLocaleDateString("en-GB", london));
    assert.equal(formatInZone(date, "time"), date.toLocaleTimeString("en-GB", london));
    assert.equal(formatInZone(date, "datetime"), date.toLocaleString("en-GB", london));
  });
});

describe("identical output whatever zone the process runs in", () => {
  const datesUrl = pathToFileURL(path.join(root, "src/lib/dates.ts")).href;
  const script = `
    const d = await import(${JSON.stringify(datesUrl)});
    const values = [${JSON.stringify(SUMMER)}, ${JSON.stringify(LATE_EVENING)}, ${JSON.stringify(WINTER)}];
    const out = values.flatMap((v) => [
      d.formatDate(v), d.formatDateTime(v), d.formatDateTime(v, { year: true }), d.formatTime(v),
      d.formatInZone(v, "date"), d.formatInZone(v, "time"), d.formatInZone(v, "datetime"),
      d.formatInZone(v, { weekday: "short", day: "numeric", month: "short" }),
    ]);
    process.stdout.write(JSON.stringify(out));
  `;

  function runIn(tz: string): string[] {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8",
    });
    return JSON.parse(stdout) as string[];
  }

  test("formatting is identical under TZ=UTC and TZ=Europe/London", () => {
    const utc = runIn("UTC");
    const london = runIn("Europe/London");
    assert.deepEqual(utc, london);
    // And it is the London wall clock, not UTC's.
    assert.ok(utc.includes("14:05"), `expected 14:05 in ${utc.join(" | ")}`);
  });

  test("and under a zone far from both", () => {
    assert.deepEqual(runIn("Pacific/Auckland"), runIn("UTC"));
  });
});

describe("no zone-less date formatting in app surfaces", () => {
  const DIRS = ["src/app/(app)", "src/components", "src/app/admin"];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  /** Text of a call from its opening paren to the matching close. */
  function callText(source: string, open: number): string {
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) return source.slice(open, i + 1);
    }
    return source.slice(open);
  }

  test("every toLocaleDateString / toLocaleTimeString / Intl.DateTimeFormat names a timeZone", () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((dir) => walk(path.join(root, dir)))) {
      // The public marketing pages have no workspace and are out of scope.
      if (file.includes(`${path.sep}marketing${path.sep}`)) continue;
      const source = readFileSync(file, "utf8");
      const re = /(\.toLocaleDateString|\.toLocaleTimeString|new Intl\.DateTimeFormat|new Date\([^)]*\)\.toLocaleString)\(/g;
      for (const match of source.matchAll(re)) {
        const call = callText(source, match.index + match[0].length - 1);
        if (!/timeZone/.test(call)) {
          const line = source.slice(0, match.index).split("\n").length;
          offenders.push(`${path.relative(root, file)}:${line}`);
        }
      }
    }
    assert.deepEqual(offenders, [], `use formatInZone from @/lib/dates at: ${offenders.join(", ")}`);
  });
});
