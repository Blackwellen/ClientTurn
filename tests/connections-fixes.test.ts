import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PROVIDERS,
  connectResultMessage,
  googleAdsWebhookUrl,
  metaTokenRenewal,
  oauthLandingPath,
  safeOAuthReturnPath,
  workspaceProviderBlock,
  AVAILABILITY_META,
} from "../src/lib/integrations/catalog.ts";
import { HUBSPOT_REQUIRED_SCOPES, HUBSPOT_SCOPE_HELP } from "../src/lib/integrations/connector-copy.ts";
import { linkedinScopes, organizationsFromAcls } from "../src/lib/integrations/linkedin-orgs.ts";
import { connectorCompany } from "../src/lib/integrations/connector-company.ts";
import { crmCompanyField, existingCrmRecordId } from "../src/lib/integrations/crm-pull/plan.ts";
import {
  DEFAULT_SOCIAL_LIMITS,
  SOCIAL_ACCOUNT_TIER_OPTIONS,
  recordActionForDraft,
  tiersForPlatform,
} from "../src/lib/outreach/social-limits.ts";
import {
  bestLinkedInTier,
  computeInMailBalance,
  inMailRulesForTier,
  tierHasInMail,
} from "../src/lib/outreach/inmail-credits.ts";
import { DEFAULT_SEQUENCE_SETTINGS, sequenceSettingsFromRow } from "../src/lib/outreach/social-sequence.ts";
import {
  TIMEZONES,
  isPublicPricing,
  isTimezone,
  normalisePublicPrice,
  timezoneLabel,
} from "../src/lib/settings/types.ts";
import { promotionBlockedReason } from "../src/lib/prospects/types.ts";

/**
 * Connections and lead-source fixes (tracker 8.23 and the lead-source half of
 * 8.24). Pure functions first; a few structural assertions read source where
 * the fix is wiring rather than logic.
 */

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");

describe("WhatsApp (direct) can be connected", () => {
  test("it has a connect path, so the card offers Connect once configured", () => {
    const whatsapp = PROVIDERS.find((provider) => provider.id === "whatsapp_cloud")!;
    assert.equal(whatsapp.connectPath, "/api/integrations/whatsapp_cloud/connect");
    assert.equal(workspaceProviderBlock(whatsapp, { configured: true, connected: false }), null);
    // Without the Embedded Signup config the platform is not configured and says so.
    assert.equal(
      workspaceProviderBlock(whatsapp, { configured: false, connected: false })?.kind,
      "unavailable",
    );
  });
});

describe("the OAuth round trip is announced", () => {
  test("success names the provider; failure says nothing was connected", () => {
    const ok = connectResultMessage({ connected: "hubspot", connect: null });
    assert.equal(ok?.variant, "success");
    assert.match(ok!.title, /HubSpot connected/);
    const leads = connectResultMessage({ connected: "meta", connect: null });
    assert.match(leads!.description, /leads/i);
    const failed = connectResultMessage({ connected: null, connect: "failed" });
    assert.equal(failed?.variant, "error");
    assert.equal(connectResultMessage({ connected: null, connect: null }), null);
  });

  test("the Connections section mounts the toast reader", () => {
    const section = read("src", "app", "(app)", "app", "settings", "_sections", "connections-section.tsx");
    assert.match(section, /<ConnectResultToast \/>/);
  });

  test("only allowlisted return paths are honoured (no open redirect)", () => {
    assert.equal(safeOAuthReturnPath("/onboarding"), "/onboarding");
    assert.equal(safeOAuthReturnPath("https://evil.example"), null);
    assert.equal(safeOAuthReturnPath("//evil.example"), null);
    assert.equal(safeOAuthReturnPath("/app/settings"), null);
    assert.equal(
      oauthLandingPath({ returnPath: null, provider: "meta", ok: true }),
      "/app/settings?section=connections&connected=meta",
    );
    assert.equal(
      oauthLandingPath({ returnPath: "/onboarding", provider: "meta", ok: false }),
      "/onboarding?connect=failed",
    );
  });
});

