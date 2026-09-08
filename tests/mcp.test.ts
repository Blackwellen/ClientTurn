import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MCP_TOOLS,
  MCP_SCOPES,
  SCOPE_DESCRIPTIONS,
  mcpKindForRisk,
  roleAllows,
  toolByName,
  toolsForScopes,
} from "../src/lib/mcp/tools.ts";
import { operationsForCaller } from "../src/lib/services/registry.ts";

/**
 * The MCP catalogue is a permission boundary, so these tests are written from
 * the direction that matters: proving the dangerous tools cannot be reached
 * cheaply. A tool that quietly loses its APPROVAL_GATED kind, or gains a scope
 * every read token already holds, is a security regression that would otherwise
 * be invisible in review.
 *
 * The invariants used to be asserted against `MCP_TOOLS`, a hand-written array
 * that has since shrunk to one entry as the capabilities moved into the service
 * registry. They are asserted here against the *effective* catalogue — the
 * registry plus whatever remains in that array — because otherwise the rules
 * would keep passing while protecting almost nothing.
 */

/** Every tool an MCP client can be offered, from wherever it is declared. */
const EFFECTIVE = [
  ...operationsForCaller("MCP").map((operation) => ({
    name: operation.name,
    kind: mcpKindForRisk(operation.risk),
    scope: operation.scope as string,
    minimumRole: operation.minimumRole as string,
    description: operation.effect
      ? `${operation.summary}. ${operation.effect}`
      : operation.summary,
  })),
  ...MCP_TOOLS.map((tool) => ({
    name: tool.name,
    kind: tool.kind,
    scope: tool.scope as string,
    minimumRole: tool.minimumRole as string,
    description: tool.description,
  })),
];

