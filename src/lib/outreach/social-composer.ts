import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTask } from "@/lib/ai/model-router";
import { getEntitlements } from "@/lib/billing/entitlements";
import type { SocialMessageResult } from "@/lib/ai/schemas";
import {
  checkComposedCopy,
  maxCharsFor,
  renderSocialTemplate,
  truncateAtWord,
  type SocialCopyContext,
  type SocialCopyKind,
} from "./social-copy";
import type { SocialPlatform } from "./social-limits";

/**
 * Composing one social message.
 *
 * The deterministic template is the product; the model is an optional improver
 * that must earn its output past `checkComposedCopy` before it is used. That
 * ordering is deliberate and is the opposite of how most outreach tools work:
 * here, AI being off, out of tokens, unavailable or wrong costs a customer some
 * personalisation and nothing else, because the fallback is a message that was
 * always going to be good enough to send.
 *
 * The facts the model may use are assembled here and passed as an explicit
 * list. It is given nothing else about the prospect -- not the score, not the
 * grade, not the internal reasoning -- because a message that quotes back a
 * prospect's own B-grade is a message that should never have been composed.
 */

/** The evidence a composer may reference, and nothing beyond it. */
export type SocialFact = string;

export type ComposeInput = {
  businessId: string;
  prospectId: string;
  platform: SocialPlatform;
  kind: SocialCopyKind;
  /** 1 for the opener, 2-3 for follow-ups. Selects the template variant. */
  step: number;
  /**
   * Stable key for the token debit, so a retried job is charged once. Built by
   * the caller from the prospect and step, which is what makes it stable.
   */
  idempotencyKey: string;
};

export type ComposedMessage = {
  body: string;
  composedBy: "TEMPLATE" | "AI";
  modelRef: string | null;
  /**
   * Why the model's output was not used, when it was not. Recorded against the
   * message so a workspace whose AI copy is always rejected can be shown the
   * reason rather than quietly receiving templates forever.
   */
  fallbackReason: string | null;
};

/* ----------------------------------------------------------------- context */

type LoadedContext = {
  copy: SocialCopyContext;
  facts: SocialFact[];
  aiEnabled: boolean;
};

/**
 * What the composer knows.
 *
 * Facts are strings because that is what the citation guard compares against.
 * Each is phrased as the model would need to use it, so a match is exact and
 * `used_facts` cannot drift by paraphrase.
 */
async function loadContext(input: ComposeInput): Promise<LoadedContext | null> {
  const admin = createAdminClient();

  const [{ data: prospect }, { data: business }, { data: settings }, entitlements] =
    await Promise.all([
      admin
      .from("prospects")
      .select(
        "id, first_name, last_name, role_title, prospect_companies ( name, industry, employee_count, website_url )",
      )
      .eq("business_id", input.businessId)
      .eq("id", input.prospectId)
      .maybeSingle(),
    admin
      .from("businesses")
      .select("id, name")
      .eq("id", input.businessId)
      .maybeSingle(),
    admin
      .from("business_settings")
      .select("ai_assist_enabled")
      .eq("business_id", input.businessId)
      .maybeSingle(),
    getEntitlements(input.businessId),
  ]);

  if (!prospect || !business) return null;

  const company = prospect.prospect_companies as unknown as {
    name: string | null;
    industry: string | null;
    employee_count: number | null;
    website_url: string | null;
  } | null;

  // The workspace's own positioning, used for `company_type` and
  // `service_line`. Read from the active services rather than invented: if a
  // workspace has not described what it does, the template says so vaguely
  // rather than the model filling the gap.
  const { data: services } = await admin
    .from("services")
    .select("name")
    .eq("business_id", input.businessId)
    .eq("active", true)
    .order("position", { ascending: true })
    .limit(3);

  const serviceLine =
    (services ?? []).map((row) => row.name).filter(Boolean).slice(0, 2).join(" and ") ||
    null;

  const facts: SocialFact[] = [];
  if (company?.name) facts.push(`Their company is called ${company.name}.`);
  if (prospect.role_title) facts.push(`Their role is ${prospect.role_title}.`);
  if (company?.industry) facts.push(`Their industry is ${company.industry}.`);
  if (company?.employee_count) {
    facts.push(`Their company has roughly ${company.employee_count} employees.`);
  }
  if (serviceLine) facts.push(`${business.name} provides ${serviceLine}.`);

  return {
    copy: {
      prospect: {
        first_name: prospect.first_name,
        last_name: prospect.last_name,
        role_title: prospect.role_title,
        company: company?.name ? { name: company.name } : null,
      },
      businessName: business.name,
      companyType: company?.industry ?? null,
      serviceLine,
    },
    facts,
    // Both gates, the same pair `agent/policy.ts` reads: the workspace toggle
    // and the plan entitlement. Either being off means the template is the
    // message, which is a supported outcome rather than a degraded one.
    aiEnabled:
      Boolean(settings?.ai_assist_enabled) && entitlements.aiAssistAllowed,
  };
}

/* --------------------------------------------------------------- composing */

export async function composeSocialMessage(
  input: ComposeInput,
): Promise<ComposedMessage | null> {
  const context = await loadContext(input);
  if (!context) return null;

  const template = renderSocialTemplate({
    kind: input.kind,
    platform: input.platform,
    step: input.step,
    context: context.copy,
  });

  // Every path below returns the template on failure, so it is built first and
  // the model is only ever an improvement on something already sendable.
  const fallback = (reason: string | null): ComposedMessage => ({
    body: template,
    composedBy: "TEMPLATE",
    modelRef: null,
    fallbackReason: reason,
  });

  if (!context.aiEnabled) return fallback(null);

  // An invitation note is 300 characters and is the one message where a
  // template is genuinely as good as anything a model would write. Spending a
  // token call on it buys nothing, and the note allowance is scarcer than the
  // tokens are.
  if (input.kind === "INVITE_NOTE") return fallback(null);

  const limit = maxCharsFor(input.kind);

  const result = await runTask<SocialMessageResult>({
    taskType: "social_message",
    businessId: input.businessId,
    idempotencyKey: input.idempotencyKey,
    maxOutputTokens: 500,
    context: [
      `Platform: ${input.platform}.`,
      `Message type: ${input.kind === "OPENER" ? "the first message after they accepted a connection request" : `follow-up number ${input.step - 1}, sent because they did not reply`}.`,
      `Hard limit: ${limit} characters.`,
      "",
      "Facts you may use. You know nothing else about this person or their company:",
      ...context.facts.map((fact) => `- ${fact}`),
      "",
      "For reference, the message that will be sent if you produce nothing usable:",
      template,
    ].join("\n"),
  });

  if (result.skippedReason) {
    return fallback(
      result.skippedReason === "NO_TOKENS"
        ? "This workspace has used its AI allowance, so the standard message was sent."
        : null,
    );
  }
  if (!result.data) return fallback(null);

  const checked = checkComposedCopy({
    body: result.data.body,
    usedFacts: result.data.used_facts,
    suppliedFacts: context.facts,
    kind: input.kind,
  });

  if (!checked.ok) {
    // Named in full rather than counted. A workspace whose generated copy keeps
    // being rejected for "a price" has a prompt or a service description
    // problem, and "3 checks failed" would never tell them that.
    return fallback(
      `The generated message was not used because it contained ${checked.rejections
        .map((rejection) => rejection.rule)
        .join(", ")}.`,
    );
  }

  return {
    body: truncateAtWord(checked.body, limit),
    composedBy: "AI",
    modelRef: "social_message",
    fallbackReason: null,
  };
}
