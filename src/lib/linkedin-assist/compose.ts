/**
 * Drafting one LinkedIn Assist message.
 *
 * Pure: the model call is injected (`generate`), so the rules are tested with
 * fakes and no paid call is ever made from a test. The same guard the social
 * sequencer uses (`checkComposedCopy`) decides whether a model's draft may be
 * used; the deterministic template is always the fallback and is always
 * sendable. CLAUDE.md resolved conflict 1 holds here: the model proposes
 * wording only; it never states a price, a promise, availability or a service
 * area, and it cannot invent a prior relationship or a fact it was not given.
 *
 * REPLY tasks are not drafted here. Those go through the conversation agent
 * (the same turn, validator and deterministic qualification as every other
 * channel), because answering somebody is a conversation, not outreach.
 */

import {
  checkComposedCopy,
  renderSocialTemplate,
  truncateAtWord,
  type SocialCopyContext,
  type SocialCopyKind,
} from "../outreach/social-copy.ts";
import { renderTemplate } from "../outreach/templates.ts";
import {
  bodyLimitFor,
  type LinkedInTaskKind,
} from "./types.ts";

export type DraftSubject = {
  firstName: string | null;
  lastName: string | null;
  roleTitle: string | null;
  companyName: string | null;
  industry: string | null;
};

export type DraftBusiness = {
  name: string;
  /** Up to two active service names, as the workspace wrote them. */
  serviceLine: string | null;
};

export type GenerateResult = {
  data: { body: string; used_facts: string[] } | null;
  skippedReason?: string | null;
};

export type Generate = (input: { context: string; idempotencyKey: string; maxOutputTokens: number }) => Promise<GenerateResult>;

export type ComposedDraft = {
  body: string;
  source: "TEMPLATE" | "AI";
  fallbackReason: string | null;
};

/** Which social-copy template family a task kind uses. */
export function copyKindFor(kind: LinkedInTaskKind, step: number): SocialCopyKind {
  if (kind === "CONNECTION_NOTE") return "INVITE_NOTE";
  if (kind === "FOLLOW_UP") return step <= 1 ? "OPENER" : "FOLLOW_UP";
  // InMail reaches somebody who is not connected. It is checked against the
  // OPENER rules (and limit) but uses its own template, because "thanks for
  // connecting" would be false.
  return "OPENER";
}

/** The facts a draft may use, and nothing else. Exact strings: the citation guard compares them. */
export function draftFacts(subject: DraftSubject, business: DraftBusiness): string[] {
  const facts: string[] = [];
  if (subject.companyName) facts.push(`Their company is called ${subject.companyName}.`);
  if (subject.roleTitle) facts.push(`Their role is ${subject.roleTitle}.`);
  if (subject.industry) facts.push(`Their industry is ${subject.industry}.`);
  if (business.serviceLine) facts.push(`${business.name} provides ${business.serviceLine}.`);
  return facts;
}

const INMAIL_TEMPLATE =
  "Hi {{first_name}},\n\nI'll keep this short. {{business_name}} works with {{company_type}} on {{service_line}}, and {{company_name}} looked like it might be relevant.\n\nIs that something you look after, or is it someone else's area?";

function copyContext(subject: DraftSubject, business: DraftBusiness): SocialCopyContext {
  return {
    prospect: {
      first_name: subject.firstName,
      last_name: subject.lastName,
      role_title: subject.roleTitle,
      company: subject.companyName ? { name: subject.companyName } : null,
    },
    businessName: business.name,
    companyType: subject.industry,
    serviceLine: business.serviceLine,
  };
}

