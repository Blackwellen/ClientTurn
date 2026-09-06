import "server-only";
import { serverEnv } from "@/lib/env";
import { providerLabel } from "./format";
import { twilioAccountSidProblem } from "./providers-shared";
import { adminRead, type AdminClient } from "./shared";
import type { PlatformProviderRow, ProviderStatus } from "./types";

/**
 * Platform-level provider monitoring, distinct from per-workspace connection
 * health (`integrations.status`, refreshed by the integration.health_check
 * job). This answers "is the provider itself answering us, and how fast", so
 * one broken Calendly account does not read as a Calendly outage.
 *
 * Every probe is a single cheap request with its own timeout. Nothing about a
 * response body, header or credential is ever stored or logged — only a status,
 * a round-trip time and a short non-sensitive code.
 */

export const MONITORED_PROVIDERS = [
  "meta",
  "twilio_sms",
  "twilio_whatsapp",
  "calendly",
  "google_calendar",
  "stripe",
] as const;

export type MonitoredProvider = (typeof MONITORED_PROVIDERS)[number];

const PROBE_TIMEOUT_MS = 6_000;
/** Above this, a reachable provider is still reported as degraded. */
const SLOW_MS = 1_000;

export type ProbeResult = {
  provider: MonitoredProvider;
  status: ProviderStatus;
  latencyMs: number | null;
  errorCode: string | null;
  detail: string | null;
  configured: boolean;
};

function unconfigured(
  provider: MonitoredProvider,
  missing: string,
): ProbeResult {
  return {
    provider,
    status: "UNKNOWN",
    latencyMs: null,
    errorCode: "not_configured",
    detail: `Not monitored: ${missing} is not set on this deployment.`,
    configured: false,
  };
}

function classify(latencyMs: number): ProviderStatus {
  return latencyMs > SLOW_MS ? "DEGRADED" : "HEALTHY";
}

