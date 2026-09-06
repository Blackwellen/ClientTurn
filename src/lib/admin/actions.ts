"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { headers } from "next/headers";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit, type AuditAction } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { getPlatformOperator } from "./guard";
import { MAX_SAFE_RETRIES, parseEventId } from "./events";
import { runProviderProbes, recordProbeResults } from "./providers";
import { searchAdmin } from "./search";
import { referenceFor } from "./errors-shared";
import {
  clearStepUp,
  grantStepUp,
  requireStepUp,
  StepUpRequiredError,
} from "./step-up";
import type { AdminSearchResult, ErrorTriageStatus } from "./types";

export type AdminActionResult =
  | { ok: true; message?: string; redirectTo?: string }
  | { ok: false; error: string; code?: "step_up_required" | "forbidden" };

const GENERIC_SIGN_IN_ERROR =
  "Those credentials are not valid for platform operations.";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

async function operatorOrForbidden() {
  const operator = await getPlatformOperator();
  if (!operator) throw new Error("FORBIDDEN");
  return operator;
}

/**
 * Wraps a mutating operation so every platform-admin action is authorised,
 * step-up protected, timed and audited by the same path. A missing or expired
 * step-up surfaces as a result the UI can act on rather than an exception.
 */
async function guarded(
  action: AuditAction,
  run: (operator: { id: string; email: string }) => Promise<AdminActionResult>,
): Promise<AdminActionResult> {
  const startedAt = Date.now();
  try {
    const operator = await operatorOrForbidden();
    await requireStepUp(operator.id);
    const result = await run(operator);
    if (!result.ok) {
      await recordAudit({
        businessId: null,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action,
        metadata: {
          outcome: "failed",
          reason: result.error,
          duration_ms: Date.now() - startedAt,
        },
      });
    }
    return result;
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return {
        ok: false,
        code: "step_up_required",
        error: "Confirm your password to continue.",
      };
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      // Recorded without an actor: the caller was not a platform admin.
      await recordAudit({
        businessId: null,
        actorType: "platform_admin",
        action: "admin.action_denied",
        metadata: { attempted: action, duration_ms: Date.now() - startedAt },
      });
      return { ok: false, code: "forbidden", error: "Not permitted." };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Action failed.",
    };
  }
}

/* ----------------------------------------------------------------- auth --- */

export async function adminSignIn(
  _previous: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { ok: false, error: GENERIC_SIGN_IN_ERROR };
  }

  const limit = await checkRateLimit("admin:signin", clientIdentifier(await headers()));
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please wait and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    await recordAudit({
      businessId: null,
      actorType: "platform_admin",
      action: "admin.login_failed",
      metadata: { email: parsed.data.email },
    });
    return { ok: false, error: GENERIC_SIGN_IN_ERROR };
  }

  const service = createAdminClient();
  const { data: profile } = await service
    .from("profiles")
    .select("platform_role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profile?.platform_role !== "platform_admin") {
    await supabase.auth.signOut();
    await recordAudit({
      businessId: null,
      actorUserId: data.user.id,
      actorType: "platform_admin",
      action: "admin.login_failed",
      metadata: { email: parsed.data.email, reason: "not_platform_admin" },
    });
    return { ok: false, error: GENERIC_SIGN_IN_ERROR };
  }

  // The password was just entered, so this login opens the step-up window.
  await grantStepUp(data.user.id);

  await recordAudit({
    businessId: null,
    actorUserId: data.user.id,
    actorType: "platform_admin",
    action: "admin.login",
    metadata: { email: parsed.data.email },
  });

  return { ok: true, redirectTo: "/admin" };
}

export async function adminSignOut(): Promise<AdminActionResult> {
  const operator = await getPlatformOperator();
  const supabase = await createClient();
  await clearStepUp();
  await supabase.auth.signOut();

  if (operator) {
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.logout",
    });
  }

  return { ok: true, redirectTo: "/admin/login" };
}

