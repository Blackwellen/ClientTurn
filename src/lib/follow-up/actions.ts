"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { assertEntitlement, EntitlementError } from "@/lib/billing/entitlements";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getMessagingProvider } from "@/lib/messaging/registry";
import { normalisePhone } from "@/lib/messaging/types";
import { ProviderNotConfiguredError } from "@/lib/messaging/types";
import { findUnknownMergeFields, renderTemplate } from "@/lib/automation/scheduler";
import { TIMEZONES } from "@/lib/settings/types";
import { getTestSendContext } from "./queries";
import { testSendSchema, type TestSendInput } from "./types";

export type ActionResult = { ok: true } | { ok: false; error: string };

function fail(error: string): ActionResult {
  return { ok: false, error };
}

async function admin(): Promise<ActiveWorkspace | null> {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

/**
 * The business timezone every quiet-hours window is interpreted in. It lives
 * on `businesses`, shared with Settings → Workspace, so changing it here and
 * changing it there mean the same thing.
 */
export async function saveFollowUpTimezone(input: {
  timezone: string;
}): Promise<ActionResult> {
  const parsed = z.object({ timezone: z.enum(TIMEZONES) }).safeParse(input);
  if (!parsed.success) return fail("Choose a timezone from the list.");

  const workspace = await admin();
  if (!workspace) return fail("You do not have permission to change the timezone.");

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("businesses")
    .update({ timezone: parsed.data.timezone })
    .eq("id", workspace.businessId);

  if (error) return fail("Could not save the timezone.");

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.timezone_changed",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: { timezone: parsed.data.timezone },
  });

  revalidatePath("/app/follow-up");
  revalidatePath("/app/settings/workspace");
  return { ok: true };
}

/**
 * Sends one test message straight to the person configuring the sequence.
 *
 * It deliberately does NOT enter the lead pipeline: no lead row, no
 * conversation, no automation run. Merge fields are resolved server-side from
 * workspace values, so the client can never inject a rendered body, and the
 * provider is reached through the same abstraction the worker uses.
 */
export async function sendFollowUpTest(
  input: TestSendInput,
): Promise<ActionResult> {
  const parsed = testSendSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Check the test message.");
  }

  const workspace = await admin();
  if (!workspace) {
    return fail("You do not have permission to send test messages.");
  }

  // Bounded per workspace: a test send reaches a real carrier.
  const limit = await checkRateLimit("followup:test", workspace.businessId);
  if (!limit.allowed) {
    return fail(
      `Too many test messages. Try again in ${Math.max(
        1,
        Math.ceil(limit.retryAfterSeconds / 60),
      )} minute(s).`,
    );
  }

  try {
    await assertEntitlement(workspace.businessId);
    if (parsed.data.channel === "whatsapp") {
      await assertEntitlement(workspace.businessId, "whatsapp");
    }
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Messaging is unavailable right now.");
  }

  const unknown = findUnknownMergeFields(parsed.data.body);
  if (unknown.length > 0) {
    return fail(
      `Unknown merge ${unknown.length === 1 ? "field" : "fields"}: ${unknown
        .map((token) => `{{${token}}}`)
        .join(", ")}.`,
    );
  }

  const to = normalisePhone(parsed.data.to);
  if (!to) return fail("Enter a valid phone number.");

  const context = await getTestSendContext(workspace.businessId);
  const body = renderTemplate(parsed.data.body, {
    first_name: "there",
    business_name: context.businessName,
    service_name: "your service",
    booking_link: context.bookingLink ?? "your booking link",
    business_phone: context.businessPhone ?? "your number",
  });

  const provider = getMessagingProvider();

  let result;
  try {
    result = await provider.send({
      businessId: workspace.businessId,
      to,
      body,
      channel: parsed.data.channel,
      // Distinct per attempt: a test is meant to be repeatable, but the key
      // still stops a double-click from sending twice within the same second.
      sendKey: `test:${workspace.businessId}:${Math.floor(Date.now() / 1000)}`,
    });
  } catch (error) {
    if (error instanceof ProviderNotConfiguredError) {
      return fail(
        "Connect your messaging provider first. Add your Twilio credentials in Settings → Connections.",
      );
    }
    // Provider errors are logged server-side only; never surfaced verbatim in
    // case they carry credentials or account identifiers.
    console.error("[follow-up] test send failed", error);
    return fail("Could not reach the messaging provider. Try again shortly.");
  }

  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "automation.test_message_sent",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: {
      channel: parsed.data.channel,
      provider: result.ok ? result.provider : "unknown",
      delivered: result.ok,
    },
  });

  if (!result.ok) {
    return fail(
      result.errorMessage ||
        "The provider rejected the test message. Check your messaging settings.",
    );
  }

  if (result.provider === "stub") {
    return fail(
      "Sent with the test provider, not a real network. Add your Twilio sender number in Settings → Connections and real sending switches on with no other change.",
    );
  }

  return { ok: true };
}
