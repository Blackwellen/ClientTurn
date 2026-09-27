/**
 * ClientTurn's provider cost of one call, for the server-only
 * `voice_cost_ledger` (0151). Pure. Platform-confidential: shown only to a
 * workspace owner/admin on the call card and in admin economics.
 *
 * Source of truth, in order:
 *   1. the provider's own figure from its webhook or call object (Retell
 *      `call_cost.combined_cost`, in cents; UNVERIFIED field shape, see
 *      retell-protocol.ts), recorded with `estimated = false`;
 *   2. otherwise an estimate from the destination rate table
 *      (destinations.ts DEFAULT_RATE_TABLE_USD, Elastic SIP) plus the voice
 *      engine per-minute (12-voice-provider-research.md stack A:
 *      Retell $0.055 + TTS $0.015 + LLM $0.0128) and recording $0.0025/min,
 *      recorded with `estimated = true`.
 *
 * Both rows are USD (every provider bills in USD); GBP is derived for display.
 * A later provider figure is a new correcting row (`reconciles_id`), never an
 * UPDATE: the ledger is append-only.
 */

import { classifyDestination, lookupRate, type DestinationClass } from "./destinations.ts";

export const VOICE_ENGINE_USD_PER_MIN = 0.055 + 0.015 + 0.0128;
export const RECORDING_USD_PER_MIN = 0.0025;
/** economics.md A21 (GBP per USD), the same model rate as billing/unit-costs.ts. */
export const USD_TO_GBP = 0.7549;

export type CostLine = {
  provider: "retell" | "twilio";
  metric: "VOICE_AI_MINUTE" | "TELEPHONY_MINUTE" | "RECORDING_STORAGE";
  quantity: number;
  unitCostUsd: number;
  totalUsd: number;
  estimated: boolean;
  idempotencyKey: string;
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Billed provider minutes: providers charge per started minute or per second; the estimate uses exact minutes. */
function minutesOf(durationSec: number): number {
  return Math.max(0, durationSec) / 60;
}

export function estimateCallCost(input: {
  callId: string;
  durationSec: number;
  toE164: string | null;
  recording: boolean;
  destinationClass?: DestinationClass | null;
}): CostLine[] {
  const minutes = minutesOf(input.durationSec);
  if (minutes <= 0) return [];
  const cls = input.destinationClass ?? (input.toE164 ? classifyDestination(input.toE164) : "UK_MOBILE");
  const tel = lookupRate(cls, "ELASTIC_SIP") ?? lookupRate("UK_MOBILE", "ELASTIC_SIP") ?? 0;
  const lines: CostLine[] = [
    {
      provider: "retell",
      metric: "VOICE_AI_MINUTE",
      quantity: round6(minutes),
      unitCostUsd: round6(VOICE_ENGINE_USD_PER_MIN),
      totalUsd: round6(minutes * VOICE_ENGINE_USD_PER_MIN),
      estimated: true,
      idempotencyKey: `voice:cost:${input.callId}:engine:estimate`,
    },
    {
      provider: "twilio",
      metric: "TELEPHONY_MINUTE",
      quantity: round6(minutes),
      unitCostUsd: round6(tel),
      totalUsd: round6(minutes * tel),
      estimated: true,
      idempotencyKey: `voice:cost:${input.callId}:telephony:estimate`,
    },
  ];
  if (input.recording) {
    lines.push({
      provider: "retell",
      metric: "RECORDING_STORAGE",
      quantity: round6(minutes),
      unitCostUsd: RECORDING_USD_PER_MIN,
      totalUsd: round6(minutes * RECORDING_USD_PER_MIN),
      estimated: true,
      idempotencyKey: `voice:cost:${input.callId}:recording:estimate`,
    });
  }
  return lines;
}

/** The provider's own figure (Retell combined cost, in US cents). */
export function providerCallCost(input: { callId: string; durationSec: number; costCents: number }): CostLine {
  const minutes = minutesOf(input.durationSec);
  const totalUsd = round6(input.costCents / 100);
  return {
    provider: "retell",
    metric: "VOICE_AI_MINUTE",
    quantity: round6(minutes),
    unitCostUsd: minutes > 0 ? round6(totalUsd / minutes) : 0,
    totalUsd,
    estimated: false,
    idempotencyKey: `voice:cost:${input.callId}:provider`,
  };
}

/**
 * The cost lines to record for a finished call: the provider figure when it
 * is known, else the estimate.
 */
export function callCostLines(input: {
  callId: string;
  durationSec: number | null;
  toE164: string | null;
  recording: boolean;
  providerCostCents: number | null;
  destinationClass?: DestinationClass | null;
}): CostLine[] {
  const durationSec = input.durationSec ?? 0;
  if (input.providerCostCents != null && Number.isFinite(input.providerCostCents) && input.providerCostCents >= 0) {
    return [providerCallCost({ callId: input.callId, durationSec, costCents: input.providerCostCents })];
  }
  return estimateCallCost({ callId: input.callId, durationSec, toE164: input.toE164, recording: input.recording, destinationClass: input.destinationClass });
}

export function totalGbp(lines: readonly CostLine[]): number {
  return Math.round(lines.reduce((sum, l) => sum + l.totalUsd, 0) * USD_TO_GBP * 10000) / 10000;
}
