"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { headers } from "next/headers";
import { checkRateLimit, clientIdentifier } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { getPlatformOperator } from "./guard";
import {
  clearStepUp,
  grantStepUp,
  requireStepUp,
  StepUpRequiredError,
} from "./step-up";

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
 * Wraps a mutating operation so a missing or expired step-up surfaces as a
 * result the UI can act on rather than an unhandled exception.
 */
async function guarded(
  run: (operator: { id: string; email: string }) => Promise<AdminActionResult>,
): Promise<AdminActionResult> {
  try {
    const operator = await operatorOrForbidden();
    await requireStepUp(operator.id);
    return await run(operator);
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return {
        ok: false,
        code: "step_up_required",
        error: "Confirm your password to continue.",
      };
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
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
  return guarded(async (operator) => {
    const id = uuid.parse(businessId);
    const service = createAdminClient();

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
      metadata: { reason: reason.slice(0, 500) },
    });

    revalidatePath("/admin/customers");
    return { ok: true, message: "Workspace suspended." };
  });
}

export async function unsuspendWorkspace(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded(async (operator) => {
    const id = uuid.parse(businessId);
    const service = createAdminClient();

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
    });

    revalidatePath("/admin/customers");
    return { ok: true, message: "Workspace restored." };
  });
}

export async function resendOnboardingEmail(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded(async (operator) => {
    const id = uuid.parse(businessId);
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

    if (!owner) return { ok: false, error: "This workspace has no active owner." };

    await enqueue(
      "notification.send",
      { kind: "onboarding_resend", businessId: id, userId: owner.user_id },
      { businessId: id },
    );

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.onboarding_email_resent",
      entityType: "business",
      entityId: id,
    });

    return { ok: true, message: "Onboarding email queued." };
  });
}

export async function triggerIntegrationHealthCheck(
  businessId: string,
): Promise<AdminActionResult> {
  return guarded(async (operator) => {
    const id = uuid.parse(businessId);

    await enqueue(
      "integration.health_check",
      { businessId: id, requestedBy: "platform_admin" },
      { businessId: id, priority: 10 },
    );

    await recordAudit({
      businessId: id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.integration_health_check",
      entityType: "business",
      entityId: id,
    });

    return { ok: true, message: "Health check queued." };
  });
}

export async function retryWebhookEvent(
  webhookEventId: string,
): Promise<AdminActionResult> {
  return guarded(async (operator) => {
    const id = uuid.parse(webhookEventId);
    const service = createAdminClient();

    const { data: event } = await service
      .from("webhook_events")
      .select("id, provider, external_event_id, status, attempts, business_id")
      .eq("id", id)
      .maybeSingle();

    if (!event) return { ok: false, error: "That webhook event no longer exists." };

    // Replaying anything other than a failed delivery risks applying a state
    // transition twice, so the server re-checks rather than trusting the UI.
    if (event.status !== "failed") {
      return {
        ok: false,
        error: "Only failed events can be retried.",
      };
    }

    const { error } = await service
      .from("webhook_events")
      .update({
        status: "received",
        attempts: event.attempts + 1,
        last_error: null,
        processed_at: null,
      })
      .eq("id", id)
      .eq("status", "failed");

    if (error) return { ok: false, error: error.message };

    await enqueue(
      "webhook.replay",
      {
        webhookEventId: id,
        provider: event.provider,
        externalEventId: event.external_event_id,
      },
      {
        businessId: event.business_id,
        priority: 10,
        idempotencyKey: `webhook.replay:${id}:${event.attempts + 1}`,
      },
    );

    await recordAudit({
      businessId: event.business_id,
      actorUserId: operator.id,
      actorType: "platform_admin",
      action: "admin.webhook_retried",
      entityType: "webhook_event",
      entityId: id,
      metadata: {
        provider: event.provider,
        external_event_id: event.external_event_id,
      },
    });

    revalidatePath("/admin/system");
    return { ok: true, message: "Event re-queued for processing." };
  });
}
