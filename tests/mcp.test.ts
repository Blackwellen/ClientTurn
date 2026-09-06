import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MCP_TOOLS,
  MCP_SCOPES,
  SCOPE_DESCRIPTIONS,
  roleAllows,
  toolByName,
  toolsForScopes,
} from "../src/lib/mcp/tools.ts";

/**
 * The MCP catalogue is a permission boundary, so these tests are written from
 * the direction that matters: proving the dangerous tools cannot be reached
 * cheaply. A tool that quietly loses its APPROVAL_GATED kind, or gains a scope
 * every read token already holds, is a security regression that would otherwise
 * be invisible in review.
 */

describe("MCP tool catalogue", () => {
  test("every tool declares a kind, a scope and a minimum role", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(["READ", "WRITE", "APPROVAL_GATED"].includes(tool.kind), tool.name);
      assert.ok(
        (MCP_SCOPES as readonly string[]).includes(tool.scope),
        `${tool.name} has an unknown scope`,
      );
      assert.ok(
        ["viewer", "member", "admin"].includes(tool.minimumRole),
        `${tool.name} has an unknown minimum role`,
      );
      assert.ok(tool.description.length > 20, `${tool.name} needs a real description`);
    }
  });

  test("tool names are unique", () => {
    const names = MCP_TOOLS.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length);
  });

  /* --------------------------------------------------- the dangerous set */

  test("everything that sends, launches or spends is approval-gated", () => {
    const mustBeGated = [
      "send_message",
      "launch_campaign",
      "start_sourcing_run",
      "change_overage_cap",
    ];

    for (const name of mustBeGated) {
      const tool = toolByName(name);
      assert.ok(tool, `${name} is missing from the catalogue`);
      assert.equal(
        tool!.kind,
        "APPROVAL_GATED",
        `${name} must park for a human, not execute`,
      );
    }
  });

  test("no read-scoped tool can write", () => {
    for (const tool of MCP_TOOLS) {
      if (tool.scope.endsWith(":read")) {
        assert.equal(tool.kind, "READ", `${tool.name} has a read scope but is not a read`);
      }
    }
  });

  test("every write and gated tool needs at least member access", () => {
    for (const tool of MCP_TOOLS) {
      if (tool.kind !== "READ") {
        assert.notEqual(
          tool.minimumRole,
          "viewer",
          `${tool.name} must not be available to a viewer`,
        );
      }
    }
  });

  test("approving a prospect and launching a campaign require admin", () => {
    assert.equal(toolByName("approve_prospect")?.minimumRole, "admin");
    assert.equal(toolByName("launch_campaign")?.minimumRole, "admin");
    assert.equal(toolByName("start_sourcing_run")?.minimumRole, "admin");
  });

  /* ---------------------------------------------------------- filtering */

  test("scope filtering hides tools a token was not granted", () => {
    const readOnly = toolsForScopes(["leads:read"]);
    assert.ok(readOnly.length > 0);
    for (const tool of readOnly) {
      assert.equal(tool.scope, "leads:read");
      assert.equal(tool.kind, "READ");
    }
    assert.equal(
      readOnly.some((tool) => tool.name === "create_lead"),
      false,
      "a read-only token must not see a write tool",
    );
  });

  test("an empty scope list grants nothing", () => {
    assert.deepEqual(toolsForScopes([]), []);
  });

  test("an unknown scope grants nothing", () => {
    assert.deepEqual(toolsForScopes(["everything:always"]), []);
  });

  /* ------------------------------------------------------------- roles */

  test("role ranking gates by the authorising user's current role", () => {
    const write = toolByName("create_lead")!;
    const adminOnly = toolByName("approve_prospect")!;

    assert.equal(roleAllows("viewer", write), false);
    assert.equal(roleAllows("member", write), true);
    assert.equal(roleAllows("admin", write), true);
    assert.equal(roleAllows("owner", write), true);

    assert.equal(roleAllows("member", adminOnly), false);
    assert.equal(roleAllows("admin", adminOnly), true);
  });

  test("an unrecognised role is refused rather than defaulted", () => {
    const read = toolByName("search_leads")!;
    assert.equal(roleAllows("", read), false);
    assert.equal(roleAllows("superuser", read), false);
  });

  /* ------------------------------------------------------------ scopes */

  test("every scope has a description a person can consent to", () => {
    for (const scope of MCP_SCOPES) {
      const description = SCOPE_DESCRIPTIONS[scope];
      assert.ok(description && description.length > 10, `${scope} needs a description`);
      // The consent screen shows these; a scope named after a table would
      // leak the data model into an authorisation prompt.
      assert.equal(
        /table|row|column|sql/i.test(description),
        false,
        `${scope} description should describe capability, not storage`,
      );
    }
  });

  test("every scope in the catalogue is one a token can actually be granted", () => {
    const used = new Set(MCP_TOOLS.map((tool) => tool.scope));
    for (const scope of used) {
      assert.ok(
        (MCP_SCOPES as readonly string[]).includes(scope),
        `${scope} is used by a tool but is not grantable`,
      );
    }
  });
});