export async function confirmStepUp(
  _previous: AdminActionResult | null,
  formData: FormData,
): Promise<AdminActionResult> {
  const operator = await getPlatformOperator();
  if (!operator) return { ok: false, code: "forbidden", error: "Not permitted." };

  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Enter your password." };

  const limit = await checkRateLimit("admin:stepup", operator.id);
  if (!limit.allowed) {
    return { ok: false, error: "Too many attempts. Please wait and try again." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: operator.email,
    password,
  });

  if (error) {
    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.step_up_failed",
    });
    return { ok: false, error: "That password was not accepted." };
  }

  await grantStepUp(operator.id);
  await recordAudit({
    businessId: null,
    actorUserId: operator.id,
    actorType: "platform_admin",
    action: "admin.step_up",
  });

  return { ok: true, message: "Confirmed for the next 30 minutes." };
}

/* ------------------------------------------------------ support actions --- */

const uuid = z.string().uuid();

export async function suspendWorkspace(
  businessId: string,
  reason: string,
): Promise<AdminActionResult> {
  return guarded("admin.workspace_suspended", async (operator) => {
    const id = uuid.parse(businessId);
    const service = createAdminClient();

    const { data: before } = await service
      .from("businesses")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    if (!before) return { ok: false, error: "That workspace no longer exists." };
    if (before.status === "suspended") {
      return { ok: false, error: "That workspace is already suspended." };
    }

    const { error } = await service
      .from("businesses")
      .update({ status: "suspended" })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.workspace_suspended",
      entityType: "business",
      entityId: id,
      metadata: {
        outcome: "ok",
        reason: reason.slice(0, 500),
        status_before: before.status,
        status_after: "suspended",
      },
    });

    revalidatePath("/admin/customers");
    return { ok: true, message: "Workspace suspended." };
  });
}

export async function unsuspendWorkspace(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded("admin.workspace_unsuspended", async (operator) => {
    const id = uuid.parse(businessId);
    const service = createAdminClient();

    const { data: before } = await service
      .from("businesses")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!before) return { ok: false, error: "That workspace no longer exists." };
    if (before.status !== "suspended") {
      return { ok: false, error: "That workspace is not suspended." };
    }

    const { error } = await service
      .from("businesses")
      .update({ status: "active" })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.workspace_unsuspended",
      entityType: "business",
      entityId: id,
      metadata: { outcome: "ok", status_before: "suspended", status_after: "active" },
    });

    revalidatePath("/admin/customers");
    return { ok: true, message: "Workspace restored." };
  });
}

export async function resendOnboardingEmail(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded("admin.onboarding_email_resent", async (operator) => {
    const id = uuid.parse(businessId);

    // Bounded per operator *and* per workspace so a repeated click cannot
    // become a mail-bomb in a customer's inbox.
    const limit = await checkRateLimit(
      "admin:onboarding_resend",
      `${operator.id}:${id}`,
    );
    if (!limit.allowed) {
      return {
        ok: false,
        error: `Onboarding email already resent recently. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`,
      };
    }

    const service = createAdminClient();
    const { data: owner } = await service
      .from("business_members")
      .select("user_id")
      .eq("business_id", id)
      .eq("role", "owner")
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!owner) {
      return {
        ok: false,
        error: "This workspace has no active owner to send onboarding to.",
      };
    }

    const { data: profile } = await service
      .from("profiles")
      .select("email")
      .eq("id", owner.user_id)
      .maybeSingle();

    if (!profile?.email) {
      return { ok: false, error: "The workspace owner has no email address on file." };
    }

    await enqueue(
      "notification.send",
      { kind: "onboarding_resend", businessId: id, userId: owner.user_id },
      {
        businessId: id,
        // Same operator, same workspace, same minute is the same request.
        idempotencyKey: `onboarding_resend:${id}:${Math.floor(Date.now() / 60000)}`,
      },
    );

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.onboarding_email_resent",
      entityType: "business",
      entityId: id,
      metadata: { outcome: "ok", recipient_user_id: owner.user_id },
    });

    return { ok: true, message: "Onboarding email resent." };
  });
}

