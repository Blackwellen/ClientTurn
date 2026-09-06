"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, type ActiveWorkspace } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { assertCapability } from "@/lib/billing/v4-entitlements";
import { EntitlementError } from "@/lib/billing/entitlements";
import { loadEmailAccount } from "@/lib/email/store";

/**
 * Acquisition campaign configuration.
 *
 * The dispatcher in `dispatch.ts` could already send; nothing could create the
 * campaign it sends from, which meant auto-contact was unreachable in practice.
 * These are the actions that close that loop.
 *
 * Launching is the moment a workspace starts emailing strangers, so it is the
 * one place where every precondition is checked together rather than trusted
 * from whatever created the row.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

function refresh() {
  revalidatePath("/app/find-leads");
}

async function requireOutreachAdmin(): Promise<
  { ok: true; workspace: ActiveWorkspace } | { ok: false; error: string }
> {
  let workspace: ActiveWorkspace;
  try {
    workspace = await requireRole("admin");
  } catch {
    return fail("Only owners and admins can manage acquisition campaigns.");
  }
  try {
    // Cold email is a separate capability from sourcing: a plan can include
    // finding prospects without including emailing them.
    await assertCapability(workspace.businessId, "cold_email");
  } catch (error) {
    if (error instanceof EntitlementError) return fail(error.message);
    return fail("Cold email campaigns are unavailable right now.");
  }
  return { ok: true, workspace };
}

/* ------------------------------------------------------- sender identity */

const senderSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  replyTo: z.string().trim().email().max(320).nullable().optional(),
  signatureText: z.string().trim().max(2000).nullable().optional(),
  /** Required for cold B2B email: who is writing, and where they are. */
  postalFooter: z.string().trim().min(10).max(500),
  dailySendCap: z.number().int().min(1).max(500),
});

/**
 * Creates a sending identity from the workspace's own connected mailbox.
 *
 * The address is taken from the connection rather than typed, because a sender
 * identity that does not match a mailbox we can actually send from is a
 * campaign that fails at the first message. It is created VERIFIED only when
 * the connection itself is healthy — otherwise it is UNVERIFIED and no cold
 * campaign will use it.
 */
export async function createSenderIdentityAction(
  input: unknown,
): Promise<ActionResult<{ id: string; status: string }>> {
  const parsed = senderSchema.safeParse(input);
  if (!parsed.success) {
    return fail(
      "Check the sender details. A postal address is required for cold email.",
    );
  }

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const account = await loadEmailAccount(access.workspace.businessId);
  if (!account) {
    return fail(
      "Connect a mailbox in Settings → Connections before creating a sending identity.",
    );
  }

  const admin = createAdminClient();

  // The address comes from the connection, never from the form: an identity
  // that does not match a mailbox we can send from fails on its first message.
  const fromEmail = account.config.fromEmail.trim().toLowerCase();
  if (!fromEmail) {
    return fail("The connected mailbox has no from address configured.");
  }

  // Healthy *and* able to send: an inbound-only connection cannot run a
  // campaign, and a stored password is what proves SMTP was set up.
  const healthy =
    account.status !== "ACTION_REQUIRED" &&
    account.status !== "DISCONNECTED" &&
    account.hasSmtpPassword;

  const { data, error } = await admin
    .from("sender_identities")
    .upsert(
      {
        business_id: access.workspace.businessId,
        email: fromEmail,
        display_name: parsed.data.displayName || account.config.fromName,
        reply_to: parsed.data.replyTo ?? account.config.replyTo,
        signature_text: parsed.data.signatureText ?? null,
        postal_footer: parsed.data.postalFooter,
        domain: fromEmail.split("@")[1] ?? null,
        daily_send_cap: parsed.data.dailySendCap,
        // Cold is opt-in and only offered once the mailbox is proven.
        cold_enabled: healthy,
        warm_enabled: true,
        active: true,
        status: healthy ? "VERIFIED" : "UNVERIFIED",
        verified_at: healthy ? new Date().toISOString() : null,
      },
      { onConflict: "business_id,email" },
    )
    .select("id, status")
    .single();

  if (error) return fail("That sending identity could not be saved.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "sender_identity.created",
    entityType: "sender_identity",
    entityId: data.id,
    metadata: { status: data.status },
  });

  refresh();
  return ok({ id: data.id, status: data.status });
}

/* ------------------------------------------------------------- campaign */

const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  senderIdentityId: z.uuid(),
  minimumGrade: z.enum(["A+", "A", "B", "C", "D"]),
  dailyContactCap: z.number().int().min(1).max(500),
  prospectsPerRun: z.number().int().min(1).max(200),
  reviewBeforeOutreach: z.boolean(),
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(20).max(5000),
});

/**
 * Creates a campaign together with its first sequence step.
 *
 * They are created together because a campaign with no step cannot send, and a
 * half-configured campaign that looks ready is exactly how an accidental
 * launch happens. The campaign starts as DRAFT regardless — launching is a
 * separate, deliberate act.
 */