describe("Google Ads webhook and account choice", () => {
  test("the webhook URL carries the integration id", () => {
    assert.equal(
      googleAdsWebhookUrl("https://app.example.com/", "abc-123"),
      "https://app.example.com/api/webhooks/google-ads?integration=abc-123",
    );
  });

  test("the key is read server-side for admins only", () => {
    const extras = read("src", "lib", "integrations", "extras.ts");
    assert.match(extras, /if \(input\.canManage\)[\s\S]{0,200}webhook_secret/);
  });

  test("identify keeps every accessible account, not just the first", () => {
    const source = read("src", "lib", "integrations", "providers", "google-ads.ts");
    assert.match(source, /accessibleCustomerIds: accessible/);
  });
});

describe("Meta token renewal", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  test("warns from ten days out, not before", () => {
    const in9 = new Date(now.getTime() + 9 * 86_400_000 + 1000).toISOString();
    const in20 = new Date(now.getTime() + 20 * 86_400_000).toISOString();
    assert.equal(metaTokenRenewal(in9, now)?.warn, true);
    assert.equal(metaTokenRenewal(in20, now)?.warn, false);
    assert.equal(metaTokenRenewal(null, now), null);
  });
  test("an expired token is expired, not a warning", () => {
    const past = new Date(now.getTime() - 1000).toISOString();
    const result = metaTokenRenewal(past, now)!;
    assert.equal(result.expired, true);
    assert.equal(result.warn, false);
  });
  test("the health check flags it so the card and a notification say so", () => {
    const health = read("src", "lib", "jobs", "handlers", "integration-health.ts");
    assert.match(health, /token_expiring/);
    assert.match(health, /meta_token_expiring:/);
  });
});

describe("CRM push", () => {
  test("a lead pulled from the CRM updates that record rather than creating another", () => {
    assert.equal(existingCrmRecordId({ recorded: null, linked: "zoho-7" }), "zoho-7");
    assert.equal(existingCrmRecordId({ recorded: "rec-1", linked: "zoho-7" }), "rec-1");
    assert.equal(existingCrmRecordId({ recorded: null, linked: null, foundByEmail: "hit" }), "hit");
    assert.equal(existingCrmRecordId({ recorded: null, linked: null }), null);
  });

  test("the push handler reads the pull link and every adapter accepts it", () => {
    const handler = read("src", "lib", "jobs", "handlers", "crm-push.ts");
    assert.match(handler, /external_entity_links/);
    assert.match(handler, /linkedExternalId: link\?\.external_id/);
    for (const adapter of ["zoho-crm.ts", "hubspot.ts", "salesforce.ts"]) {
      assert.match(read("src", "lib", "integrations", "providers", adapter), /linkedExternalId/);
    }
    // Zoho searches by email before it creates.
    assert.match(read("src", "lib", "integrations", "providers", "zoho-crm.ts"), /Leads\/search/);
  });

  test("the lead's company is sent, never a placeholder that reads like data", () => {
    assert.equal(crmCompanyField("Acme Studio Ltd"), "Acme Studio Ltd");
    assert.equal(crmCompanyField("  "), "Not provided");
    assert.equal(crmCompanyField(null), "Not provided");
    for (const adapter of ["zoho-crm.ts", "salesforce.ts"]) {
      assert.doesNotMatch(
        read("src", "lib", "integrations", "providers", adapter),
        /Company: "Client Turn lead"/,
      );
    }
  });

  test("card copy promises only what the adapters create", () => {
    const zoho = PROVIDERS.find((provider) => provider.id === "zoho_crm")!;
    const salesforce = PROVIDERS.find((provider) => provider.id === "salesforce")!;
    assert.doesNotMatch(zoho.summary, /deals/i);
    assert.doesNotMatch(salesforce.summary, /contacts/i);
  });

  test("disconnecting a CRM switches its pull off", () => {
    const actions = read("src", "lib", "settings", "actions.ts");
    assert.match(actions, /crm_pull_settings[\s\S]{0,120}enabled: false/);
  });

  test("HubSpot scope help names the read scopes too", () => {
    assert.ok(HUBSPOT_REQUIRED_SCOPES.includes("crm.objects.contacts.read"));
    assert.ok(HUBSPOT_REQUIRED_SCOPES.includes("crm.objects.deals.read"));
    assert.match(HUBSPOT_SCOPE_HELP, /crm\.objects\.contacts\.read/);
  });
});