/** The deterministic draft. Always within the kind's limit. */
export function templateDraft(
  kind: LinkedInTaskKind,
  step: number,
  subject: DraftSubject,
  business: DraftBusiness,
): string {
  if (kind === "INMAIL") {
    const body = renderTemplate(INMAIL_TEMPLATE, {
      first_name: subject.firstName?.trim() || "there",
      company_name: subject.companyName?.trim() || "your business",
      business_name: business.name,
      company_type: subject.industry?.trim() || "businesses like yours",
      service_line: business.serviceLine?.trim() || "the work we do",
    });
    return truncateAtWord(body, bodyLimitFor(kind));
  }
  return renderSocialTemplate({
    kind: copyKindFor(kind, step),
    platform: "LINKEDIN",
    // renderSocialTemplate numbers follow-ups 2 and 3, as the tasks do.
    step,
    context: copyContext(subject, business),
  });
}

/** What the model is told. It is given the template as the floor it must beat. */
export function draftPromptContext(input: {
  kind: LinkedInTaskKind;
  step: number;
  facts: string[];
  template: string;
}): string {
  const limit = bodyLimitFor(input.kind);
  const what =
    input.kind === "CONNECTION_NOTE"
      ? "a LinkedIn connection-request note (no greeting line needed, one or two sentences)"
      : input.kind === "INMAIL"
        ? "a LinkedIn InMail to someone who is not connected to the sender"
        : input.step <= 1
          ? "the first LinkedIn message after they accepted a connection request"
          : `LinkedIn follow-up number ${input.step - 1}, sent because they did not reply`;
  return [
    "Platform: LINKEDIN. A person will copy this and send it themselves from their own account.",
    `Message type: ${what}.`,
    `Hard limit: ${limit} characters.`,
    "",
    "Facts you may use. You know nothing else about this person or their company:",
    ...(input.facts.length ? input.facts.map((fact) => `- ${fact}`) : ["- (none)"]),
    "",
    "For reference, the message that will be used if you produce nothing usable:",
    input.template,
  ].join("\n");
}

/**
 * The draft for one task: the model's, if it passes the guard, else the template.
 * `aiEnabled` is the workspace toggle AND the plan entitlement, decided by the caller.
 */
export async function composeDraft(input: {
  kind: Exclude<LinkedInTaskKind, "REPLY">;
  step: number;
  subject: DraftSubject;
  business: DraftBusiness;
  aiEnabled: boolean;
  idempotencyKey: string;
  generate: Generate;
}): Promise<ComposedDraft> {
  const template = templateDraft(input.kind, input.step, input.subject, input.business);
  const fallback = (reason: string | null): ComposedDraft => ({
    body: template,
    source: "TEMPLATE",
    fallbackReason: reason,
  });
  if (!input.aiEnabled) return fallback(null);

  const facts = draftFacts(input.subject, input.business);
  const limit = bodyLimitFor(input.kind);

  let result: GenerateResult;
  try {
    result = await input.generate({
      context: draftPromptContext({ kind: input.kind, step: input.step, facts, template }),
      idempotencyKey: input.idempotencyKey,
      maxOutputTokens: input.kind === "CONNECTION_NOTE" ? 200 : 500,
    });
  } catch {
    return fallback("The AI draft could not be written, so the standard message is shown.");
  }

  if (result.skippedReason === "NO_TOKENS") {
    return fallback("This workspace has used its AI allowance, so the standard message is shown.");
  }
  if (result.skippedReason === "BUDGET" || result.skippedReason === "BUDGET_HUMAN") {
    return fallback("This workspace reached its AI budget, so the standard message is shown.");
  }
  if (!result.data) return fallback(null);

  const checked = checkComposedCopy({
    body: result.data.body,
    usedFacts: result.data.used_facts ?? [],
    suppliedFacts: facts,
    kind: copyKindFor(input.kind, input.step),
  });
  if (!checked.ok) {
    return fallback(
      `The AI draft was not used because it contained ${checked.rejections.map((r) => r.rule).join(", ")}.`,
    );
  }
  // The guard checks the social limit for the copy kind; a connection note's
  // own 300-character ceiling is re-applied here, never exceeded.
  if (checked.body.length > limit) {
    return fallback(`The AI draft was over the ${limit}-character limit, so the standard message is shown.`);
  }
  return { body: checked.body, source: "AI", fallbackReason: null };
}