describe("MCP tool catalogue", () => {
  test("every tool declares a kind, a scope and a minimum role", () => {
    for (const tool of EFFECTIVE) {
      assert.ok(["READ", "WRITE", "APPROVAL_GATED"].includes(tool.kind), tool.name);
      assert.ok(
        (MCP_SCOPES as readonly string[]).includes(tool.scope),
        `${tool.name} has an unknown scope`,
      );
      assert.ok(
        ["viewer", "member", "admin", "owner"].includes(tool.minimumRole),
        `${tool.name} has an unknown minimum role`,
      );
      // A registry summary is deliberately one terse line ("Add a note to a
      // lead"), so the bar is "a readable phrase" rather than a paragraph. What
      // it actually catches is an empty description, or a name repeated as one.
      assert.ok(
        tool.description.length > 12 && tool.description.includes(" "),
        `${tool.name} needs a real description, got "${tool.description}"`,
      );
    }
  });

  test("tool names are unique across both catalogues", () => {
    // The regression this catches directly: a legacy tool left in place after
    // its service operation shipped, so an assistant is offered two tools that
    // do the same thing and has to guess which the customer meant.
    const names = EFFECTIVE.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length, "a tool name is declared twice");
  });

  test("the legacy array holds nothing a service operation already covers", () => {
    const registered = new Set(operationsForCaller("MCP").map((o) => o.name));
    // Compared by capability, not by spelling: `get_lead` and `lead.get` are
    // the same thing named differently, which is the duplication worth finding.
    const overlap = MCP_TOOLS.filter((tool) =>
      // `registered` is a Set of the operation-name union, so the rewritten
      // string has to be widened before it can be looked up. The rewrite is
      // the point of the test — it is deliberately allowed to produce a name
      // that is not a real operation, because "no match" is the passing case.
      (registered as Set<string>).has(
        tool.name.replace(/^(get|search|list)_(.+)$/, "$2.$1"),
      ),
    );
    assert.deepEqual(overlap.map((tool) => tool.name), []);
  });

  /* --------------------------------------------------- the dangerous set */

  test("everything that sends, launches or spends is approval-gated", () => {
    // Named explicitly rather than derived, so removing the gate from one of
    // these fails here rather than quietly satisfying a generic rule.
    const mustBeGated = [
      "message.send",
      "campaign.launch",
      "agent.start",
      "agent.run_now",
      "connector.disconnect",
      "lead.archive",
    ];

    for (const name of mustBeGated) {
      const tool = EFFECTIVE.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} is missing from the catalogue`);
      assert.equal(
        tool!.kind,
        "APPROVAL_GATED",
        `${name} must park for a human, not execute`,
      );
    }
  });

  test("no read-scoped tool can write", () => {
    // The failure this prevents is the quiet one: a credential granted only
    // read access that can nevertheless change the workspace.
    for (const tool of EFFECTIVE) {
      if (tool.scope.endsWith(":read")) {
        assert.equal(
          tool.kind,
          "READ",
          `${tool.name} has a read scope but is not a read`,
        );
      }
    }
  });

  test("every write and gated tool needs at least member access", () => {
    for (const tool of EFFECTIVE) {
      if (tool.kind !== "READ") {
        assert.notEqual(
          tool.minimumRole,
          "viewer",
          `${tool.name} must not be available to a viewer`,
        );
      }
    }
  });

  test("the acts with lasting consequences require admin", () => {
    const adminOnly = [
      "campaign.launch",
      "agent.start",
      "agent.create",
      "agent.configure",
      "connector.disconnect",
      "ai_settings.update",
      "lead.archive",
    ];
    for (const name of adminOnly) {
      const tool = EFFECTIVE.find((candidate) => candidate.name === name);
      assert.ok(tool, `${name} is missing`);
      assert.ok(
        ["admin", "owner"].includes(tool!.minimumRole),
        `${name} must require admin, not ${tool!.minimumRole}`,
      );
    }
  });

  /* ---------------------------------------------------------- filtering */

  test("scope filtering hides tools a token was not granted", () => {
    const granted = new Set(["leads:read"]);
    const visible = EFFECTIVE.filter((tool) => granted.has(tool.scope));

    assert.ok(visible.length > 0, "a read token was offered nothing at all");
    for (const tool of visible) {
      assert.equal(tool.scope, "leads:read");
      assert.equal(tool.kind, "READ");
    }
    assert.equal(
      visible.some((tool) => tool.name === "create_lead"),
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
    assert.ok(write, "create_lead is the one legacy tool that should remain");

    assert.equal(roleAllows("viewer", write), false);
    assert.equal(roleAllows("member", write), true);
    assert.equal(roleAllows("admin", write), true);
    assert.equal(roleAllows("owner", write), true);
  });

  test("an unrecognised role is refused rather than defaulted", () => {
    const write = toolByName("create_lead")!;
    assert.equal(roleAllows("", write), false);
    assert.equal(roleAllows("superuser", write), false);
  });

  /* ------------------------------------------------------------ scopes */

  test("every scope has a description a person can consent to", () => {
    for (const scope of MCP_SCOPES) {
      const description = SCOPE_DESCRIPTIONS[scope];
      assert.ok(description && description.length > 10, `${scope} needs a description`);
      // The consent screen shows these; a scope named after a table would leak
      // the data model into an authorisation prompt.
      assert.equal(
        /table|row|column|sql/i.test(description),
        false,
        `${scope} description should describe capability, not storage`,
      );
    }
  });

  test("every scope in the catalogue is one a token can actually be granted", () => {
    for (const scope of new Set(EFFECTIVE.map((tool) => tool.scope))) {
      assert.ok(
        (MCP_SCOPES as readonly string[]).includes(scope),
        `${scope} is used by a tool but is not grantable`,
      );
    }
  });

  /* ------------------------------------------------------ context budget */

  test("the catalogue stays within a sane context budget", () => {
    // `tools/list` is sent to a model at the start of every session, so the
    // catalogue is a standing tax on every conversation a customer has. This is
    // not a correctness rule — it is the thing nobody notices until an
    // assistant spends a fifth of its context describing tools before it has
    // read a word the customer wrote.
    const payload = JSON.stringify(EFFECTIVE);
    const approxTokens = Math.round(payload.length / 4);

    assert.ok(
      approxTokens < 8000,
      `the catalogue is ~${approxTokens} tokens, too much to send every session`,
    );

    for (const tool of EFFECTIVE) {
      assert.ok(
        tool.description.length < 400,
        `${tool.name} has a ${tool.description.length}-character description; trim it`,
      );
    }
  });
});

/* ------------------------------------------------- the service-layer bridge */

describe("service operations exposed over MCP", () => {
  test("risk maps to the kind that keeps a human in the loop", () => {
    // The regression this catches: a destructive operation quietly arriving as
    // a plain WRITE, which would execute inline instead of parking for someone.
    assert.equal(mcpKindForRisk("READ"), "READ");
    assert.equal(mcpKindForRisk("SAFE_WRITE"), "WRITE");
    assert.equal(mcpKindForRisk("REVERSIBLE_WRITE"), "WRITE");

    for (const risk of [
      "EXTERNAL",
      "BULK_EXTERNAL",
      "FINANCIAL",
      "DESTRUCTIVE",
      "RESTRICTED",
    ] as const) {
      assert.equal(
        mcpKindForRisk(risk),
        "APPROVAL_GATED",
        `${risk} must park for a person, not execute`,
      );
    }
  });

  test("every MCP-reachable operation uses a scope MCP actually grants", () => {
    // Drift guard. An operation declaring a scope the MCP scope list does not
    // contain would be invisible to every token — listed by the registry,
    // grantable by nobody.
    for (const operation of operationsForCaller("MCP")) {
      assert.ok(
        (MCP_SCOPES as readonly string[]).includes(operation.scope),
        `${operation.name} uses scope "${operation.scope}", which MCP cannot grant`,
      );
    }
  });

  test("every grantable scope is described for the consent screen", () => {
    // A person approving a connection is agreeing to these words. A scope with
    // no description would be an unlabelled checkbox on a permission dialog.
    for (const scope of MCP_SCOPES) {
      assert.ok(
        SCOPE_DESCRIPTIONS[scope] && SCOPE_DESCRIPTIONS[scope].length > 10,
        `${scope} has no readable description`,
      );
    }
  });

  test("a write operation never sits behind a read scope", () => {
    for (const operation of operationsForCaller("MCP")) {
      if (mcpKindForRisk(operation.risk) !== "READ") {
        assert.ok(
          operation.scope.endsWith(":write") || operation.scope.endsWith(":run"),
          `${operation.name} writes but is gated by "${operation.scope}"`,
        );
      }
    }
  });
});