describe("connection vocabulary", () => {
  test("a broken connection reads 'Reconnect required' everywhere", () => {
    assert.equal(AVAILABILITY_META.RECONNECT_REQUIRED.label, "Reconnect required");
    const badge = read("src", "components", "ui", "badge.tsx");
    const health = badge.slice(badge.indexOf("export const INTEGRATION_HEALTH"));
    assert.match(health, /ACTION_REQUIRED: \{ label: "Reconnect required"/);
    assert.match(health, /DEGRADED: \{ label: "Needs attention"/);
  });

  test("the Resend card says it is system email, not campaigns", () => {
    const email = PROVIDERS.find((provider) => provider.id === "email")!;
    assert.match(email.summary, /Not your campaigns/);
  });

  test("TikTok is labelled beta and LinkedIn warns about Lead Sync approval", () => {
    assert.equal(PROVIDERS.find((provider) => provider.id === "tiktok_ads")!.beta, true);
    assert.match(PROVIDERS.find((provider) => provider.id === "linkedin_ads")!.caveat ?? "", /Lead Sync/);
  });
});

describe("LinkedIn organisations and page engagement", () => {
  test("only Lead Gen Forms scopes are requested; never r_organization_social", () => {
    // Company-page engagement as a prospect source was removed: LinkedIn's
    // terms forbid using member data to identify sales prospects.
    assert.doesNotMatch(linkedinScopes(), /r_organization_social/);
    assert.match(linkedinScopes(), /r_marketing_leadgen_automation/);
  });

  test("every administered organisation is kept, with its URN", () => {
    const orgs = organizationsFromAcls([
      { organizationalTarget: "urn:li:organization:1", "organizationalTarget~": { localizedName: "Acme" } },
      { organizationalTarget: "urn:li:organization:2" },
      { organizationalTarget: "urn:li:organization:1" },
      { organizationalTarget: "urn:li:person:x" },
    ]);
    assert.deepEqual(
      orgs.map((org) => [org.id, org.urn, org.name]),
      [
        ["1", "urn:li:organization:1", "Acme"],
        ["2", "urn:li:organization:2", "Organisation 2"],
      ],
    );
  });

  test("identify stores organizationUrn, and no LinkedIn engagement prospect source exists", () => {
    assert.match(read("src", "lib", "integrations", "providers", "linkedin-ads.ts"), /organizationUrn: first\.urn/);
    const registry = read("src", "lib", "find-leads", "server", "providers", "registry.ts");
    assert.doesNotMatch(registry, /linkedin-engagement|linkedinEngagementProvider/);
  });
});

describe("social sending accounts", () => {
  test("every platform offers the tiers its limits define", () => {
    assert.deepEqual(tiersForPlatform("LINKEDIN"), ["FREE", "PREMIUM", "SALES_NAVIGATOR", "RECRUITER"]);
    assert.deepEqual(tiersForPlatform("TIKTOK"), ["BUSINESS_PAGE"]);
    for (const option of SOCIAL_ACCOUNT_TIER_OPTIONS) assert.ok(option.label && option.hint);
  });

  test("LinkedIn Free gets 3 invitation notes a month (Help a563153)", () => {
    assert.equal(DEFAULT_SOCIAL_LIMITS.LINKEDIN.FREE!.monthlyNotes, 3);
  });

  test("Connections renders the card, and Find Leads links to it", () => {
    const section = read("src", "app", "(app)", "app", "settings", "_sections", "connections-section.tsx");
    assert.match(section, /<SocialAccountsCard/);
    const card = read("src", "components", "settings", "connections", "social-accounts-card.tsx");
    assert.match(card, /saveSocialAccountAction/);
    assert.match(card, /sendMode: "ASSISTED"/);
    assert.match(read("src", "components", "find-leads", "social", "social-queue-view.tsx"), /#social-accounts/);
  });

  test("'I have sent this' on an invitation note records the invite", () => {
    assert.equal(recordActionForDraft("INVITE_NOTE"), "INVITE");
    assert.equal(recordActionForDraft("OPENER"), "MESSAGE");
    assert.equal(recordActionForDraft("FOLLOW_UP"), "MESSAGE");
    const view = read("src", "components", "find-leads", "social", "social-queue-view.tsx");
    assert.match(view, /recordActionForDraft\(draft\.kind\) === "INVITE"[\s\S]{0,80}sendSocialInviteAction/);
  });
});

describe("InMail follows the account's tier", () => {
  test("Free has none; Sales Navigator is 50 rolling to 150", () => {
    assert.equal(tierHasInMail("FREE"), false);
    assert.equal(tierHasInMail(null), false);
    assert.deepEqual(
      [inMailRulesForTier("SALES_NAVIGATOR").monthlyGrant, inMailRulesForTier("SALES_NAVIGATOR").rolloverCap],
      [50, 150],
    );
    assert.equal(inMailRulesForTier("PREMIUM").monthlyGrant, DEFAULT_SOCIAL_LIMITS.LINKEDIN.PREMIUM!.monthlyInMail);
  });

  test("a Free account's balance is zero, not Sales Navigator's 50", () => {
    const rules = inMailRulesForTier("FREE");
    const balance = computeInMailBalance({
      sends: [],
      trackingSince: "2026-09-01T00:00:00Z",
      now: new Date("2026-09-20T00:00:00Z"),
      monthlyGrant: rules.monthlyGrant,
      rolloverCap: rules.rolloverCap,
    });
    assert.equal(balance.balance, 0);
  });

  test("the best active LinkedIn subscription wins", () => {
    assert.equal(bestLinkedInTier(["FREE", "SALES_NAVIGATOR", "PREMIUM"]), "SALES_NAVIGATOR");
    assert.equal(bestLinkedInTier(["BUSINESS_PAGE"]), null);
    assert.equal(bestLinkedInTier([]), null);
  });

  test("'Mark InMail sent' is hidden when there is no InMail", () => {
    const view = read("src", "components", "find-leads", "social", "social-queue-view.tsx");
    assert.match(view, /hasInMail && \(\s*<MarkInMailSentButton/);
  });
});

describe("social withdrawal settings: blank means never", () => {
  test("a saved null is kept; a missing row gets the defaults", () => {
    const saved = sequenceSettingsFromRow({
      social_withdraw_after_days: null,
      social_skip_to_email_after_days: null,
    });
    assert.equal(saved.withdrawAfterDays, null);
    assert.equal(saved.skipToEmailAfterDays, null);
    const fresh = sequenceSettingsFromRow(null);
    assert.equal(fresh.withdrawAfterDays, DEFAULT_SEQUENCE_SETTINGS.withdrawAfterDays);
    assert.equal(fresh.withdrawAfterDays, 30);
  });

  test("no reader coerces the null back to a number", () => {
    const queries = read("src", "lib", "compliance", "queries.ts");
    assert.doesNotMatch(queries, /social_withdraw_after_days \?\? 21/);
    assert.match(read("src", "lib", "compliance", "actions.ts"), /social_skip_to_email_after_days/);
  });

  test("a withdrawn invite in assisted mode asks a person to withdraw it on LinkedIn", () => {
    const scheduler = read("src", "lib", "outreach", "social-scheduler.ts");
    assert.match(scheduler, /Withdraw \$\{outcome\.withdrawn\} LinkedIn invitation/);
  });
});

describe("inbound connectors keep the company", () => {
  test("a named company becomes the prospect's company, deduped by business domain", () => {
    const company = connectorCompany({ company: "  Acme   Studio ", email: "jo@acme.co.uk" });
    assert.equal(company?.name, "Acme Studio");
    assert.equal(company?.domain, "acme.co.uk");
    assert.equal(company?.dedupeKey, "domain:acme.co.uk");
  });
  test("a freemail address never becomes the company domain", () => {
    const company = connectorCompany({ company: "Acme", email: "jo@gmail.com" });
    assert.equal(company?.domain, null);
    assert.match(company!.dedupeKey, /^name:/);
  });
  test("no company, nothing attached", () => {
    assert.equal(connectorCompany({ company: "", email: "a@b.com" }), null);
    assert.equal(connectorCompany({ company: undefined, email: null }), null);
  });
});

describe("services can publish a price", () => {
  test("only published visibility keeps wording", () => {
    assert.equal(isPublicPricing("PUBLIC_FROM"), true);
    assert.equal(isPublicPricing("QUOTE_REQUIRED"), false);
    assert.deepEqual(normalisePublicPrice({ visibility: "QUOTE_REQUIRED", text: "£10" }), { ok: true, text: null });
    assert.deepEqual(normalisePublicPrice({ visibility: "PUBLIC_FROM", text: " From £1,500 " }), { ok: true, text: "From £1,500" });
    assert.equal(normalisePublicPrice({ visibility: "PUBLIC_FIXED", text: "" }).ok, false);
  });
});

describe("time zones", () => {
  test("the full IANA list, London first, UTC included", () => {
    assert.ok(TIMEZONES.length > 300);
    assert.equal(TIMEZONES[0], "Europe/London");
    assert.ok(isTimezone("America/New_York"));
    assert.ok(isTimezone("UTC"));
    assert.equal(isTimezone("Mars/Olympus"), false);
  });
  test("nested zones keep their full city", () => {
    assert.match(timezoneLabel("America/Argentina/Buenos_Aires"), /Argentina \/ Buenos Aires/);
  });
});

describe("the Promote button agrees with the database", () => {
  const base = {
    promotedToLeadId: null,
    outreachEligibility: "ELIGIBLE",
    status: "APPROVED",
    repliedAt: null,
    sourceRunId: null,
  };
  test("a cold sourced prospect with no reply cannot be promoted", () => {
    assert.match(promotionBlockedReason({ ...base, sourceRunId: "run-1" })!, /needs a reply/);
  });
  test("a reply, or no sourcing run, allows it", () => {
    assert.equal(promotionBlockedReason({ ...base, sourceRunId: "run-1", repliedAt: "2026-09-01" }), null);
    assert.equal(promotionBlockedReason(base), null);
  });
  test("suppressed and already-promoted are refused", () => {
    assert.ok(promotionBlockedReason({ ...base, outreachEligibility: "SUPPRESSED" }));
    assert.ok(promotionBlockedReason({ ...base, promotedToLeadId: "lead-1" }));
  });
});

describe("lead source labels", () => {
  test("machine callers are named, and LinkedIn matches its connection name", () => {
    const badge = read("src", "components", "leads", "lead-source-badge.tsx");
    for (const slug of ["api", "mcp", "meta_dm", "connector", "webform"]) {
      assert.match(badge, new RegExp(`\\n  ${slug}: \\{ label: "`), `${slug} has no label`);
    }
    assert.match(badge, /linkedin_ads: \{ label: "LinkedIn Lead Gen Forms"/);
    assert.doesNotMatch(read("src", "components", "leads", "lead-filter-popover.tsx"), /"Meta form"/);
  });
});

describe("onboarding connects Meta for real", () => {
  test("the button goes to the OAuth route and the fake mapping UI is gone", () => {
    const step = read("src", "components", "onboarding", "steps", "connect-leads-step.tsx");
    assert.match(step, /\/api\/integrations\/meta\/connect\?return=\/onboarding/);
    assert.doesNotMatch(step, /Map lead fields/);
    assert.doesNotMatch(step, /Select lead forms/);
    assert.match(step, /mapped automatically|maps each\s+answer automatically/);
  });
});
