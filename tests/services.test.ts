import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_OPERATIONS,
  serviceOperation,
  operationsForCaller,
  operationsForScopes,
  operationsInDomain,
  declaredScopes,
  registryProblems,
} from "../src/lib/services/registry.ts";
import {
  callerAllowed,
  declarationProblems,
  isRetryable,
  isWrite,
  requiresConfirmation,
  riskRank,
  roleMeets,
  type RiskClass,
  type ServiceDeclaration,
} from "../src/lib/services/types.ts";

/**
 * The service layer is the thing every other caller is about to be rebuilt on
 * top of, so its contract is asserted directly rather than only through the
 * callers. A permission model that is only exercised via Copilot is a permission
 * model nobody can reason about when an MCP client hits it instead.
 */

/* ------------------------------------------------------------- the registry */

describe("the operation catalogue", () => {
  test("every declaration is structurally sound", () => {
    assert.deepEqual(registryProblems(), []);
  });

  test("operation names are unique", () => {
    const names = ALL_OPERATIONS.map((op) => op.name);
    assert.equal(new Set(names).size, names.length);
  });

  test("a name is always <domain>.<verb> and matches its domain", () => {
    for (const op of ALL_OPERATIONS) {
      assert.match(op.name, /^[a-z_]+\.[a-z_]+$/, `${op.name} is not <domain>.<verb>`);
      assert.ok(op.name.startsWith(`${op.domain}.`));
    }
  });

  test("no viewer can reach a write", () => {
    for (const op of ALL_OPERATIONS) {
      if (isWrite(op.risk)) {
        assert.notEqual(op.minimumRole, "viewer", `${op.name} lets a viewer write`);
      }
    }
  });

  test("anything needing confirmation says what is being confirmed", () => {
    for (const op of ALL_OPERATIONS) {
      if (requiresConfirmation(op.risk)) {
        assert.ok(op.effect, `${op.name} needs confirmation but has no effect text`);
      }
    }
  });

  test("a destructive operation is never available to an autonomous agent", () => {
    // An agent runs without anyone watching, and cannot set `confirmed`. An
    // agent-reachable destructive operation would be one nobody agreed to.
    for (const op of ALL_OPERATIONS) {
      if (op.risk === "DESTRUCTIVE" || op.risk === "RESTRICTED") {
        assert.equal(
          callerAllowed(op, "AGENT"),
          false,
          `${op.name} is ${op.risk} and reachable by an agent`,
        );
      }
    }
  });

  test("an unknown operation resolves to nothing", () => {
    assert.equal(serviceOperation("lead.obliterate"), undefined);
    assert.equal(serviceOperation(""), undefined);
  });

  test("scope filtering only returns what the scope admits", () => {
    const readOnly = operationsForScopes(["leads:read"]);
    assert.ok(readOnly.length > 0);
    for (const op of readOnly) assert.equal(op.scope, "leads:read");
    // The point of the filter: a read-only grant cannot see a write exists.
    assert.equal(
      readOnly.some((op) => isWrite(op.risk)),
      false,
    );
  });

  test("an empty scope grant admits nothing", () => {
    assert.deepEqual(operationsForScopes([]), []);
  });

  test("caller filtering excludes operations closed to that caller", () => {
    const forAgent = operationsForCaller("AGENT").map((op) => op.name);
    assert.equal(forAgent.includes("lead.archive"), false);
    assert.equal(forAgent.includes("lead.get"), true);

    const forUi = operationsForCaller("UI").map((op) => op.name);
    assert.equal(forUi.includes("lead.archive"), true);
  });

  test("declared scopes are derived, not maintained separately", () => {
    const scopes = declaredScopes();
    assert.deepEqual(scopes, [...scopes].sort());
    for (const op of ALL_OPERATIONS) assert.ok(scopes.includes(op.scope));
  });

  test("the lead domain is complete enough to be useful", () => {
    const names: string[] = operationsInDomain("lead").map((op) => op.name);
    for (const required of [
      "lead.get",
      "lead.search",
      "lead.update",
      "lead.assign",
      "lead.set_status",
      "lead.add_note",
      "lead.archive",
      "lead.restore",
    ]) {
      assert.ok(names.includes(required), `${required} is missing`);
    }
  });
});

/* ---------------------------------------------------------------- the risks */