export async function createCampaignAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return fail("Check the campaign details — a subject and a message are required.");
  }

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();

  const { data: sender } = await admin
    .from("sender_identities")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("id", parsed.data.senderIdentityId)
    .maybeSingle();

  if (!sender) return fail("That sending identity could not be found.");

  const { data: campaign, error } = await admin
    .from("outreach_campaigns")
    .insert({
      business_id: access.workspace.businessId,
      name: parsed.data.name,
      status: "DRAFT",
      sender_identity_id: sender.id,
      minimum_grade: parsed.data.minimumGrade,
      review_before_outreach: parsed.data.reviewBeforeOutreach,
      daily_contact_cap: parsed.data.dailyContactCap,
      prospects_per_run: parsed.data.prospectsPerRun,
      created_by: access.workspace.userId,
    })
    .select("id")
    .single();

  if (error || !campaign) return fail("That campaign could not be created.");

  const { data: sequence } = await admin
    .from("outreach_sequences")
    .insert({
      business_id: access.workspace.businessId,
      campaign_id: campaign.id,
      version: 1,
      status: "PUBLISHED",
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (sequence) {
    await admin.from("outreach_steps").insert({
      business_id: access.workspace.businessId,
      sequence_id: sequence.id,
      position: 1,
      delay_seconds: 0,
      channel: "EMAIL",
      subject_template: parsed.data.subject,
      body_template: parsed.data.body,
      enabled: true,
    });

    await admin
      .from("outreach_campaigns")
      .update({ active_sequence_id: sequence.id })
      .eq("business_id", access.workspace.businessId)
      .eq("id", campaign.id);
  }

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "outreach_campaign.created",
    entityType: "outreach_campaign",
    entityId: campaign.id,
    metadata: { name: parsed.data.name },
  });

  refresh();
  return ok({ id: campaign.id });
}

/**
 * The launch gate.
 *
 * Everything that must be true before a workspace emails a stranger is checked
 * here, in one place, at the moment it matters — not spread across whatever
 * created the rows. A campaign that cannot satisfy all of it stays DRAFT and
 * says which condition failed.
 */
export async function launchCampaignAction(
  campaignId: unknown,
): Promise<ActionResult<{ status: string }>> {
  const id = z.uuid().safeParse(campaignId);
  if (!id.success) return fail("That campaign could not be found.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("outreach_campaigns")
    .select("id, status, sender_identity_id, active_sequence_id, review_before_outreach")
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .maybeSingle();

  if (!campaign) return fail("That campaign could not be found.");
  if (campaign.status === "ACTIVE") return ok({ status: "ACTIVE" });
  if (!["DRAFT", "READY", "PAUSED"].includes(campaign.status)) {
    return fail("This campaign has finished and cannot be launched again.");
  }

  const { data: sender } = await admin
    .from("sender_identities")
    .select("status, cold_enabled, active, postal_footer")
    .eq("business_id", access.workspace.businessId)
    .eq("id", campaign.sender_identity_id ?? "")
    .maybeSingle();

  if (!sender || !sender.active) {
    return fail("This campaign has no active sending identity.");
  }
  if (sender.status !== "VERIFIED") {
    return fail(
      "The sending identity is not verified yet. Test the mailbox connection first.",
    );
  }
  if (!sender.cold_enabled) {
    return fail("This sending identity is not enabled for cold outreach.");
  }
  if (!sender.postal_footer) {
    return fail("Cold email needs a postal address on the sending identity.");
  }

  const { data: step } = await admin
    .from("outreach_steps")
    .select("id")
    .eq("business_id", access.workspace.businessId)
    .eq("sequence_id", campaign.active_sequence_id ?? "")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (!step) return fail("This campaign has no message to send.");

  await admin
    .from("outreach_campaigns")
    .update({
      status: "ACTIVE",
      launch_validated_at: new Date().toISOString(),
      launched_by: access.workspace.userId,
      launched_at: new Date().toISOString(),
      paused_at: null,
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data);

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: "outreach_campaign.launched",
    entityType: "outreach_campaign",
    entityId: id.data,
  });

  // A campaign set to review-before-outreach is active but does not send; the
  // dispatcher refuses it, so queueing would be a wasted job.
  if (!campaign.review_before_outreach) {
    await enqueue(
      "outreach.dispatch",
      { campaignId: id.data, businessId: access.workspace.businessId },
      {
        businessId: access.workspace.businessId,
        idempotencyKey: `outreach.dispatch:launch:${id.data}`,
      },
    );
  }

  refresh();
  return ok({ status: "ACTIVE" });
}

export async function setCampaignStatusAction(
  campaignId: unknown,
  status: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(campaignId);
  const next = z.enum(["PAUSED", "STOPPED"]).safeParse(status);
  if (!id.success || !next.success) return fail("That campaign could not be updated.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const admin = createAdminClient();
  const { data } = await admin
    .from("outreach_campaigns")
    .update({
      status: next.data,
      ...(next.data === "PAUSED"
        ? { paused_at: new Date().toISOString() }
        : { stopped_at: new Date().toISOString() }),
    })
    .eq("business_id", access.workspace.businessId)
    .eq("id", id.data)
    .in("status", ["ACTIVE", "PAUSED", "READY", "DRAFT"])
    .select("id");

  if (!data?.length) return fail("That campaign could not be updated.");

  await recordAudit({
    businessId: access.workspace.businessId,
    actorUserId: access.workspace.userId,
    action: next.data === "PAUSED" ? "outreach_campaign.paused" : "outreach_campaign.stopped",
    entityType: "outreach_campaign",
    entityId: id.data,
  });

  refresh();
  return ok(undefined);
}
