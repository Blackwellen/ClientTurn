import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  appendDisclosure,
  emailDisclosureDue,
  planSocialDisclosure,
} from "../src/lib/compliance/source-disclosure.ts";
import { ipAllowed, ipv6ToBigInt, isAllowedIpEntry } from "../src/lib/api-keys/types.ts";
import { routedFromMarker, routingTargets } from "../src/lib/data-rights/types.ts";
import { boundKeyAllowed, mcpKeyName, mcpKeyTag, mcpServerUrl } from "../src/lib/mcp/connection-key.ts";
import { MCP_DOC_END, MCP_DOC_START, mcpToolRows, mcpToolsDocBlock } from "../src/lib/mcp/tool-docs.ts";
import { deliveryStatusLabel, WEBHOOK_EVENTS, WEBHOOK_RETRY_BACKOFF_SECONDS } from "../src/lib/webhooks/events.ts";
import { PLATFORM_SCOPES } from "../src/lib/platform/scopes.ts";
import { referralEvidenceSufficient, REFERRAL_EVIDENCE_MIN } from "../src/lib/policy/types.ts";
import { MAX_INVITE_NOTE_CHARS } from "../src/lib/outreach/social-limits.ts";

/**
 * Developer-platform and compliance fixes (tracker 8.24).
 */

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

/* ------------------------------------------------ Article 14 disclosure */

describe("social Article 14 disclosure", () => {
  const base = {
    legalName: "Acme Ltd",
    privacyPolicyUrl: "https://acme.example/privacy",
    isFirstContact: true,
    personInitiated: false,
  };

  test("a first message about third-party data carries the source", () => {
    const plan = planSocialDisclosure({ ...base, provenanceTypes: ["LICENSED_PROVIDER"] });
    assert.equal(plan.kind, "APPEND");
    assert.match(plan.kind === "APPEND" ? plan.line : "", /business contact data provider/);
    assert.match(plan.kind === "APPEND" ? plan.line : "", /acme\.example\/privacy/);
  });

  test("details the person gave us owe nothing (a commenter on our own post)", () => {
    assert.deepEqual(planSocialDisclosure({ ...base, provenanceTypes: ["FIRST_PARTY"] }), { kind: "NONE" });
  });

  test("mixed provenance names the third-party source, not the reassuring one", () => {
    const plan = planSocialDisclosure({ ...base, provenanceTypes: ["FIRST_PARTY", "WEBSITE"] });
    assert.equal(plan.kind, "APPEND");
    assert.match(plan.kind === "APPEND" ? plan.line : "", /website/);
  });

  test("not a first contact, or they started it: nothing owed", () => {
    assert.equal(planSocialDisclosure({ ...base, isFirstContact: false, provenanceTypes: ["WEBSITE"] }).kind, "NONE");
    assert.equal(planSocialDisclosure({ ...base, personInitiated: true, provenanceTypes: ["WEBSITE"] }).kind, "NONE");
  });

  test("owed but not buildable parks the message, with the reason", () => {
    const noUrl = planSocialDisclosure({ ...base, privacyPolicyUrl: null, provenanceTypes: ["WEBSITE"] });
    assert.equal(noUrl.kind, "PARK");
    assert.match(noUrl.kind === "PARK" ? noUrl.gap : "", /privacy notice/i);
    // Nothing recorded is never read as "the person gave it to us".
    assert.equal(planSocialDisclosure({ ...base, provenanceTypes: [] }).kind, "PARK");
  });

  test("the disclosure is never the part cut to fit an invitation note", () => {
    const line = "I found your details via your company's own website. What we hold and how to opt out: https://acme.example/privacy";
    const body = "Hi Sam, ".repeat(60);
    const note = appendDisclosure(body, line, MAX_INVITE_NOTE_CHARS);
    assert.ok(note.length <= MAX_INVITE_NOTE_CHARS);
    assert.ok(note.endsWith(line));
  });

  test("the scheduler and private replies apply it before composing or claiming", () => {
    const scheduler = read("src", "lib", "outreach", "social-scheduler.ts");
    const planAt = scheduler.indexOf("loadSocialDisclosurePlan({");
    const composeAt = scheduler.indexOf("await composeSocialMessage(");
    assert.ok(planAt > -1 && planAt < composeAt, "disclosure must be planned before composing");
    const replies = read("src", "lib", "social", "private-replies.ts");
    const claimAt = replies.indexOf("update({ private_reply_sent_at: now.toISOString() })");
    assert.ok(claimAt > -1, "the claim moved");
    assert.ok(
      replies.indexOf("loadSocialDisclosurePlan(") < claimAt,
      "disclosure must be planned before the one reply is claimed",
    );
  });
});

