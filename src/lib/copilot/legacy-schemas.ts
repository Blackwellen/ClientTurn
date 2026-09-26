/**
 * Argument schemas for the Copilot tools that are not (yet) service-layer
 * operations.
 *
 * Every legacy tool used to be offered to the model as an open object
 * (`additionalProperties: true`) and then picked its arguments apart by hand,
 * so the shape the model was shown and the shape that was enforced were two
 * different things — and for `updateCampaignPriority` they disagreed outright
 * (a 1-10 number was sent to an action that only accepts a named band).
 *
 * One Zod schema per tool now does both jobs: `loop.ts` derives the JSON
 * Schema the model is shown from it, and `tool-service.ts` validates against
 * it before anything runs. Strict objects, so an unexpected key is refused
 * rather than silently ignored.
 *
 * Pure (no `server-only`, relative imports) so the tests can assert on it.
 */

import { z } from "zod";
import { CAMPAIGN_PRIORITIES, type CampaignPriority } from "../outreach/types.ts";
import { TICKET_CATEGORIES, type TicketCategory } from "../support/types.ts";

const none = z.object({}).strict();

const campaignRef = z
  .object({ id: z.uuid().describe("The outreach campaign's id.") })
  .strict();

export const LEGACY_TOOL_SCHEMAS = {
  /* ------------------------------------------------------------- reads */
  getCampaign: campaignRef,
  getCampaignPerformance: none,
  getAnalytics: z
    .object({
      view: z
        .enum(["overview", "acquisition", "outreach", "conversion"])
        .optional()
        .describe("Which analytics view. Defaults to overview."),
      range: z
        .enum(["7d", "30d", "90d", "12m"])
        .optional()
        .describe("The period. Defaults to 30d."),
    })
    .strict(),
  getBusinessProfile: none,
  getIntentSignals: none,
  getUsage: none,
  getAttentionItems: none,

  /* ------------------------------------------------------------ writes */
  createCampaignDraft: none,
  pauseCampaign: campaignRef,
  updateCampaignPriority: z
    .object({
      id: z.uuid().describe("The outreach campaign's id."),
      priority: z.enum(
        CAMPAIGN_PRIORITIES.map((p) => p.value) as [CampaignPriority, ...CampaignPriority[]],
      ),
    })
    .strict(),
  updateBusinessFact: z
    .object({
      factKey: z.string().trim().min(1).max(120),
      value: z.string().trim().max(2000),
    })
    .strict(),
  createSupportTicket: z
    .object({
      category: z
        .enum(TICKET_CATEGORIES.map((c) => c.value) as [TicketCategory, ...TicketCategory[]])
        .optional(),
      subject: z.string().trim().min(4).max(120),
      description: z.string().trim().min(10).max(5000),
    })
    .strict(),
} as const satisfies Record<string, z.ZodType>;

export type LegacyToolName = keyof typeof LEGACY_TOOL_SCHEMAS;

export function legacyToolSchema(name: string): z.ZodType | null {
  return Object.prototype.hasOwnProperty.call(LEGACY_TOOL_SCHEMAS, name)
    ? LEGACY_TOOL_SCHEMAS[name as LegacyToolName]
    : null;
}

/**
 * Validates a legacy tool's arguments. A tool with no schema is refused: an
 * unvalidated tool is exactly what this module exists to remove.
 */
export function parseLegacyArgs(
  name: string,
  args: unknown,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  const schema = legacyToolSchema(name);
  if (!schema) return { ok: false, error: "That action is not available." };

  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    return {
      ok: false,
      error: `Those details were not valid${where}: ${issue?.message ?? "check the arguments"}.`,
    };
  }
  return { ok: true, args: parsed.data as Record<string, unknown> };
}
