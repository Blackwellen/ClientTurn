/**
 * Pipeline semantics (gap map §46): the system's own vocabulary for where a
 * deal is -- New, Contacted, Qualified, Quoted, Booking pending, Booked,
 * Negotiation, Accepted, Payment pending, Won, plus Nurture, Disqualified,
 * Lost and Reactivation -- and how each lands on the workspace's pipeline.
 *
 * The pipeline itself is the opportunity stage vocabulary in `stages.ts`,
 * shaped per sales motion. It is not free-form, so the mapping is too: each
 * semantic maps to one of those stages, to closing the deal, or to "leave the
 * deal where it is". A workspace changes the map in Settings -> AI & selling
 * -> Pipeline stages; with no saved map, `DEFAULT_SEMANTIC_MAP` applies.
 *
 * What the map can never do:
 *   * move a deal backwards (automatic moves are forward only, `canAdvance`);
 *   * move a closed deal;
 *   * use a stage the deal's motion does not have (it falls back to the
 *     nearest earlier stage the motion does have, or does nothing);
 *   * close a deal as won on anything but the WON semantic, or as lost on
 *     anything but LOST or DISQUALIFIED.
 *
 * Pure: no Supabase, no `server-only`, relative imports with `.ts`, so the
 * whole decision is asserted by tests/pipeline-semantics.test.ts.
 */

import { z } from "zod";
import {
  OPEN_STAGES,
  STAGE_LABEL,
  canAdvance,
  stageRank,
  stagesForMotion,
  type OpenStage,
} from "./stages.ts";

export const PIPELINE_SEMANTICS = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "QUOTED",
  "BOOKING_PENDING",
  "BOOKED",
  "NEGOTIATION",
  "ACCEPTED",
  "PAYMENT_PENDING",
  "WON",
  "NURTURE",
  "DISQUALIFIED",
  "LOST",
  "REACTIVATION",
] as const;
export type PipelineSemantic = (typeof PIPELINE_SEMANTICS)[number];

export const SEMANTIC_META: Record<PipelineSemantic, { label: string; description: string; side: boolean }> = {
  NEW: { label: "New", description: "A lead or deal has just been created.", side: false },
  CONTACTED: { label: "Contacted", description: "The lead picked up a call or had a first real conversation.", side: false },
  QUALIFIED: { label: "Qualified", description: "Your rules, or a call, found the lead a fit.", side: false },
  QUOTED: { label: "Quoted", description: "A quote was sent to the customer.", side: false },
  BOOKING_PENDING: { label: "Booking pending", description: "A booking link was sent and the lead has not picked a time yet.", side: false },
  BOOKED: { label: "Booked", description: "A meeting is in the calendar.", side: false },
  NEGOTIATION: { label: "Negotiation", description: "The customer is discussing terms or price.", side: false },
  ACCEPTED: { label: "Accepted", description: "The customer accepted or signed the quote.", side: false },
  PAYMENT_PENDING: { label: "Payment pending", description: "An invoice was issued, or a deposit is paid and the balance is due.", side: false },
  WON: { label: "Won", description: "Paid in full, or a direct sale was confirmed.", side: false },
  NURTURE: { label: "Nurture", description: "The lead is not ready yet and is being kept warm.", side: true },
  DISQUALIFIED: { label: "Disqualified", description: "Your rules found the lead not a fit.", side: true },
  LOST: { label: "Lost", description: "The customer declined the quote.", side: true },
  REACTIVATION: { label: "Reactivation", description: "A quote expired, or a reactivation campaign brought the lead back.", side: true },
};

/** Where a semantic lands: an open stage, closing the deal, or nowhere. */
export const PIPELINE_ACTIONS = ["NO_MOVE", "CLOSE_WON", "CLOSE_LOST"] as const;
export type PipelineAction = (typeof PIPELINE_ACTIONS)[number];
export type PipelineTarget = OpenStage | PipelineAction;

export const PIPELINE_TARGETS: readonly PipelineTarget[] = [...OPEN_STAGES, ...PIPELINE_ACTIONS];

export const TARGET_LABEL: Record<PipelineTarget, string> = {
  ...(STAGE_LABEL as Record<OpenStage, string>),
  NO_MOVE: "Leave the deal where it is",
  CLOSE_WON: "Close the deal as won",
  CLOSE_LOST: "Close the deal as lost",
};

export type SemanticMap = Record<PipelineSemantic, PipelineTarget>;

/**
 * The defaults. Conservative on purpose: nothing closes a deal as lost by
 * itself (a declined quote is often the start of a negotiation), and only
 * WON closes it as won.
 */
export const DEFAULT_SEMANTIC_MAP: Readonly<SemanticMap> = {
  NEW: "OPEN",
  CONTACTED: "QUALIFYING",
  QUALIFIED: "QUALIFIED",
  QUOTED: "PROPOSAL",
  BOOKING_PENDING: "NO_MOVE",
  BOOKED: "MEETING_BOOKED",
  NEGOTIATION: "NEGOTIATION",
  ACCEPTED: "NEGOTIATION",
  PAYMENT_PENDING: "CHECKOUT_SENT",
  WON: "CLOSE_WON",
  NURTURE: "NO_MOVE",
  DISQUALIFIED: "NO_MOVE",
  LOST: "NO_MOVE",
  REACTIVATION: "NO_MOVE",
};

/** The targets a semantic may be mapped to. */
export function allowedTargets(semantic: PipelineSemantic): readonly PipelineTarget[] {
  if (semantic === "WON") return ["CLOSE_WON", "NO_MOVE"];
  if (semantic === "LOST" || semantic === "DISQUALIFIED") return ["CLOSE_LOST", "NO_MOVE"];
  return [...OPEN_STAGES, "NO_MOVE"];
}

