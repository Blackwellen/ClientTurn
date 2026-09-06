import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reserveRunSpend, settleRunSpend } from "../budget";
import { FALLBACK_UNIT_COST_MINOR, type Capability, type UnitCosts } from "../../cost-model";
import { providersFor } from "./registry";
import { isTransient, type ProviderErrorCode, type ProviderResponse } from "./types";

/**
 * The cost-aware provider waterfall (V4 §11.14).
 *
 * Every paid provider call in the product goes through `runProviderBatch`, and
 * it does four things in a fixed order that individually look like bookkeeping
 * and together are the reason a run cannot overspend:
 *
 *   1. reserve the estimated cost atomically, refusing if there is no room;
 *   2. call the cheapest healthy provider that offers the capability;
 *   3. record the call in `sourcing_run_queries` with an idempotency key, so a
 *      retried worker cannot double-charge the same logical batch;
 *   4. settle the reservation against what the batch actually cost.
 *
 * Failure never throws: a stage that half-succeeded must keep the cost it
 * already incurred on the ledger.
 */

export type BatchOutcome<T> = {
  ok: boolean;
  records: T[];
  provider: string | null;
  cursor: string | null;
  errorCode: ProviderErrorCode | null;
  /** True when the run must stop because there is no money left. */
  budgetExhausted: boolean;
  costMinor: number;
};

export type BatchRequest<T> = {
  runId: string;
  businessId: string;
  stage: string;
  capability: Capability;
  /** How many records this batch will touch, for the cost estimate. */
  recordCount: number;
  unitCosts: UnitCosts;
  unhealthy: Set<string>;
  /**
   * Stable per-batch key. Two attempts at the same logical batch share it, so
   * the unique index on (run_id, idempotency_key) makes the second a no-op.
   */
  idempotencyKey: string;
  /** Runs the provider. Returns a value, never throws. */
  invoke: (
    provider: NonNullable<ReturnType<typeof providersFor>[number]>,
  ) => Promise<ProviderResponse<T>>;
};

function estimateFor(
  capability: Capability,
  recordCount: number,
  unitCosts: UnitCosts,
): number {
  const unit = unitCosts[capability] ?? FALLBACK_UNIT_COST_MINOR[capability];
  return Math.ceil(Math.max(0, recordCount) * unit);
}

export async function runProviderBatch<T>(
  request: BatchRequest<T>,
): Promise<BatchOutcome<T>> {
  const admin = createAdminClient();
  const candidates = providersFor(request.capability, request.unhealthy);

  if (candidates.length === 0) {
    return {
      ok: false,
      records: [],
      provider: null,
      cursor: null,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      budgetExhausted: false,
      costMinor: 0,
    };
  }

  // A batch already recorded under this key succeeded on a previous attempt.
  // Re-running it would charge twice for records the run already holds.
  const { data: existing } = await admin
    .from("sourcing_run_queries")
    .select("id, status")
    .eq("run_id", request.runId)
    .eq("idempotency_key", request.idempotencyKey)
    .maybeSingle();

  if (existing && existing.status === "SUCCESS") {
    return {
      ok: true,
      records: [],
      provider: null,
      cursor: null,
      errorCode: null,
      budgetExhausted: false,
      costMinor: 0,
    };
  }

  const estimate = estimateFor(request.capability, request.recordCount, request.unitCosts);
  const reserved = await reserveRunSpend(request.runId, request.businessId, estimate);

  if (!reserved) {
    return {
      ok: false,
      records: [],
      provider: null,
      cursor: null,
      errorCode: null,
      budgetExhausted: true,
      costMinor: 0,
    };
  }

  let lastError: ProviderErrorCode | null = null;

  for (const provider of candidates) {
    const started = Date.now();
    const { data: query } = await admin
      .from("sourcing_run_queries")
      .insert({
        business_id: request.businessId,
        run_id: request.runId,
        stage: request.stage,
        provider: provider.key,
        capability: request.capability,
        // The request body is deliberately NOT stored: V4 §90 keeps raw
        // provider queries out of a customer-readable table, and this table is
        // column-granted to members.
        request_json: { record_count: request.recordCount },
        status: "PENDING",
        idempotency_key: `${request.idempotencyKey}:${provider.key}`,
      })
      .select("id")
      .maybeSingle();

    const response = await request.invoke(provider);
    const latencyMs = response.latencyMs || Date.now() - started;

    // A provider that reports its own price is believed. One that does not is
    // billed at the price book — except a free source, which is billed at zero
    // rather than at the rate of the metered vendor it replaced.
    const actual = !response.ok
      ? 0
      : provider.freeOfCharge
        ? 0
        : response.costMinor > 0
          ? response.costMinor
          : estimateFor(request.capability, response.records.length, request.unitCosts);

    if (query) {
      await admin
        .from("sourcing_run_queries")
        .update({
          status: response.ok
            ? response.records.length > 0
              ? "SUCCESS"
              : "EMPTY"
            : response.errorCode === "PROVIDER_RATE_LIMIT"
              ? "RATE_LIMITED"
              : "FAILED",
          result_count: response.records.length,
          cost_minor: actual,
          latency_ms: latencyMs,
          error_code: response.errorCode,
          completed_at: new Date().toISOString(),
        })
        .eq("id", query.id);
    }

    if (response.ok) {
      await settleRunSpend({
        runId: request.runId,
        businessId: request.businessId,
        provider: provider.key,
        capability: request.capability,
        reservedMinor: estimate,
        actualMinor: actual,
        recordCount: response.records.length,
      });

      return {
        ok: true,
        records: response.records,
        provider: provider.key,
        cursor: response.cursor,
        errorCode: null,
        budgetExhausted: false,
        costMinor: actual,
      };
    }

    lastError = response.errorCode;

    // Fall through to the next provider only for a failure the next provider
    // could plausibly survive. An auth failure on one vendor says nothing
    // about another, so it is worth trying; a rate limit means back off.
    if (response.errorCode === "PROVIDER_RATE_LIMIT") break;
  }

  // Nothing was delivered, so release the whole reservation.
  await settleRunSpend({
    runId: request.runId,
    businessId: request.businessId,
    provider: candidates[0].key,
    capability: request.capability,
    reservedMinor: estimate,
    actualMinor: 0,
    recordCount: 0,
  });

  return {
    ok: false,
    records: [],
    provider: null,
    cursor: null,
    errorCode: lastError,
    budgetExhausted: false,
    costMinor: 0,
  };
}

export { isTransient };
