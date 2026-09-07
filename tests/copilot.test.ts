import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  COPILOT_TOOLS,
  copilotTool,
  fromFunctionName,
  roleAllows,
  toFunctionName,
} from "../src/lib/copilot/types.ts";
import { operationsForCaller } from "../src/lib/services/registry.ts";
import { requiresConfirmation, isWrite } from "../src/lib/services/types.ts";

/**
 * Copilot's tool surface is a permission boundary that a language model is
 * pointed at, so these tests are written from the direction that matters:
 * proving the dangerous things stay hard to reach, and that the catalogue the
 * model is shown cannot drift from the one the runtime enforces.
 */

describe("the Copilot tool catalogue", () => {
  test("every service operation available to Copilot is offered as a tool", () => {
    // The drift this catches: an operation added to the registry but invisible
    // to Copilot, so a capability exists for MCP and not for the customer's own
    // assistant — or the reverse.
    const offered = new Set(COPILOT_TOOLS.map((tool) => tool.name));
    for (const operation of operationsForCaller("COPILOT")) {
      assert.ok(
        offered.has(operation.name),
        `${operation.name} is available to Copilot but not in its catalogue`,
      );
    }
  });

  test("a derived tool's kind and confirmation match its risk class", () => {
    for (const operation of operationsForCaller("COPILOT")) {
      const tool = copilotTool(operation.name);
      assert.ok(tool, `${operation.name} is missing`);
      if (!tool) continue;

      assert.equal(
        tool.kind,
        isWrite(operation.risk) ? "WRITE" : "READ",
        `${operation.name} is described with the wrong kind`,
      );
      assert.equal(
        tool.requiresConfirmation,
        requiresConfirmation(operation.risk),
        `${operation.name} does not demand confirmation consistently with its risk`,
      );
    }
  });

  /**
   * A viewer may write exactly one thing: a support ticket.
   *
   * That is deliberate and not an oversight — raising a ticket changes no
   * workspace data, and a read-only member who cannot report a problem is a
   * worse product. The exception is named here so that a *second* one has to be
   * argued for rather than merely added.
   */
  const VIEWER_WRITABLE = new Set(["createSupportTicket"]);

  test("no tool lets a viewer change workspace data", () => {
    for (const tool of COPILOT_TOOLS) {
      if (tool.kind === "WRITE" && !VIEWER_WRITABLE.has(tool.name)) {
        assert.notEqual(tool.scope, "viewer", `${tool.name} lets a viewer write`);
      }
    }
  });

  test("anything requiring confirmation says what is being confirmed", () => {
    // The dialog this drives has a body. A confirmation with nothing to read is
    // a person clicking yes to an unstated question.
    for (const tool of COPILOT_TOOLS) {
      if (tool.requiresConfirmation) {
        assert.ok(
          tool.effect && tool.effect.length > 20,
          `${tool.name} asks for confirmation but does not say what happens`,
        );
      }
    }
  });

  test("tool names are unique", () => {
    const names = COPILOT_TOOLS.map((tool) => tool.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("no tool can send outreach, move money or alter a suppression", () => {
    // Copilot's authority is bounded by what exists, not by what it is asked to
    // avoid. These names must not appear at all.
    const forbidden = /send|outreach|suppress|overage|budget|charge|refund|delete/i;
    for (const tool of COPILOT_TOOLS) {
      assert.equal(
        forbidden.test(tool.name),
        false,
        `${tool.name} names an authority Copilot must not hold`,
      );
    }
  });

  test("every tool has a summary a person could read in a list", () => {
    for (const tool of COPILOT_TOOLS) {
      assert.ok(tool.summary.length > 5, `${tool.name} has no usable summary`);
      assert.equal(
        tool.summary.endsWith("."),
        false,
        `${tool.name}'s summary is a label, not a sentence`,
      );
    }
  });
});

/* ------------------------------------------------------------ name mapping */

describe("tool names as the model sees them", () => {
  test("every tool name survives the round trip", () => {
    // A lossy encoding would make some tools simply unreachable: the model
    // would call a name that no longer maps back to an operation.
    for (const tool of COPILOT_TOOLS) {
      assert.equal(fromFunctionName(toFunctionName(tool.name)), tool.name);
    }
  });

  test("encoded names are acceptable to the provider", () => {
    for (const tool of COPILOT_TOOLS) {
      assert.match(
        toFunctionName(tool.name),
        /^[a-zA-Z0-9_-]+$/,
        `${tool.name} encodes to a name the provider would reject`,
      );
    }
  });

  test("a dotted operation name encodes and decodes", () => {
    assert.equal(toFunctionName("lead.archive"), "lead__archive");
    assert.equal(fromFunctionName("lead__archive"), "lead.archive");
  });

  test("an undotted legacy name is unchanged", () => {
    assert.equal(toFunctionName("getAnalytics"), "getAnalytics");
    assert.equal(fromFunctionName("getAnalytics"), "getAnalytics");
  });
});

/* -------------------------------------------------------------------- roles */

describe("Copilot role gating", () => {
  test("a role reaches its own tools and everything below", () => {
    assert.equal(roleAllows("admin", "member"), true);
    assert.equal(roleAllows("owner", "admin"), true);
    assert.equal(roleAllows("member", "member"), true);
  });

  test("a role never reaches above itself", () => {
    assert.equal(roleAllows("member", "admin"), false);
    assert.equal(roleAllows("viewer", "member"), false);
  });

  test("an unrecognised role reaches nothing", () => {
    assert.equal(roleAllows("root", "viewer"), false);
    assert.equal(roleAllows("", "viewer"), false);
  });

  test("a viewer is offered reads, and nothing that touches their data", () => {
    const forViewer = COPILOT_TOOLS.filter((tool) => roleAllows("viewer", tool.scope));
    assert.ok(forViewer.length > 0);
    for (const tool of forViewer) {
      if (tool.name === "createSupportTicket") continue; // see VIEWER_WRITABLE
      assert.equal(tool.kind, "READ", `${tool.name} is offered to a viewer as a write`);
    }
  });
});
