/**
 * Guards for the signed-in app QA sweep (2026-09-28): each defect below was
 * found by driving the demo workspace in a browser, fixed, and re-verified.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fullNameIlike } from "../src/lib/supabase/ilike.ts";
import { countSeats } from "../src/lib/team/rules.ts";
import { timezoneLabel } from "../src/lib/settings/types.ts";
import { formatTimezoneLabel } from "../src/lib/dates.ts";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("lead search matches a full name", () => {
  test("a two-word term matches first and last name together", () => {
    assert.equal(
      fullNameIlike("Chloe Winters"),
      'and(first_name.ilike."%Chloe%",last_name.ilike."%Winters%")',
    );
    assert.equal(
      fullNameIlike("  Anna  de la Cruz "),
      'and(first_name.ilike."%Anna%",last_name.ilike."%de la Cruz%")',
    );
  });

  test("a single word adds nothing, and filter syntax stays literal", () => {
    assert.equal(fullNameIlike("Chloe"), null);
    assert.equal(fullNameIlike("   "), null);
    assert.equal(
      fullNameIlike("a,b (c)"),
      'and(first_name.ilike."%a,b%",last_name.ilike."%(c)%")',
    );
  });

  test("the leads list and global search both use it", () => {
    assert.match(read("src/lib/leads/queries.ts"), /fullNameIlike\(filters\.q\)/);
    assert.match(read("src/lib/search/queries.ts"), /fullNameIlike\(term\)/);
  });
});

describe("seat counts agree everywhere", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  test("an expired invitation holds no seat; suspended and open invites do", () => {
    const rows = [
      { status: "active", invited_at: null },
      { status: "suspended", invited_at: null },
      { status: "invited", invited_at: "2026-09-27T12:00:00Z" },
      { status: "invited", invited_at: "2026-01-01T12:00:00Z" },
    ];
    assert.equal(countSeats(rows, now), 3);
    assert.equal(countSeats(null, now), 0);
  });

  test("Billing and Usage & limits count with the same rule as the Team page", () => {
    assert.match(read("src/lib/settings/queries.ts"), /seatsUsed: countSeats\(seatResult\.data\)/);
    assert.match(read("src/lib/billing/limits-service.ts"), /used: countSeats\(seats\.data\)/);
  });
});

describe("hydration-safe text", () => {
  test("a zero offset reads the same in Node and Chromium", () => {
    assert.match(timezoneLabel("UTC"), /^\(GMT\+00:00\) /);
    assert.match(formatTimezoneLabel("UTC"), /^\(GMT\+00:00\) /);
  });
});

describe("copy and state fixes", () => {
  test("validation errors shown in the app carry no field path", () => {
    const runtime = read("src/lib/services/runtime.ts");
    assert.match(runtime, /firstIssue\(parsed\.error, context\.caller !== "UI"\)/);
  });

  test("a closing agent's limits count leads, not prospects", () => {
    const tabs = read("src/components/agents/agent-tabs.tsx");
    assert.match(tabs, /isSourcing\(type\) \? "prospects" : "leads"/);
    assert.doesNotMatch(tabs, /ProspectCap\.toLocaleString\("en-GB"\)\} prospects`/);
  });

  test("the lead-list view switch keeps a name on phones", () => {
    const toolbar = read("src/components/leads/leads-toolbar.tsx");
    assert.match(toolbar, /sr-only sm:not-sr-only">\{option\.label\}/);
  });

  test("sticky save bars clear the support button on phones too", () => {
    assert.match(read("src/components/qualification/qualification-editor.tsx"), /"pr-20 sm:-mx-6/);
    assert.match(read("src/components/settings/settings-save-bar.tsx"), /"pr-20 sm:-mx-6/);
  });

  test("LinkedIn Assist says Rewritten only for an AI draft", () => {
    const board = read("src/components/follow-up/linkedin-assist-board.tsx");
    assert.match(board, /if \(source === "AI"\) toast\(\{ variant: "success", title: "Rewritten" \}\)/);
  });

  test("the permissions grid leaves out expired invitations", () => {
    assert.match(
      read("src/app/(app)/app/settings/_sections/team-section.tsx"),
      /members\.filter\(\(member\) => !expired\.has\(member\.membershipId\)\)/,
    );
  });
});

describe("admin-only pages show a permission state to members", () => {
  test("New agent and Import render PermissionDeniedState instead of throwing", () => {
    for (const file of ["src/app/(app)/app/agents/new/page.tsx", "src/app/(app)/app/leads/import/page.tsx"]) {
      const page = read(file);
      assert.doesNotMatch(page, /requireRole\("admin"\)/, file);
      assert.match(page, /<PermissionDeniedState/, file);
    }
  });

  test("the Import link is only offered to owners and admins", () => {
    assert.match(read("src/app/(app)/app/leads/page.tsx"), /canImport=\{hasRole\(workspace\.role, "admin"\)\}/);
    assert.match(read("src/components/leads/add-lead/add-lead-button.tsx"), /\{canImport && \(/);
  });
});