/** One request, hard-capped. Returns latency alongside the response. */
async function timedFetch(
  url: string,
  init?: RequestInit,
): Promise<{ response: Response | null; latencyMs: number; aborted: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    return { response, latencyMs: Date.now() - startedAt, aborted: false };
  } catch {
    return {
      response: null,
      latencyMs: Date.now() - startedAt,
      aborted: true,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeMeta(): Promise<ProbeResult> {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return unconfigured("meta", "META_APP_ID / META_APP_SECRET");

  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("grant_type", "client_credentials");

  const { response, latencyMs, aborted } = await timedFetch(url.toString());
  if (aborted || !response) {
    return {
      provider: "meta",
      status: "DOWN",
      latencyMs: null,
      errorCode: "unreachable",
      detail: "The Graph API did not answer within the probe timeout.",
      configured: true,
    };
  }
  if (response.ok) {
    return {
      provider: "meta",
      status: classify(latencyMs),
      latencyMs,
      errorCode: null,
      detail: null,
      configured: true,
    };
  }
  return {
    provider: "meta",
    status: response.status >= 500 ? "DOWN" : "DEGRADED",
    latencyMs,
    errorCode: String(response.status),
    detail:
      response.status === 400 || response.status === 401
        ? "The Graph API rejected the platform app credentials."
        : "The Graph API returned an error.",
    configured: true,
  };
}

async function probeTwilio(
  provider: "twilio_sms" | "twilio_whatsapp",
): Promise<ProbeResult> {
  const { accountSid, authToken, whatsappFrom } = serverEnv.twilio;
  if (!accountSid || !authToken) {
    return unconfigured(provider, "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  }
  if (provider === "twilio_whatsapp" && !whatsappFrom) {
    return unconfigured("twilio_whatsapp", "TWILIO_WHATSAPP_FROM");
  }

  /**
   * A wrong-shaped SID can never succeed, so it is reported as a
   * configuration problem rather than being sent to Twilio to come back as a
   * 404 that reads like an outage.
   */
  const sidProblem = twilioAccountSidProblem(accountSid);
  if (sidProblem) {
    return {
      provider,
      status: "UNKNOWN",
      latencyMs: null,
      errorCode: "misconfigured_sid",
      detail: sidProblem,
      configured: false,
    };
  }

  const { response, latencyMs, aborted } = await timedFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
    },
  );

  if (aborted || !response) {
    return {
      provider,
      status: "DOWN",
      latencyMs: null,
      errorCode: "unreachable",
      detail: "Twilio did not answer within the probe timeout.",
      configured: true,
    };
  }
  if (response.ok) {
    return {
      provider,
      status: classify(latencyMs),
      latencyMs,
      errorCode: null,
      detail:
        provider === "twilio_whatsapp"
          ? "Account reachable and a WhatsApp sender is configured."
          : null,
      configured: true,
    };
  }
  return {
    provider,
    status: response.status >= 500 ? "DOWN" : "DEGRADED",
    latencyMs,
    errorCode: String(response.status),
    detail:
      response.status === 401 || response.status === 403
        ? "Twilio rejected the stored platform credentials."
        : response.status === 404
          ? "Twilio has no account with the configured SID. Check TWILIO_ACCOUNT_SID."
          : "Twilio returned an error.",
    configured: true,
  };
}

async function probeCalendly(): Promise<ProbeResult> {
  /**
   * Two credential shapes exist here, and they answer different questions.
   *
   * `CALENDLY_API_KEY` is a personal token for the platform's own Calendly
   * account. It cannot connect a *customer's* calendar — that needs the OAuth
   * app (`CALENDLY_CLIENT_ID`/`SECRET`), which is not provisioned yet; see
   * docs/INTEGRATION_SETUP.md. For monitoring, though, the personal token is
   * the better instrument: it turns this into a real authenticated call
   * rather than a bare reachability ping.
   */
  const apiKey = process.env.CALENDLY_API_KEY;
  const hasOauthApp = Boolean(
    process.env.CALENDLY_CLIENT_ID && process.env.CALENDLY_CLIENT_SECRET,
  );

  if (!apiKey && !hasOauthApp) {
    return unconfigured(
      "calendly",
      "CALENDLY_API_KEY or CALENDLY_CLIENT_ID / CALENDLY_CLIENT_SECRET",
    );
  }

  const { response, latencyMs, aborted } = await timedFetch(
    "https://api.calendly.com/users/me",
    apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : undefined,
  );

  if (response && apiKey) {
    if (response.ok) {
      return {
        provider: "calendly",
        status: classify(latencyMs),
        latencyMs,
        errorCode: null,
        detail: hasOauthApp
          ? null
          : "Authenticated against the platform Calendly token. Connecting a customer's own calendar additionally needs the OAuth app.",
        configured: true,
      };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        provider: "calendly",
        status: "DEGRADED",
        latencyMs,
        errorCode: String(response.status),
        detail: "Calendly rejected the platform API token.",
        configured: true,
      };
    }
  }

  if (aborted || !response) {
    return {
      provider: "calendly",
      status: "DOWN",
      latencyMs: null,
      errorCode: "unreachable",
      detail: "The Calendly API did not answer within the probe timeout.",
      configured: true,
    };
  }
  // No platform token: 401 is the expected answer to an unauthenticated call,
  // so it still proves the service is up. Per-workspace token validity is what
  // integrations.status reports.
  if (response.ok || response.status === 401) {
    return {
      provider: "calendly",
      status: classify(latencyMs),
      latencyMs,
      errorCode: null,
      detail:
        "API availability only — no platform Calendly token is set, so this is not an authenticated check.",
      configured: true,
    };
  }
  return {
    provider: "calendly",
    status: response.status >= 500 ? "DOWN" : "DEGRADED",
    latencyMs,
    errorCode: String(response.status),
    detail: "The Calendly API returned an unexpected status.",
    configured: true,
  };
}

async function probeGoogleCalendar(): Promise<ProbeResult> {
  const { clientId, clientSecret } = serverEnv.google;
  if (!clientId || !clientSecret) {
    return unconfigured("google_calendar", "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  }

  const { response, latencyMs, aborted } = await timedFetch(
    "https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest",
  );
  if (aborted || !response) {
    return {
      provider: "google_calendar",
      status: "DOWN",
      latencyMs: null,
      errorCode: "unreachable",
      detail: "The Calendar API did not answer within the probe timeout.",
      configured: true,
    };
  }
  if (response.ok) {
    return {
      provider: "google_calendar",
      status: classify(latencyMs),
      latencyMs,
      errorCode: null,
      detail:
        "API availability only — per-workspace Google tokens are checked by connection health.",
      configured: true,
    };
  }
  return {
    provider: "google_calendar",
    status: response.status >= 500 ? "DOWN" : "DEGRADED",
    latencyMs,
    errorCode: String(response.status),
    detail: "The Calendar API returned an unexpected status.",
    configured: true,
  };
}

async function probeStripe(): Promise<ProbeResult> {
  const { response, latencyMs, aborted } = await timedFetch(
    "https://api.stripe.com/v1/balance",
    { headers: { Authorization: `Bearer ${serverEnv.stripe.secretKey}` } },
  );
  if (aborted || !response) {
    return {
      provider: "stripe",
      status: "DOWN",
      latencyMs: null,
      errorCode: "unreachable",
      detail: "Stripe did not answer within the probe timeout.",
      configured: true,
    };
  }
  if (response.ok) {
    return {
      provider: "stripe",
      status: classify(latencyMs),
      latencyMs,
      errorCode: null,
      detail: null,
      configured: true,
    };
  }
  return {
    provider: "stripe",
    status: response.status >= 500 ? "DOWN" : "DEGRADED",
    latencyMs,
    errorCode: String(response.status),
    detail:
      response.status === 401
        ? "Stripe rejected the configured API key."
        : "Stripe returned an error.",
    configured: true,
  };
}

const PROBES: Record<MonitoredProvider, () => Promise<ProbeResult>> = {
  meta: probeMeta,
  twilio_sms: () => probeTwilio("twilio_sms"),
  twilio_whatsapp: () => probeTwilio("twilio_whatsapp"),
  calendly: probeCalendly,
  google_calendar: probeGoogleCalendar,
  stripe: probeStripe,
};

/**
 * Runs every probe in parallel. One provider failing or hanging never blocks
 * the rest: each probe already carries its own timeout, and a thrown probe is
 * reported as DOWN rather than rejecting the whole refresh.
 */
export async function runProviderProbes(): Promise<ProbeResult[]> {
  const results = await Promise.allSettled(
    MONITORED_PROVIDERS.map((provider) => PROBES[provider]()),
  );

  return results.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    return {
      provider: MONITORED_PROVIDERS[index],
      status: "DOWN" as const,
      latencyMs: null,
      errorCode: "probe_failed",
      detail: "The health probe could not be completed.",
      configured: true,
    };
  });
}

export async function recordProbeResults(
  supabase: AdminClient,
  results: ProbeResult[],
): Promise<void> {
  const checkedAt = new Date().toISOString();
  await supabase.from("platform_provider_checks").insert(
    results.map((result) => ({
      provider: result.provider,
      status: result.status,
      latency_ms: result.latencyMs,
      error_code: result.errorCode,
      checked_at: checkedAt,
    })) as never,
  );
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

/**
 * Reads the stored probe series and derives what the tables show. With no
 * stored probes a provider reads as Unknown with em-dashes — never an
 * invented uptime figure.
 */
export async function getProviderHealth(
  supabase: AdminClient,
): Promise<PlatformProviderRow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const { data } = await supabase
    .from("platform_provider_checks")
    .select("provider, status, latency_ms, error_code, checked_at")
    .gte("checked_at", since)
    .order("checked_at", { ascending: false })
    .limit(20000);

  const byProvider = new Map<string, typeof data>();
  for (const row of data ?? []) {
    const list = byProvider.get(row.provider) ?? [];
    list!.push(row);
    byProvider.set(row.provider, list);
  }

  // Configuration is cheap to evaluate and does not need a network call, so a
  // never-probed provider can still say why it is not being monitored.
  const configured = await currentConfiguration();

  return MONITORED_PROVIDERS.map((provider) => {
    const rows = byProvider.get(provider) ?? [];
    const latest = rows[0];
    const latencies = rows
      .map((row) => row.latency_ms)
      .filter((value): value is number => typeof value === "number");
    const graded = rows.filter((row) => row.status !== "UNKNOWN");
    const healthy = graded.filter((row) => row.status === "HEALTHY").length;
    const incident = rows.find(
      (row) => row.status === "DEGRADED" || row.status === "DOWN",
    );

    return {
      provider,
      label: providerLabel(provider),
      status: (latest?.status as PlatformProviderRow["status"]) ?? "UNKNOWN",
      p95Ms: percentile(latencies, 95),
      uptime30d: graded.length > 0 ? healthy / graded.length : null,
      lastIncidentAt: incident?.checked_at ?? null,
      lastCheckedAt: latest?.checked_at ?? null,
      configured: configured[provider],
      detail:
        latest === undefined
          ? configured[provider]
            ? "No probe recorded yet. Run Refresh now to collect one."
            : "Not monitored: the platform holds no credentials for this provider."
          : null,
    };
  });
}

async function currentConfiguration(): Promise<Record<MonitoredProvider, boolean>> {
  const twilio =
    Boolean(serverEnv.twilio.accountSid && serverEnv.twilio.authToken) &&
    twilioAccountSidProblem(serverEnv.twilio.accountSid) === null;
  return {
    meta: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
    twilio_sms: twilio,
    twilio_whatsapp: twilio && Boolean(serverEnv.twilio.whatsappFrom),
    // Either credential shape is enough to monitor the API; only the OAuth
    // app enables connecting a customer's own calendar.
    calendly: Boolean(
      process.env.CALENDLY_API_KEY ||
        (process.env.CALENDLY_CLIENT_ID && process.env.CALENDLY_CLIENT_SECRET),
    ),
    google_calendar: Boolean(
      serverEnv.google.clientId && serverEnv.google.clientSecret,
    ),
    stripe: true,
  };
}

/** Convenience wrapper for callers outside the health service. */
export async function listProviderHealth(): Promise<PlatformProviderRow[]> {
  const supabase = await adminRead();
  return getProviderHealth(supabase);
}
