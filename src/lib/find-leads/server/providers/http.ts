import "server-only";
import { serverEnv } from "@/lib/env";
import { providerFailure, type ProviderErrorCode, type ProviderResponse } from "./types";

/**
 * The one HTTP path every sourcing adapter uses.
 *
 * Centralised so timeout, error classification and — most importantly — the
 * rule that a provider failure is a *value* rather than an exception hold for
 * every provider identically. A thrown error inside the run worker would abort
 * a stage mid-batch and lose the cost accounting for the calls already made.
 */

export type JsonRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
};

export async function providerJson<T>(
  request: JsonRequest,
): Promise<{ ok: true; data: T; latencyMs: number } | { ok: false; code: ProviderErrorCode; latencyMs: number }> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), serverEnv.sourcing.timeoutMs);

  try {
    const response = await fetch(request.url, {
      method: request.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(request.body ? { "content-type": "application/json" } : {}),
        ...request.headers,
      },
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    const latencyMs = Date.now() - started;

    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "PROVIDER_AUTH_FAILED", latencyMs };
    }
    if (response.status === 429) {
      return { ok: false, code: "PROVIDER_RATE_LIMIT", latencyMs };
    }
    if (response.status >= 500) {
      return { ok: false, code: "PROVIDER_UNAVAILABLE", latencyMs };
    }
    if (!response.ok) {
      return { ok: false, code: "PROVIDER_BAD_RESPONSE", latencyMs };
    }

    const data = (await response.json()) as T;
    return { ok: true, data, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      code: aborted ? "PROVIDER_TIMEOUT" : "PROVIDER_UNAVAILABLE",
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Shorthand for adapters that need to bail before making a request. */
export function unconfigured<T>(): ProviderResponse<T> {
  return providerFailure<T>("PROVIDER_NOT_CONFIGURED");
}