describe("the risk model", () => {
  test("reads and safe writes run without a confirmation", () => {
    assert.equal(requiresConfirmation("READ"), false);
    assert.equal(requiresConfirmation("SAFE_WRITE"), false);
    assert.equal(requiresConfirmation("REVERSIBLE_WRITE"), false);
  });

  test("everything that leaves the building or cannot be undone is gated", () => {
    for (const risk of [
      "EXTERNAL",
      "BULK_EXTERNAL",
      "FINANCIAL",
      "DESTRUCTIVE",
      "RESTRICTED",
    ] as RiskClass[]) {
      assert.equal(requiresConfirmation(risk), true, `${risk} is not gated`);
    }
  });

  test("only READ is not a write", () => {
    assert.equal(isWrite("READ"), false);
    assert.equal(isWrite("SAFE_WRITE"), true);
    assert.equal(isWrite("DESTRUCTIVE"), true);
  });

  test("risk is ordered from least to most consequential", () => {
    assert.ok(riskRank("READ") < riskRank("SAFE_WRITE"));
    assert.ok(riskRank("REVERSIBLE_WRITE") < riskRank("EXTERNAL"));
    assert.ok(riskRank("EXTERNAL") < riskRank("DESTRUCTIVE"));
  });
});

/* ----------------------------------------------------------------- the roles */

describe("role checks", () => {
  test("a role satisfies itself and everything below it", () => {
    assert.equal(roleMeets("owner", "admin"), true);
    assert.equal(roleMeets("admin", "admin"), true);
    assert.equal(roleMeets("member", "member"), true);
    assert.equal(roleMeets("viewer", "viewer"), true);
  });

  test("a role never satisfies one above it", () => {
    assert.equal(roleMeets("member", "admin"), false);
    assert.equal(roleMeets("viewer", "member"), false);
    assert.equal(roleMeets("admin", "owner"), false);
  });

  test("an unrecognised role satisfies nothing", () => {
    // The failure mode this prevents: a role string arriving from somewhere
    // unexpected and being treated as permissive by accident.
    assert.equal(roleMeets("superuser", "viewer"), false);
    assert.equal(roleMeets("", "viewer"), false);
  });
});

/* ------------------------------------------------------- declaration checks */

describe("declaration validation", () => {
  const base: ServiceDeclaration = {
    name: "thing.do",
    domain: "thing",
    risk: "SAFE_WRITE",
    minimumRole: "member",
    scope: "things:write",
    summary: "Do the thing",
    entityType: "thing",
  };

  test("a sound declaration has no problems", () => {
    assert.deepEqual(declarationProblems(base), []);
  });

  test("a name that does not match its domain is caught", () => {
    const problems = declarationProblems({ ...base, name: "other.do" });
    assert.ok(problems.some((p) => p.includes("does not match domain")));
  });

  test("a name without a verb is caught", () => {
    const problems = declarationProblems({ ...base, name: "thing", domain: "thing" });
    assert.ok(problems.some((p) => p.includes("<domain>.<verb>")));
  });

  test("a gated operation with no effect text is caught", () => {
    const problems = declarationProblems({ ...base, risk: "DESTRUCTIVE" });
    assert.ok(problems.some((p) => p.includes("effect")));
  });

  test("a write a viewer could perform is caught", () => {
    const problems = declarationProblems({ ...base, minimumRole: "viewer" });
    assert.ok(problems.some((p) => p.includes("viewer must not be able to write")));
  });
});

/* ------------------------------------------------------------ error handling */

describe("failure classification", () => {
  test("only genuinely transient failures are retryable", () => {
    assert.equal(isRetryable("PROVIDER_FAILED"), true);
    assert.equal(isRetryable("UNAVAILABLE"), true);
  });

  test("a refusal is never retried", () => {
    // Retrying these would re-ask a question already answered, and would put a
    // second denial in the audit trail for the same attempt.
    for (const code of [
      "FORBIDDEN_ROLE",
      "FORBIDDEN_SCOPE",
      "NOT_FOUND",
      "INVALID_INPUT",
      "NEEDS_CONFIRMATION",
      "POLICY_BLOCKED",
      "PLAN_LIMIT",
      "CONFLICT",
    ] as const) {
      assert.equal(isRetryable(code), false, `${code} should not be retryable`);
    }
  });
});
