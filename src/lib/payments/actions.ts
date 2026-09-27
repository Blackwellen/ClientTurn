"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { canStoreSecrets, sealSecret } from "@/lib/security/secret-box";
import { isSchemaLag } from "@/lib/supabase/schema-lag";
import { runOperation } from "@/lib/services";
import { db } from "./store";

/**
 * Settings -> Connections: the two payment endpoints (the direct-sale loop).
 * Owner/admin only, checked here on the server. Secrets are sealed before
 * they reach Postgres and are never returned -- except the order-paid secret
 * the moment it is generated, once, to the person who generated it.
 */

export type PaymentsActionResult =
  | { ok: true; secret?: string; message?: string }
  | { ok: false; error: string };

const NOT_INSTALLED = "Payment confirmation is not switched on for this workspace yet (database update 0143).";

async function admin() {
  try {
    return await requireRole("admin");
  } catch {
    return null;
  }
}

async function upsertEndpoint(
  businessId: string,
  userId: string,
  kind: "STRIPE" | "ORDER_PAID",
  patch: Record<string, unknown>,
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const { data: existing, error: readError } = await db()
    .from("payment_endpoints")
    .select("id")
    .eq("business_id", businessId)
    .eq("kind", kind)
    .maybeSingle();
  if (readError) return { ok: false, error: isSchemaLag(readError) ? NOT_INSTALLED : "The payment settings could not be read." };
  if (existing) {
    const { error } = await db().from("payment_endpoints").update(patch).eq("id", (existing as { id: string }).id);
    return error ? { ok: false, error: "The payment settings could not be saved." } : { ok: true, created: false };
  }
  const { error } = await db()
    .from("payment_endpoints")
    .insert({ business_id: businessId, kind, created_by: userId, ...patch });
  return error ? { ok: false, error: "The payment endpoint could not be created." } : { ok: true, created: true };
}

/** Creates the workspace's Stripe endpoint so its URL can be copied into Stripe. */
export async function createStripePaymentEndpoint(): Promise<PaymentsActionResult> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can set up payments." };
  const result = await upsertEndpoint(workspace.businessId, workspace.userId, "STRIPE", { active: true });
  if (!result.ok) return result;
  if (result.created) {
    await recordAudit({
      businessId: workspace.businessId,
      actorUserId: workspace.userId,
      action: "payments.endpoint_created",
      entityType: "business",
      entityId: workspace.businessId,
      metadata: { kind: "STRIPE" },
    });
  }
  revalidatePath("/app/settings");
  return { ok: true };
}

const stripeSecretSchema = z
  .string()
  .trim()
  .regex(/^whsec_[A-Za-z0-9+/=_-]{16,200}$/, "Paste the endpoint's signing secret: it starts with whsec_.");

/** Saves the Stripe endpoint's signing secret (whsec_...), sealed. */
export async function saveStripeSigningSecret(input: unknown): Promise<PaymentsActionResult> {
  const parsed = stripeSecretSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "That secret is not valid." };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can set up payments." };
  if (!canStoreSecrets()) return { ok: false, error: "This deployment cannot store secrets yet (CREDENTIAL_ENCRYPTION_KEY is not set)." };

  const result = await upsertEndpoint(workspace.businessId, workspace.userId, "STRIPE", {
    secret_ciphertext: sealSecret(parsed.data),
    active: true,
    last_error: null,
  });
  if (!result.ok) return result;
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "payments.secret_saved",
    entityType: "business",
    entityId: workspace.businessId,
    // Never the secret, nor any part of it.
    metadata: { kind: "STRIPE" },
  });
  revalidatePath("/app/settings");
  return { ok: true, message: "Signing secret saved." };
}

/**
 * Generates (or rotates) the order-paid webhook secret and returns it once.
 * The old secret stops working immediately.
 */
export async function rotateOrderPaidSecret(): Promise<PaymentsActionResult> {
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can set up payments." };
  if (!canStoreSecrets()) return { ok: false, error: "This deployment cannot store secrets yet (CREDENTIAL_ENCRYPTION_KEY is not set)." };

  const secret = `ctop_${randomBytes(32).toString("hex")}`;
  const result = await upsertEndpoint(workspace.businessId, workspace.userId, "ORDER_PAID", {
    secret_ciphertext: sealSecret(secret),
    active: true,
    last_error: null,
  });
  if (!result.ok) return result;
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: result.created ? "payments.endpoint_created" : "payments.secret_rotated",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: { kind: "ORDER_PAID" },
  });
  revalidatePath("/app/settings");
  return { ok: true, secret };
}

/** Switches an endpoint off (deliveries are refused) or back on. */
export async function setPaymentEndpointActive(input: unknown): Promise<PaymentsActionResult> {
  const parsed = z.object({ kind: z.enum(["STRIPE", "ORDER_PAID"]), active: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That change is not valid." };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can change payments." };
  const { error } = await db()
    .from("payment_endpoints")
    .update({ active: parsed.data.active })
    .eq("business_id", workspace.businessId)
    .eq("kind", parsed.data.kind);
  if (error) return { ok: false, error: isSchemaLag(error) ? NOT_INSTALLED : "That change could not be saved." };
  await recordAudit({
    businessId: workspace.businessId,
    actorUserId: workspace.userId,
    action: "payments.endpoint_toggled",
    entityType: "business",
    entityId: workspace.businessId,
    metadata: parsed.data,
  });
  revalidatePath("/app/settings");
  return { ok: true };
}

/** Link-to-lead, through the registry operation (audited there). */
export async function linkPaymentToLeadAction(input: unknown): Promise<PaymentsActionResult> {
  const parsed = z.object({ paymentId: z.uuid(), leadId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose the lead who paid." };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can link payments." };
  const result = await runOperation("payment.link_to_lead", parsed.data, {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI",
    // The card asked the person to confirm before calling this.
    confirmed: true,
    correlationId: randomUUID(),
  });
  if (!result.success) return { ok: false, error: result.message };
  revalidatePath("/app/settings");
  revalidatePath(`/app/leads/${parsed.data.leadId}`);
  return { ok: true, message: "Payment linked. The lead is being marked won." };
}

/** Lead search for the link-to-lead picker, through the registry. */
export async function searchLeadsForPayment(
  query: string,
): Promise<{ ok: true; leads: { id: string; name: string; email: string | null }[] } | { ok: false; error: string }> {
  const parsed = z.string().trim().min(2).max(120).safeParse(query);
  if (!parsed.success) return { ok: true, leads: [] };
  const workspace = await admin();
  if (!workspace) return { ok: false, error: "Only an owner or admin can link payments." };
  const result = await runOperation<{ leads: { id: string; first_name: string | null; last_name: string | null; email: string | null }[] }>(
    "lead.search",
    { query: parsed.data, limit: 8 },
    {
      businessId: workspace.businessId,
      userId: workspace.userId,
      role: workspace.role,
      caller: "UI",
      correlationId: randomUUID(),
    },
  );
  if (!result.success) return { ok: false, error: result.message };
  return {
    ok: true,
    leads: result.data.leads.map((lead) => ({
      id: lead.id,
      name: [lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email || "Unnamed lead",
      email: lead.email,
    })),
  };
}