export async function triggerIntegrationHealthCheck(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded("admin.integration_health_check", async (operator) => {
    const id = uuid.parse(businessId);

    const limit = await checkRateLimit("admin:health_check", `${operator.id}:${id}`);
    if (!limit.allowed) {
      return { ok: false, error: "Health check already running. Try again shortly." };
    }

    await enqueue(
      "integration.health_check",
      { businessId: id, requestedBy: "platform_admin" },
      {
        businessId: id,
        priority: 10,
        idempotencyKey: `integration.health_check:${id}:${Math.floor(Date.now() / 60000)}`,
      },
    );

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.integration_health_check",
      entityType: "business",
      entityId: id,
      metadata: { outcome: "ok" },
    });

    revalidatePath("/admin/customers");
    return {
      ok: true,
      message: "Health check queued. Connection statuses update as each provider answers.",
    };
  });
}

/* ---------------------------------------------------------- safe retry --- */

/**
 * The one retry path. The client sends an opaque event id and nothing else:
 * the server resolves the source, re-reads current state, decides whether a
 * replay is safe, enforces the attempt ceiling and enqueues with an
 * idempotency key. No arbitrary provider side effect can be driven from here.
 */
export async function safeRetryEvent(eventId: string): Promise<AdminActionResult> {
  return guarded("admin.event_retried", async (operator) => {
    const parsed = parseEventId(String(eventId).slice(0, 64));
    if (!parsed) return { ok: false, error: "That event reference is not valid." };

    const limit = await checkRateLimit("admin:event_retry", operator.id);
    if (!limit.allowed) {
      return { ok: false, error: "Too many retries in a short period. Pause and try again." };
    }

    if (parsed.source === "message") {
      return {
        ok: false,
        error:
          "Message sends cannot be replayed from here — the follow-up engine owns re-delivery.",
      };
    }

    const service = createAdminClient();

    if (parsed.source === "webhook") {
      const { data: event } = await service
        .from("webhook_events")
        .select("id, provider, external_event_id, status, attempts, business_id")
        .eq("id", parsed.rowId)
        .maybeSingle();

      if (!event) return { ok: false, error: "That event no longer exists." };
      if (event.status !== "failed") {
        return {
          ok: false,
          error: "Only a failed delivery can be replayed. This event is not in a failed state.",
        };
      }
      if (event.attempts >= MAX_SAFE_RETRIES) {
        return {
          ok: false,
          error: `This event has reached the replay limit of ${MAX_SAFE_RETRIES} attempts.`,
        };
      }

      const nextAttempt = event.attempts + 1;
      // Conditional on the state we read, so two operators clicking at once
      // cannot both queue a replay.
      const { error } = await service
        .from("webhook_events")
        .update({
          status: "received",
          attempts: nextAttempt,
          last_error: null,
          processed_at: null,
        })
        .eq("id", event.id)
        .eq("status", "failed");
      if (error) return { ok: false, error: error.message };

      await enqueue(
        "webhook.replay",
        {
          webhookEventId: event.id,
          provider: event.provider,
          externalEventId: event.external_event_id,
        },
        {
          businessId: event.business_id,
          priority: 10,
          idempotencyKey: `webhook.replay:${event.id}:${nextAttempt}`,
        },
      );

      await recordAudit({
        businessId: event.business_id,
        actorUserId: operator.id,
        actorType: "platform_admin",
        action: "admin.event_retried",
        entityType: "webhook_event",
        entityId: event.id,
        metadata: {
          outcome: "ok",
          provider: event.provider,
          attempt: nextAttempt,
          external_event_id: event.external_event_id,
        },
      });

      revalidatePath("/admin/system");
      return { ok: true, message: "Event re-queued for processing." };
    }

    const { data: job } = await service
      .from("jobs")
      .select("id, type, state, attempts, max_attempts, business_id")
      .eq("id", parsed.rowId)
      .maybeSingle();

    if (!job) return { ok: false, error: "That job no longer exists." };
    if (job.state !== "failed" && job.state !== "dead") {
      return {
        ok: false,
        error: "Only a failed or dead-lettered job can be replayed.",
      };
    }
    if (job.attempts >= MAX_SAFE_RETRIES) {
      return {
        ok: false,
        error: `This job has reached the replay limit of ${MAX_SAFE_RETRIES} attempts.`,
      };
    }

    // Job handlers re-read current state before any external call, so putting
    // the existing row back to pending replays it without duplicating work.
    const { error } = await service
      .from("jobs")
      .update({
        state: "pending",
        run_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        max_attempts: Math.max(job.max_attempts, job.attempts + 1),
      })
      .eq("id", job.id)
      .in("state", ["failed", "dead"]);
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      businessId: job.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.event_retried",
      entityType: "job",
      entityId: job.id,
      metadata: {
        outcome: "ok",
        job_type: job.type,
        state_before: job.state,
        attempt: job.attempts + 1,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: "Job re-queued for processing." };
  });
}

