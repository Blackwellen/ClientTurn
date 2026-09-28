import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  CAPABILITY_KEYS,
  canOverride,
  capabilityAllowed,
  choiceToValue,
  effectiveCapabilities,
  operationCapability,
  operationsWithCapabilities,
  overridesFromRow,
  permissionChangeProblem,
  roleDefault,
  valueToChoice,
} from "../src/lib/auth/capabilities.ts";
import { registryProblems, serviceOperation } from "../src/lib/services/registry.ts";
import { roleMeets, type BusinessRoleName } from "../src/lib/services/types.ts";

/**
 * Finer team permissions (0172). Pure rules only: no database, no network.
 */

const ROLES: BusinessRoleName[] = ["owner", "admin", "member", "viewer"];
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("role defaults preserve the behaviour before 0172", () => {
  test("outbound: member and up; integrations: admin and up; billing: owner only", () => {
    for (const role of ROLES) {
      assert.equal(roleDefault(role, "send_outbound"), roleMeets(role, "member"), role);
      assert.equal(roleDefault(role, "manage_integrations"), roleMeets(role, "admin"), role);
      assert.equal(roleDefault(role, "manage_billing"), role === "owner", role);
    }
  });

  test("with no overrides, every role-replacing operation gates exactly as its minimumRole", () => {
    for (const name of operationsWithCapabilities()) {
      const declaration = serviceOperation(name);
      assert.ok(declaration, `${name} is not a registered operation`);
      const gate = operationCapability(name)!;
      if (gate.mode !== "replaces_role") continue;
      for (const role of ROLES) {
        assert.equal(
          capabilityAllowed(role, gate.capability, {}),
          roleMeets(role, declaration!.minimumRole),
          `${name} for ${role}`,
        );
      }
    }
  });

  test("an empty or pre-migration row means role defaults", () => {
    assert.deepEqual(overridesFromRow(null), {});
    assert.deepEqual(effectiveCapabilities("member", overridesFromRow({})), {
      send_outbound: true,
      manage_integrations: false,
      manage_billing: false,
    });
  });
});

describe("overrides", () => {
  test("a member can be stopped from sending, or given integrations", () => {
    assert.equal(capabilityAllowed("member", "send_outbound", { send_outbound: false }), false);
    assert.equal(capabilityAllowed("member", "manage_integrations", { manage_integrations: true }), true);
  });

  test("billing can be delegated to an admin but never to a member", () => {
    assert.equal(capabilityAllowed("admin", "manage_billing", { manage_billing: true }), true);
    assert.equal(capabilityAllowed("member", "manage_billing", { manage_billing: true }), false);
  });

  test("the owner cannot lose anything and a viewer cannot gain anything", () => {
    for (const cap of CAPABILITY_KEYS) {
      assert.equal(capabilityAllowed("owner", cap, { [cap]: false }), true);
      assert.equal(capabilityAllowed("viewer", cap, { [cap]: true }), false);
      assert.equal(canOverride("owner", cap), false);
      assert.equal(canOverride("viewer", cap), false);
    }
  });

  test("an unknown role holds nothing", () => {
    for (const cap of CAPABILITY_KEYS) assert.equal(capabilityAllowed("superuser", cap, { [cap]: true }), false);
  });

  test("choice <-> stored value", () => {
    assert.equal(choiceToValue("default"), null);
    assert.equal(choiceToValue("allow"), true);
    assert.equal(choiceToValue("deny"), false);
    assert.equal(valueToChoice(null), "default");
    assert.equal(valueToChoice(true), "allow");
    assert.equal(valueToChoice(false), "deny");
  });
});

