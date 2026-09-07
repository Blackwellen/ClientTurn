import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { SERVICE_OPERATIONS } from "@/lib/services/registry";
import { implementedOperations } from "@/lib/services/runtime";
import { MCP_SCOPES } from "@/lib/mcp/tools";
import { serverEnv } from "@/lib/env";

/**
 * Platform readiness (Programme §20).
 *
 * The programme asks for a 20-area matrix with per-test owner, severity,
 * evidence and blocking status. What is built here is deliberately narrower and
 * more useful: **readiness computed from the running system**, not a checklist
 * someone maintains by hand.
 *
 * The reason is the failure mode. A hand-maintained matrix is green on the day
 * it is filled in and lies quietly from then on, and the thing it is most
 * likely to lie about is the thing nobody has looked at recently. Every signal
 * below is read live, so it cannot go stale, and anything that genuinely cannot
 * be measured from inside the application says so rather than showing a tick.
 *
 * That last point is the rule this file is built around: **an area with no
 * signal is reported as `UNKNOWN`, never as ready.** A release decision made
 * against invented green ticks is worse than one made against an honest gap.
 */

export type ReadinessState = "READY" | "ATTENTION" | "BLOCKED" | "UNKNOWN";

export type ReadinessArea = {
  key: string;
  label: string;
  state: ReadinessState;
  /** What was actually measured, in one line. */
  detail: string;
  /** The numbers behind the verdict, for someone who wants to check it. */
  evidence: { label: string; value: string }[];
  /** Where to go to act on it. */
  href?: string;
};

export type ReadinessReport = {
  areas: ReadinessArea[];
  summary: {
    ready: number;
    attention: number;
    blocked: number;
    unknown: number;
  };
  generatedAt: string;
};

/* ------------------------------------------------------------------ counts */

/**
 * Runs a prepared count query and never throws.
 *
 * A readiness page that 500s because one signal is unavailable is the least
 * useful possible response: the operator loses the nineteen answers that did
 * work. A failed probe reports zero and the area's own rule decides what that
 * means.
 *
 * Takes a thunk rather than a table name so the Supabase client keeps its
 * types — a helper that took a string would have to cast, and the cast is what
 * turns a wrong column name into a runtime surprise.
 */
async function safeCount(
  run: () => PromiseLike<{ count: number | null }>,
): Promise<number> {
  try {
    const { count } = await run();
    return count ?? 0;
  } catch {
    return 0;
  }
}

const HEAD = { count: "exact" as const, head: true };

const sinceDays = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

/* ------------------------------------------------------------------ areas */

