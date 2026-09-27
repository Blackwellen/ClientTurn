/**
 * Argument schemas of the `qualification.*` registry operations (§B.19).
 *
 * Pure, so the same validators run in the operation handlers, in the Lead
 * page's server actions and in the tests, and so the MCP gateway's JSON Schema
 * (derived from these by `z.toJSONSchema`) can be asserted without a server.
 */

import { z } from "zod";
import {
  INTENT_STATES,
  NBA_ACTIONS,
  NBA_HANDOVER_REASONS,
  qiDimensionKeySchema,
} from "./types.ts";
import { FACT_ACTIONS, NBA_OVERRIDE_ACTIONS, OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN } from "./explain.ts";
import { policyScopeSchema } from "../settings/ai-selling.ts";

const DAY = 86_400_000;
/** The furthest ahead an override may be set to hold. */
export const OVERRIDE_MAX_DAYS = 366;

const reason = z.string().trim().min(OVERRIDE_REASON_MIN, "Say why, in a few words.").max(OVERRIDE_REASON_MAX);
const until = z.iso.datetime({ offset: true });

export const leadRefSchema = z.object({ leadId: z.uuid() });

export const requalifySchema = z.object({
  leadId: z.uuid(),
  /** Why it is being re-run; recorded in the audit row. */
  reason: z.string().trim().max(OVERRIDE_REASON_MAX).optional(),
});

export const setFactSchema = z
  .object({
    leadId: z.uuid(),
    /** CONFIRM or REJECT an existing fact, or SET a dimension's value outright. */
    action: z.enum(FACT_ACTIONS),
    /** CONFIRM and REJECT: the fact acted on. */
    factId: z.uuid().optional(),
    /** SET: the dimension. */
    dimension: qiDimensionKeySchema.optional(),
    /** SET: the value, as a person would say it. */
    value: z.string().trim().min(1).max(500).optional(),
    reason: z.string().trim().max(OVERRIDE_REASON_MAX).optional(),
  })
  .superRefine((args, ctx) => {
    if ((args.action === "CONFIRM" || args.action === "REJECT") && !args.factId) {
      ctx.addIssue({ code: "custom", path: ["factId"], message: `${args.action} needs the fact's id.` });
    }
    if (args.action === "SET" && (!args.dimension || !args.value)) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "SET needs a dimension and a value." });
    }
  });
export type SetFactArgs = z.infer<typeof setFactSchema>;

export const overrideIntentSchema = z.object({
  leadId: z.uuid(),
  state: z.enum(INTENT_STATES),
  reason,
  /** When the override stops holding (NOT_NOW: when to resume). Defaults per state. */
  until: until.optional(),
});
export type OverrideIntentArgs = z.infer<typeof overrideIntentSchema>;

export const overrideNbaSchema = z
  .object({
    leadId: z.uuid(),
    action: z.enum(NBA_OVERRIDE_ACTIONS),
    reason,
    /** WAIT: when to resume. Otherwise, when the override stops holding. */
    until: until.optional(),
    /** ESCALATE: why a person is needed. Defaults to POLICY. */
    handoverReason: z.enum(NBA_HANDOVER_REASONS).optional(),
  })
  .superRefine((args, ctx) => {
    if (args.action === "WAIT" && !args.until) {
      ctx.addIssue({ code: "custom", path: ["until"], message: "Say when to resume." });
    }
  });
export type OverrideNbaArgs = z.infer<typeof overrideNbaSchema>;

export const policyGetSchema = z.object({ scope: policyScopeSchema.optional() });

/** `lead.search` additions (§B.17 / §B.19). */
export const leadSearchIntentFilters = {
  /** Only leads whose current intent state is one of these. */
  intentStateIn: z.array(z.enum(INTENT_STATES)).min(1).max(INTENT_STATES.length).optional(),
  /** Only leads at or above this intent score. */
  minIntentScore: z.number().int().min(0).max(100).optional(),
  /** Only leads whose qualification completeness is at or below this (0..1). */
  maxCompleteness: z.number().min(0).max(1).optional(),
  /** Only leads whose next best action is one of these. */
  nextActionIn: z.array(z.enum(NBA_ACTIONS)).min(1).max(NBA_ACTIONS.length).optional(),
  /** Strong intent (high, ready to book, ready to buy) but qualification not complete. */
  strongIntentIncomplete: z.boolean().optional(),
};

/** Why an override's end date is not acceptable, or null. */
export function untilProblem(value: string | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "That date is not valid.";
  if (at <= now.getTime()) return "The date must be in the future.";
  if (at > now.getTime() + OVERRIDE_MAX_DAYS * DAY) return `The date must be within ${OVERRIDE_MAX_DAYS} days.`;
  return null;
}