describe("who may change permissions", () => {
  const owner = { userId: "u-owner", role: "owner" };
  const admin = { userId: "u-admin", role: "admin" };
  const member = { userId: "u-member", role: "member" };
  const target = (role: string, userId = "u-target") => ({ userId, role, status: "active" });

  test("admins manage members; only the owner manages admins and billing", () => {
    assert.equal(permissionChangeProblem({ actor: admin, target: target("member"), capability: "send_outbound" }), null);
    assert.match(permissionChangeProblem({ actor: admin, target: target("admin"), capability: "send_outbound" })!, /owner/);
    assert.match(permissionChangeProblem({ actor: admin, target: target("member"), capability: "manage_billing" })!, /owner/);
    assert.equal(permissionChangeProblem({ actor: owner, target: target("admin"), capability: "manage_billing" }), null);
  });

  test("nobody edits themselves, the owner or a viewer; members edit nobody", () => {
    assert.match(permissionChangeProblem({ actor: owner, target: target("admin", "u-owner"), capability: "send_outbound" })!, /own/);
    assert.match(permissionChangeProblem({ actor: owner, target: target("owner"), capability: "send_outbound" })!, /owner always/);
    assert.match(permissionChangeProblem({ actor: owner, target: target("viewer"), capability: "send_outbound" })!, /read-only/);
    assert.match(permissionChangeProblem({ actor: member, target: target("member"), capability: "send_outbound" })!, /owner or admin/);
    assert.match(permissionChangeProblem({ actor: owner, target: target("member"), capability: "manage_billing" })!, /admin/);
  });
});

describe("enforcement is wired server-side", () => {
  test("member.set_permissions is declared, UI-only, admin minimum, and the catalogue stays well formed", () => {
    const op = serviceOperation("member.set_permissions");
    assert.ok(op);
    assert.equal(op!.minimumRole, "admin");
    assert.deepEqual(op!.callers, ["UI"]);
    assert.deepEqual(registryProblems(), []);
  });

  test("the service runtime consults per-person capabilities", () => {
    const runtime = read("src/lib/services/runtime.ts");
    assert.match(runtime, /operationCapability\(declaration\.name\)/);
    assert.match(runtime, /readCapabilityOverrides/);
  });

  test("outbound, integration and billing actions check the capability", () => {
    const expectations: [string, RegExp][] = [
      ["src/lib/leads/actions.ts", /workspaceCan\(workspace, "send_outbound"\)/],
      ["src/lib/agent/actions.ts", /workspaceCan\(workspace, "send_outbound"\)/],
      ["src/lib/campaigns/actions.ts", /workspaceCan\(workspace, "send_outbound"\)/],
      ["src/lib/outreach/actions.ts", /"send_outbound"/],
      ["src/lib/outreach/campaign-actions.ts", /"send_outbound"/],
      ["src/lib/integrations/app-actions.ts", /requireCapability\("manage_integrations"\)/],
      ["src/lib/integrations/connection-actions.ts", /requireCapability\("manage_integrations"\)/],
      ["src/app/api/integrations/[provider]/connect/route.ts", /requireCapability\("manage_integrations"\)/],
      ["src/lib/email/actions.ts", /requireCapability\("manage_integrations"\)/],
      ["src/lib/billing/checkout-actions.ts", /requireCapability\("manage_billing"\)/],
      ["src/lib/billing/voice-actions.ts", /requireCapability\("manage_billing"\)/],
      ["src/lib/settings/actions.ts", /requireCapability\("manage_billing"\)/],
      ["src/app/api/billing/portal/route.ts", /workspaceCan\(workspace, "manage_billing"\)/],
    ];
    for (const [file, pattern] of expectations) assert.match(read(file), pattern, file);
    for (const file of ["src/lib/billing/checkout-actions.ts", "src/lib/billing/voice-actions.ts", "src/lib/billing/token-actions.ts"]) {
      assert.doesNotMatch(read(file), /requireRole\("owner"\)/, `${file} still gates on the owner role`);
    }
  });

  test("migration 0172 keeps overrides null by default and clears them on a role change", () => {
    const sql = read("supabase/migrations/0172_enterprise_roles_audit_export.sql");
    assert.match(sql, /add column if not exists can_send_outbound boolean,/);
    assert.doesNotMatch(sql, /can_send_outbound boolean (not null|default)/);
    assert.match(sql, /before update of role on public\.business_members/);
    assert.match(sql, /role not in \('owner', 'viewer'\)/);
  });
});