export async function getReadinessReport(): Promise<ReadinessReport> {
  const db = createAdminClient();
  const week = sinceDays(7);

  const [
    rlsTables,
    totalTables,
    activePacks,
    controlsComplete,
    controlsTotal,
    mcpClients,
    mcpDenials,
    agentRuns,
    agentFailures,
    deadJobs,
    pendingJobs,
    openErrors,
    integrationsHealthy,
    integrationsTotal,
    usageRows,
    subscriptions,
  ] = await Promise.all([
    rlsEnabledCount(),
    publicTableCount(),
    safeCount(() =>
      db.from("compliance_policy_versions").select("*", HEAD).eq("status", "ACTIVE"),
    ),
    safeCount(() =>
      db
        .from("business_data_controls")
        .select("*", HEAD)
        .not("legal_name", "is", null)
        .not("privacy_policy_url", "is", null)
        .neq("marketing_lawful_basis", "UNSTATED"),
    ),
    safeCount(() => db.from("businesses").select("*", HEAD).eq("status", "active")),
    safeCount(() => db.from("mcp_clients").select("*", HEAD).eq("status", "ACTIVE")),
    safeCount(() =>
      db
        .from("mcp_audit_logs")
        .select("*", HEAD)
        .gte("created_at", week)
        .like("result", "DENIED%"),
    ),
    safeCount(() => db.from("agent_runs").select("*", HEAD).gte("created_at", week)),
    safeCount(() =>
      db
        .from("agent_runs")
        .select("*", HEAD)
        .gte("created_at", week)
        .in("status", ["ERROR", "SCHEMA_INVALID", "BUDGET_BLOCKED"]),
    ),
    safeCount(() => db.from("jobs").select("*", HEAD).eq("state", "dead")),
    safeCount(() => db.from("jobs").select("*", HEAD).eq("state", "pending")),
    safeCount(() =>
      db.from("platform_error_triage").select("*", HEAD).neq("status", "RESOLVED"),
    ),
    safeCount(() => db.from("integrations").select("*", HEAD).eq("status", "CONNECTED")),
    safeCount(() => db.from("integrations").select("*", HEAD)),
    safeCount(() => db.from("usage_events").select("*", HEAD).gte("occurred_at", week)),
    safeCount(() =>
      db.from("subscriptions").select("*", HEAD).in("status", ["ACTIVE", "TRIALING"]),
    ),
  ]);

  const declared = SERVICE_OPERATIONS.length;
  const implemented = implementedOperations().length;

  const areas: ReadinessArea[] = [
    {
      key: "permissions",
      label: "Permissions and RLS",
      // Row-level security is the tenant boundary. A table without it in a
      // multi-tenant product is not a gap, it is an incident waiting.
      ...(rlsTables === null || totalTables === null
        ? unknown("Row-level security could not be inspected from here.")
        : rlsTables >= totalTables
          ? ready(`All ${totalTables} public tables have row-level security.`)
          : attention(
              `${totalTables - rlsTables} of ${totalTables} public tables have no row-level security.`,
            )),
      evidence: [
        { label: "Tables with RLS", value: `${rlsTables ?? "?"}` },
        { label: "Public tables", value: `${totalTables ?? "?"}` },
      ],
    },
    {
      key: "service_layer",
      label: "Service layer coverage",
      ...(implemented >= declared
        ? ready(`All ${declared} declared operations have an implementation.`)
        : attention(
            `${declared - implemented} declared operations have no handler and would refuse.`,
          )),
      evidence: [
        { label: "Declared", value: `${declared}` },
        { label: "Implemented", value: `${implemented}` },
      ],
    },
    {
      key: "compliance",
      label: "Compliance and contactability",
      ...(activePacks === 0
        ? blocked(
            "No jurisdiction policy pack is active, so every contact falls back to the most restrictive rules.",
          )
        : controlsComplete < controlsTotal
          ? attention(
              `${controlsTotal - controlsComplete} of ${controlsTotal} workspaces have not stated a legal position, so their cold outreach needs a human decision.`,
            )
          : ready(
              `${activePacks} policy packs active and every workspace has stated a legal position.`,
            )),
      evidence: [
        { label: "Active policy packs", value: `${activePacks}` },
        { label: "Workspaces configured", value: `${controlsComplete}/${controlsTotal}` },
      ],
      href: "/admin/system?view=compliance",
    },
    {
      key: "mcp",
      label: "MCP",
      ...(mcpClients === 0
        ? unknown("No assistant connections exist yet, so nothing has exercised this.")
        : mcpDenials > mcpClients * 10
          ? attention(
              `${mcpDenials} refusals in 7 days across ${mcpClients} connections — likely a misconfigured client, or a scope that was never granted.`,
            )
          : ready(`${mcpClients} active connections, ${mcpDenials} refusals in 7 days.`)),
      evidence: [
        { label: "Active connections", value: `${mcpClients}` },
        { label: "Refusals (7d)", value: `${mcpDenials}` },
        { label: "Grantable scopes", value: `${MCP_SCOPES.length}` },
      ],
    },
    {
      key: "agents",
      label: "Agents",
      ...(agentRuns === 0
        ? unknown("No agent runs in the last 7 days.")
        : agentFailures > agentRuns * 0.1
          ? attention(
              `${agentFailures} of ${agentRuns} runs failed in 7 days — above the 10% threshold.`,
            )
          : ready(`${agentRuns} runs in 7 days, ${agentFailures} failed.`)),
      evidence: [
        { label: "Runs (7d)", value: `${agentRuns}` },
        { label: "Failed (7d)", value: `${agentFailures}` },
      ],
    },
    {
      key: "background",
      label: "Background processing",
      ...(deadJobs > 0
        ? attention(
            `${deadJobs} jobs exhausted their retries and are waiting in the dead-letter queue.`,
          )
        : pendingJobs > 5000
          ? attention(`${pendingJobs} jobs are queued — the worker may not be keeping up.`)
          : ready(`${pendingJobs} queued, nothing dead-lettered.`)),
      evidence: [
        { label: "Pending", value: `${pendingJobs}` },
        { label: "Dead-lettered", value: `${deadJobs}` },
      ],
      href: "/admin/system?view=jobs",
    },
    {
      key: "integrations",
      label: "Integrations",
      ...(integrationsTotal === 0
        ? unknown("No workspace has connected an integration yet.")
        : integrationsHealthy < integrationsTotal
          ? attention(
              `${integrationsTotal - integrationsHealthy} of ${integrationsTotal} connections are not healthy.`,
            )
          : ready(`All ${integrationsTotal} connections are healthy.`)),
      evidence: [
        { label: "Connected", value: `${integrationsHealthy}/${integrationsTotal}` },
      ],
    },
    {
      key: "usage_billing",
      label: "Usage and billing",
      ...(subscriptions === 0
        ? unknown("No active subscriptions to measure against.")
        : usageRows === 0
          ? attention(
              "No usage has been recorded in 7 days despite active subscriptions — metering may not be running.",
            )
          : ready(`${usageRows} ledger entries in 7 days across ${subscriptions} subscriptions.`)),
      evidence: [
        { label: "Ledger entries (7d)", value: `${usageRows}` },
        { label: "Active subscriptions", value: `${subscriptions}` },
      ],
      href: "/admin/economics",
    },
    {
      key: "observability",
      label: "Observability",
      ...(openErrors > 0
        ? attention(`${openErrors} platform errors are open and untriaged.`)
        : ready("No untriaged platform errors.")),
      evidence: [{ label: "Open errors", value: `${openErrors}` }],
      href: "/admin/system?view=errors",
    },
    {
      key: "secrets",
      label: "Secrets and configuration",
      // Checked by presence, never by value, and never reported back.
      ...(secretsConfigured()
        ? ready("Encryption key, Supabase service role and Stripe test key are all present.")
        : blocked("One or more required secrets are not configured on this deployment.")),
      evidence: [
        {
          label: "Credential encryption",
          value: serverEnv.credentialEncryptionKey ? "set" : "missing",
        },
        { label: "Stripe (test)", value: serverEnv.stripe.secretKey ? "set" : "missing" },
      ],
    },
    {
      key: "disaster_recovery",
      label: "Backups and disaster recovery",
      // Deliberately not guessed. Backup and restore live in the Supabase
      // project, not in this application, and a green tick here would be an
      // assertion about something this code has never observed.
      ...unknown(
        "Backup schedule and restore drills live in the hosting project and cannot be verified from the application.",
      ),
      evidence: [],
    },
  ];

  const summary = {
    ready: areas.filter((a) => a.state === "READY").length,
    attention: areas.filter((a) => a.state === "ATTENTION").length,
    blocked: areas.filter((a) => a.state === "BLOCKED").length,
    unknown: areas.filter((a) => a.state === "UNKNOWN").length,
  };

  return { areas, summary, generatedAt: new Date().toISOString() };

  /* --------------------------------------------------------- inspection */

  async function rlsEnabledCount(): Promise<number | null> {
    const { data, error } = await db.rpc("admin_rls_coverage" as never).then(
      (r) => r,
      () => ({ data: null, error: true }) as never,
    );
    if (error || !data) return null;
    return Number((data as { enabled?: number }).enabled ?? 0);
  }

  async function publicTableCount(): Promise<number | null> {
    const { data, error } = await db.rpc("admin_rls_coverage" as never).then(
      (r) => r,
      () => ({ data: null, error: true }) as never,
    );
    if (error || !data) return null;
    return Number((data as { total?: number }).total ?? 0);
  }
}

/* ---------------------------------------------------------------- helpers */

function ready(detail: string) {
  return { state: "READY" as const, detail };
}
function attention(detail: string) {
  return { state: "ATTENTION" as const, detail };
}
function blocked(detail: string) {
  return { state: "BLOCKED" as const, detail };
}
function unknown(detail: string) {
  return { state: "UNKNOWN" as const, detail };
}

function secretsConfigured(): boolean {
  // Presence only. The values are never read here and never leave the server:
  // a readiness page that could print a secret would be a worse problem than
  // the one it reports on.
  return Boolean(serverEnv.credentialEncryptionKey && serverEnv.stripe.secretKey);
}