/* -------------------------------------------------------- error triage --- */

const triageInput = z.object({
  fingerprint: z.string().regex(/^[0-9a-f]{8}$/),
  area: z.string().min(1).max(60),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  status: z.enum(["OPEN", "INVESTIGATING", "RESOLVED", "IGNORED"]),
  businessId: z.string().uuid().nullable(),
});

/**
 * Local triage only. Sentry — when one is configured — remains the source of
 * truth for the issue itself; nothing here writes back to it.
 */
export async function setErrorStatus(input: {
  fingerprint: string;
  area: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  status: ErrorTriageStatus;
  businessId: string | null;
}): Promise<AdminActionResult> {
  return guarded("admin.error_triaged", async (operator) => {
    const parsed = triageInput.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: "That error reference is not valid." };
    }

    const service = createAdminClient();
    const resolved = parsed.data.status === "RESOLVED";

    const { error } = await service.from("platform_error_triage").upsert(
      {
        fingerprint: parsed.data.fingerprint,
        business_id: parsed.data.businessId,
        area: parsed.data.area,
        severity: parsed.data.severity,
        status: parsed.data.status,
        reference: referenceFor(parsed.data.area, parsed.data.fingerprint),
        resolved_by: resolved ? operator.id : null,
        resolved_at: resolved ? new Date().toISOString() : null,
      } as never,
      { onConflict: "fingerprint" },
    );
    if (error) return { ok: false, error: error.message };

    await recordAudit({
      businessId: parsed.data.businessId,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.error_triaged",
      entityType: "platform_error",
      metadata: {
        outcome: "ok",
        fingerprint: parsed.data.fingerprint,
        status_after: parsed.data.status,
        area: parsed.data.area,
      },
    });

    revalidatePath("/admin/system");
    return {
      ok: true,
      message: resolved ? "Error marked resolved." : "Error status updated.",
    };
  });
}

/* ------------------------------------------------------ provider health --- */

export async function refreshProviderHealth(): Promise<AdminActionResult> {
  return guarded("admin.provider_health_refreshed", async (operator) => {
    const limit = await checkRateLimit("admin:provider_refresh", operator.id);
    if (!limit.allowed) {
      return {
        ok: false,
        error: "Provider health was refreshed moments ago. Try again shortly.",
      };
    }

    const startedAt = Date.now();
    const results = await runProviderProbes();
    const service = createAdminClient();
    await recordProbeResults(service, results);

    await recordAudit({
      businessId: null,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.provider_health_refreshed",
      metadata: {
        outcome: "ok",
        duration_ms: Date.now() - startedAt,
        // Statuses only. No response body, header or credential is recorded.
        statuses: Object.fromEntries(
          results.map((row) => [row.provider, row.status]),
        ),
      },
    });

    revalidatePath("/admin/system");
    revalidatePath("/admin");

    const down = results.filter((row) => row.status === "DOWN").length;
    const degraded = results.filter((row) => row.status === "DEGRADED").length;
    return {
      ok: true,
      message:
        down + degraded === 0
          ? "All monitored providers answered normally."
          : `Refreshed: ${degraded} degraded, ${down} not answering.`,
    };
  });
}

/* --------------------------------------------------------------- search --- */

export async function runAdminSearch(
  query: string,
): Promise<{ ok: true; results: AdminSearchResult[] } | { ok: false; error: string }> {
  const operator = await getPlatformOperator();
  if (!operator) return { ok: false, error: "Not permitted." };

  const limit = await checkRateLimit("admin:search", operator.id);
  if (!limit.allowed) return { ok: false, error: "Slow down a moment." };

  try {
    return { ok: true, results: await searchAdmin(String(query).slice(0, 80)) };
  } catch {
    return { ok: false, error: "Search is unavailable right now." };
  }
}