export const semanticMapSchema = z
  .object(
    Object.fromEntries(PIPELINE_SEMANTICS.map((s) => [s, z.enum(PIPELINE_TARGETS as [PipelineTarget, ...PipelineTarget[]])])) as Record<
      PipelineSemantic,
      z.ZodEnum<Record<PipelineTarget, PipelineTarget>>
    >,
  )
  .superRefine((map, ctx) => {
    for (const semantic of PIPELINE_SEMANTICS) {
      if (!allowedTargets(semantic).includes(map[semantic])) {
        ctx.addIssue({
          code: "custom",
          path: [semantic],
          message: `${SEMANTIC_META[semantic].label} cannot be mapped to "${TARGET_LABEL[map[semantic]]}".`,
        });
      }
    }
  });

/**
 * A stored map, read defensively: every missing or invalid entry falls back
 * to its default, one entry at a time, so a stale row never switches moves off
 * wholesale or allows a move the rules forbid.
 */
export function parseSemanticMap(stored: unknown): SemanticMap {
  const out = { ...DEFAULT_SEMANTIC_MAP } as SemanticMap;
  if (!stored || typeof stored !== "object") return out;
  for (const semantic of PIPELINE_SEMANTICS) {
    const value = (stored as Record<string, unknown>)[semantic];
    if (typeof value === "string" && allowedTargets(semantic).includes(value as PipelineTarget)) {
      out[semantic] = value as PipelineTarget;
    }
  }
  return out;
}

/** The semantics whose saved target differs from the default. */
export function changedFromDefault(map: SemanticMap): PipelineSemantic[] {
  return PIPELINE_SEMANTICS.filter((s) => map[s] !== DEFAULT_SEMANTIC_MAP[s]);
}

/**
 * The stage a target lands on for a motion: the stage itself when the motion
 * uses it, otherwise the nearest earlier stage the motion does use (a
 * checkout motion has no PROPOSAL, so "Quoted" lands on its QUALIFIED).
 * Null when there is none.
 */
export function stageForMotion(target: OpenStage, motion: string | null | undefined): OpenStage | null {
  const stages = stagesForMotion(motion);
  if (stages.includes(target)) return target;
  const rank = stageRank(target);
  const earlier = stages.filter((stage) => stageRank(stage) <= rank);
  if (earlier.length === 0) return null;
  return earlier.reduce((best, stage) => (stageRank(stage) > stageRank(best) ? stage : best));
}

export type PipelineMove =
  | { kind: "ADVANCE"; stage: OpenStage }
  | { kind: "CLOSE"; outcome: "WON" | "LOST"; reason: string }
  | { kind: "NONE"; reason: string };

/** Decides the move for one semantic on one opportunity. */
export function planPipelineMove(input: {
  semantic: PipelineSemantic;
  map: SemanticMap;
  motion: string | null | undefined;
  opportunity: { stage: string; outcome: string } | null;
}): PipelineMove {
  const target = input.map[input.semantic];
  if (target === "NO_MOVE") return { kind: "NONE", reason: `${SEMANTIC_META[input.semantic].label} is set to leave the deal where it is.` };
  if (!input.opportunity) return { kind: "NONE", reason: "There is no deal to move." };
  if (input.opportunity.outcome !== "OPEN" || input.opportunity.stage === "CLOSED") {
    return { kind: "NONE", reason: "The deal is already closed." };
  }
  if (target === "CLOSE_WON" || target === "CLOSE_LOST") {
    // Guarded twice: the map schema refuses it, and so does this.
    if (!allowedTargets(input.semantic).includes(target)) return { kind: "NONE", reason: "That close is not allowed for this event." };
    return {
      kind: "CLOSE",
      outcome: target === "CLOSE_WON" ? "WON" : "LOST",
      reason: `${SEMANTIC_META[input.semantic].label} (set automatically by your pipeline mapping)`,
    };
  }
  const stage = stageForMotion(target, input.motion);
  if (!stage) return { kind: "NONE", reason: "Your sales motion has no stage for this." };
  if (!canAdvance(input.opportunity.stage, stage)) {
    return { kind: "NONE", reason: "Automatic moves only go forward; the deal is already at or past that stage." };
  }
  return { kind: "ADVANCE", stage };
}

/* ------------------------------------------------------ event -> semantic */

/**
 * The automation event each semantic is read from. `invoice.paid` depends on
 * the quote: fully paid is WON, a paid deposit with more to come is still
 * PAYMENT_PENDING (see `semanticForEvent`).
 */
export const EVENT_SEMANTIC: Readonly<Record<string, PipelineSemantic>> = {
  "lead.created": "NEW",
  "call.answered": "CONTACTED",
  "qualification.qualified": "QUALIFIED",
  "call.qualified": "QUALIFIED",
  "qualification.not_qualified": "DISQUALIFIED",
  "quote.sent": "QUOTED",
  "booking.link_sent": "BOOKING_PENDING",
  "booking.created": "BOOKED",
  "quote.accepted": "ACCEPTED",
  "signature.completed": "ACCEPTED",
  "invoice.issued": "PAYMENT_PENDING",
  "invoice.paid": "WON",
  "payment.direct_sale": "WON",
  "quote.declined": "LOST",
  "quote.expired": "REACTIVATION",
  "reactivation.succeeded": "REACTIVATION",
};

export function semanticForEvent(eventType: string, context: { quoteStatus?: string | null } = {}): PipelineSemantic | null {
  const semantic = EVENT_SEMANTIC[eventType] ?? null;
  if (eventType === "invoice.paid") {
    const status = context.quoteStatus ?? null;
    // Only a quote the invoicing core marked PAID or WON is paid in full.
    return status === "PAID" || status === "WON" ? "WON" : "PAYMENT_PENDING";
  }
  return semantic;
}