describe("email Article 14 disclosure: first cold step only", () => {
  test("due on the first delivered step, not on follow-ups", () => {
    assert.equal(emailDisclosureDue(0), true);
    assert.equal(emailDisclosureDue(1), false);
    assert.equal(emailDisclosureDue(3), false);
  });
  test("the dispatcher gates the lookup on it, and releases a held step", () => {
    const dispatch = read("src", "lib", "outreach", "dispatch.ts");
    assert.match(dispatch, /emailDisclosureDue\(run\.steps_sent \?\? 0\)/);
    assert.match(dispatch, /if \(disclosure\.blocked\) \{[\s\S]{0,400}releaseStep\(/);
  });
});

/* ---------------------------------------------------------- IPv6 CIDR */

describe("IPv6 allowlist entries match", () => {
  test("CIDR blocks include their range and exclude the next", () => {
    assert.equal(ipAllowed("2001:db8::1", ["2001:db8::/32"]), true);
    assert.equal(ipAllowed("2001:db8:ffff:ffff::1", ["2001:db8::/32"]), true);
    assert.equal(ipAllowed("2001:db9::1", ["2001:db8::/32"]), false);
    assert.equal(ipAllowed("2a00:1450:4009:81f::200e", ["2a00:1450:4009::/48"]), true);
    assert.equal(ipAllowed("2a00:1450:400a::1", ["2a00:1450:4009::/48"]), false);
  });
  test("exact entries compare as addresses, not strings", () => {
    assert.equal(ipAllowed("2001:DB8:0:0::1", ["2001:db8::1"]), true);
    assert.equal(ipAllowed("2001:db8::1", ["2001:db8::1/128"]), true);
    assert.equal(ipAllowed("2001:db8::2", ["2001:db8::1/128"]), false);
    assert.equal(ipAllowed("::1", ["::/0"]), true);
  });
  test("an IPv4 client seen through an IPv6 socket matches its IPv4 rule", () => {
    assert.equal(ipAllowed("::ffff:203.0.113.4", ["203.0.113.0/24"]), true);
    assert.equal(ipAllowed("::ffff:198.51.100.4", ["203.0.113.0/24"]), false);
  });
  test("families never cross-match, and garbage never matches", () => {
    assert.equal(ipAllowed("203.0.113.4", ["2001:db8::/32"]), false);
    assert.equal(ipAllowed("2001:db8::1", ["0.0.0.0/0"]), false);
    assert.equal(ipAllowed("2001:db8::1", ["2001:db8::/33x"]), false);
    assert.equal(ipAllowed("zzzz::1", ["::/0"]), false);
  });
  test("the parser follows RFC 4291 text forms", () => {
    assert.equal(ipv6ToBigInt("::"), BigInt(0));
    assert.equal(ipv6ToBigInt("::1"), BigInt(1));
    assert.equal(ipv6ToBigInt("fe80::1%eth0"), ipv6ToBigInt("fe80::1"));
    assert.equal(ipv6ToBigInt("1:2:3:4:5:6:7:8:9"), null);
    assert.equal(ipv6ToBigInt("1::2::3"), null);
    assert.equal(ipv6ToBigInt("12345::"), null);
  });
  test("the form refuses a malformed IPv6 entry instead of accepting one that never matches", () => {
    assert.equal(isAllowedIpEntry("2001:db8::/32"), true);
    assert.equal(isAllowedIpEntry("2001:db8::/129"), false);
    assert.equal(isAllowedIpEntry("::::"), false);
  });
});

/* --------------------------------------------- public privacy requests */

describe("verified public privacy requests reach the workspaces that hold the person", () => {
  test("one target per workspace; an email match outranks a phone claim", () => {
    const targets = routingTargets([
      { businessId: "b2", via: "PHONE", leadId: "l3" },
      { businessId: "b1", via: "EMAIL", leadId: "l1" },
      { businessId: "b1", via: "EMAIL", leadId: null },
      { businessId: "b2", via: "EMAIL", leadId: null },
      { businessId: "b3", via: "PHONE", leadId: "l4" },
    ]);
    assert.deepEqual(targets, [
      { businessId: "b1", emailMatched: true, leadId: "l1" },
      { businessId: "b2", emailMatched: true, leadId: "l3" },
      { businessId: "b3", emailMatched: false, leadId: "l4" },
    ]);
  });
  test("two matching leads in one workspace link neither", () => {
    const [target] = routingTargets([
      { businessId: "b1", via: "EMAIL", leadId: "l1" },
      { businessId: "b1", via: "EMAIL", leadId: "l2" },
    ]);
    assert.equal(target.leadId, null);
  });
  test("verification routes, and each copy is linked back and notified", () => {
    assert.equal(routedFromMarker("DSR-1001"), "Routed from ClientTurn public request DSR-1001");
    const source = read("src", "lib", "data-rights", "privacy-requests.ts");
    assert.match(source, /await routeVerifiedPublicRequest\(row\.id\)/);
    assert.match(source, /received_at: parent\.received_at/);
    assert.match(source, /queueNotification\(/);
  });
});

/* ------------------------------------------------------------ copy */

test("the unsubscribe page does not claim STOP stops everything", () => {
  const page = read("src", "app", "unsubscribe", "[token]", "page.tsx");
  assert.doesNotMatch(page, /also stops all further\s+messages/);
  assert.match(page, /stops their text messages only/);
});

/* ------------------------------------------------ MCP connection key */

describe("an MCP connection issues a credential MCP clients can use", () => {
  test("the key name carries the binding tag and fits the column", () => {
    const id = "0f8b6f2e-8f7d-4f7e-9d7a-1a2b3c4d5e6f";
    const name = mcpKeyName("A very long assistant connection name that keeps going and going", id);
    assert.ok(name.length <= 80);
    assert.ok(name.endsWith(mcpKeyTag(id)));
    assert.equal(mcpKeyName("Claude", id), `Claude (MCP) [mcp:${id}]`);
  });
  test("a key bound to a revoked connection is refused; an unbound key is not affected", () => {
    assert.equal(boundKeyAllowed(undefined), true);
    assert.equal(boundKeyAllowed("ACTIVE"), true);
    assert.equal(boundKeyAllowed("REVOKED"), false);
    assert.equal(boundKeyAllowed("SUSPENDED"), false);
    assert.equal(boundKeyAllowed(null), false);
  });
  test("the dialog shows the server URL, and nothing returns the client secret", () => {
    assert.equal(mcpServerUrl("https://app.example.com/"), "https://app.example.com/api/mcp");
    const actions = read("src", "lib", "mcp", "actions.ts");
    assert.doesNotMatch(actions, /clientSecret/);
    assert.match(actions, /issueConnectionKey/);
    // The Settings route is one page with ?section=; the old path refreshed nothing.
    assert.doesNotMatch(actions, /revalidatePath\("\/app\/settings\/connections"\)/);
    const provisioning = read("src", "lib", "mcp", "provisioning.ts");
    assert.match(provisioning, /await revokeConnectionKeys\(input\)/);
    const gateway = read("src", "lib", "mcp", "gateway.ts");
    assert.match(gateway, /boundKeyAllowed\(binding\.status\)/);
  });
  test("migration 0133 binds keys to connections", () => {
    const sql = read("supabase", "migrations", "0133_connections_developer_fixes.sql");
    assert.match(sql, /add column if not exists mcp_client_id uuid/);
    assert.match(sql, /references public\.mcp_clients\(id\) on delete set null/);
  });
});

/* ------------------------------------------------------ API contract */

describe("the API contract matches the code", () => {
  test("GET /api/v1 lists POST /api/v1/leads", () => {
    const index = read("src", "app", "api", "v1", "route.ts");
    assert.match(index, /method: "POST",\s*path: "\/api\/v1\/leads"/);
    assert.match(read("src", "app", "(marketing)", "developers", "page.tsx"), /method: "POST",\s*path: "\/api\/v1\/leads"/);
  });

  test("the docs state the real numbers", () => {
    const docs = read("docs", "DEVELOPER_PLATFORM.md");
    assert.equal(PLATFORM_SCOPES.length, 11);
    assert.match(docs, /eleven of them/);
    const attempts = WEBHOOK_RETRY_BACKOFF_SECONDS.length + 1;
    const hours = WEBHOOK_RETRY_BACKOFF_SECONDS.reduce((sum, s) => sum + s, 0) / 3600;
    assert.equal(attempts, 7);
    assert.equal(hours.toFixed(1), "22.6");
    assert.match(docs, /seven attempts in all/);
    assert.match(docs, /22\.6 hours/);
  });

  test("the MCP tool table in the docs is the one the registry generates", () => {
    const docs = read("docs", "DEVELOPER_PLATFORM.md");
    const start = docs.indexOf(MCP_DOC_START);
    const end = docs.indexOf(MCP_DOC_END);
    assert.ok(start > -1 && end > start, "the generated block markers are missing");
    assert.equal(
      docs.slice(start, end + MCP_DOC_END.length).replace(/\r\n/g, "\n"),
      mcpToolsDocBlock(),
      "docs/DEVELOPER_PLATFORM.md is stale: run node scripts/generate-mcp-tools-doc.mjs",
    );
    assert.ok(mcpToolRows().length > 42);
  });

  test("a retrying delivery says Retrying", () => {
    assert.equal(deliveryStatusLabel({ status: "PENDING", attempts: 0 }), "Queued");
    assert.equal(deliveryStatusLabel({ status: "PENDING", attempts: 2 }), "Retrying");
    assert.equal(deliveryStatusLabel({ status: "EXHAUSTED", attempts: 7 }), "Gave up");
  });

  test("opportunity events are subscribable and forwarded", () => {
    const types = WEBHOOK_EVENTS.map((event) => event.type as string);
    for (const type of ["opportunity.created", "opportunity.won", "opportunity.lost"]) {
      assert.ok(types.includes(type), `${type} is not subscribable`);
    }
    const outbox = read("src", "lib", "events", "outbox.ts");
    const forwarded = outbox.slice(outbox.indexOf("export const WEBHOOK_FORWARDED"));
    assert.match(forwarded, /"opportunity\.won"/);
  });

  test("REFERRAL needs evidence on every path", () => {
    assert.equal(referralEvidenceSufficient("Referred by Pat Lee at Acme, 3 Sep"), true);
    assert.equal(referralEvidenceSufficient("friend"), false);
    assert.equal(referralEvidenceSufficient(null), false);
    assert.equal(REFERRAL_EVIDENCE_MIN, 20);
    assert.match(read("src", "lib", "services", "operations", "leads.ts"), /args\.relationship === "REFERRAL" && !referralEvidenceSufficient/);
    assert.match(read("src", "lib", "mcp", "handlers.ts"), /relationship === "REFERRAL"[\s\S]{0,120}referralEvidenceSufficient/);
  });

  test("the API refuses a suppressed contact with REJECTED", () => {
    const leads = read("src", "lib", "services", "operations", "leads.ts");
    const create = leads.slice(leads.indexOf('defineOperation("lead.create"'));
    assert.match(create, /onSuppressed: "REFUSE"/);
  });

  test("lead.get returns recent activity, as the registry promises", () => {
    const leads = read("src", "lib", "services", "operations", "leads.ts");
    const get = leads.slice(leads.indexOf('defineOperation("lead.get"'), leads.indexOf('defineOperation("lead.search"'));
    assert.match(get, /recent_activity/);
    assert.match(read("src", "app", "api", "v1", "leads", "[id]", "route.ts"), /recent_activity/);
  });
});
