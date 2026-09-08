"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { transition } from "./campaigns/lifecycle";
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

/*
 * `createCampaignAction` and its `campaignSchema` were removed here.
 *
 * They were the second way to create a campaign. The wizard under
 * `find-leads/campaigns/wizard/*` -> `outreach/campaign-actions.ts` is the
 * first, and the only one anything calls: it persists a DRAFT with version
 * snapshots, validates before launch, reserves budget, estimates the audience
 * and holds A/B variants. This one did none of that and had no caller left --
 * `CampaignBuilder` is now two entry points that link to the wizard.
 *
 * Deleted rather than left dead, because an unused second creator of the same
 * row is not harmless: it is a working, discoverable, differently-validated
 * path that the next person to need "create a campaign" will find and wire up.
 */

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

/**
 * Pause or stop a campaign, from the list controls.
 *
 * Delegates to `transition()` rather than writing `status` itself. It used to
 * write it directly, gated on `.in("status", ["ACTIVE","PAUSED","READY","DRAFT"])`
 * -- a different rule from the one `campaign-state.ts` publishes, and a looser
 * one. It permitted DRAFT -> PAUSED and READY -> PAUSED, both of which the
 * transition table forbids, so a campaign could be put into a state the state
 * machine says is unreachable and every reader downstream trusts is impossible.
 *
 * There is now one implementation of "what may follow what", and the second
 * caller is a caller rather than a second copy of the rules. The signature is
 * kept positional because `campaign-controls.tsx` calls it that way; the shape
 * is not what was wrong with it.
 */
export async function setCampaignStatusAction(
  campaignId: unknown,
  status: unknown,
): Promise<ActionResult> {
  const id = z.uuid().safeParse(campaignId);
  const next = z.enum(["PAUSED", "STOPPED"]).safeParse(status);
  if (!id.success || !next.success) return fail("That campaign could not be updated.");

  const access = await requireOutreachAdmin();
  if (!access.ok) return access;

  const result = await transition({
    businessId: access.workspace.businessId,
    campaignId: id.data,
    to: next.data,
    actorUserId: access.workspace.userId,
  });

  // The refusal is surfaced rather than flattened into a generic failure: "a
  // draft cannot be paused" tells an operator what to do next, and "that
  // campaign could not be updated" does not.
  if (!result.ok) return fail(result.error);

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

