"use server";

/**
 * Buying voice from Settings. Owner-only, checked here on the server: each
 * action can put a charge on the card. Nothing here grants anything -- the
 * Stripe webhook credits a paid minute pack (`voice-webhook.ts`) and mirrors
 * the number item into grants (`voice-subscription-sync.ts`).
 */

import { requireCapability, workspaceCan } from "@/lib/auth/permissions";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/session";
import { VOICE_MINUTE_PACKS } from "./plans";
import { addVoiceNumber, readVoicePurchaseState, removeProVoice, startVoicePackCheckout, type RemoveVoiceOutcome } from "./voice-checkout";
import type { VoiceNumberOutcome, VoicePackCheckoutOutcome, VoicePurchaseState } from "./voice-purchase";

const PACK_MINUTES = VOICE_MINUTE_PACKS.map((pack) => pack.minutes) as number[];

const packSchema = z.number().int().refine((minutes) => PACK_MINUTES.includes(minutes), "Unknown pack.");

/** Starts a one-off Stripe Checkout for a voice minute pack (100/250/500/1000). */
export async function startVoicePackCheckoutAction(minutes: unknown): Promise<VoicePackCheckoutOutcome> {
  const parsed = packSchema.safeParse(minutes);
  if (!parsed.success) return { ok: false, state: "invalid", error: "Choose a minute pack to continue." };

  const workspace = await requireCapability("manage_billing").catch(() => null);
  if (!workspace) {
    return { ok: false, state: "plan-limit-reached", error: "Only the workspace owner can buy voice minutes." };
  }
  return startVoicePackCheckout(workspace, parsed.data);
}

/** Adds the £11.99/month dedicated-number item to the live subscription (prorated). */
export async function addVoiceNumberAction(): Promise<VoiceNumberOutcome> {
  const workspace = await requireCapability("manage_billing").catch(() => null);
  if (!workspace) {
    return { ok: false, state: "plan-limit-reached", error: "Only the workspace owner can add a dedicated number." };
  }
  const outcome = await addVoiceNumber(workspace);
  if (outcome.ok && outcome.changed) revalidatePath("/app/settings");
  return outcome;
}

/** OD-2: removes the £100 voice item from Pro (prorated); the number is kept to the period end. Owner only. */
export async function removeProVoiceAction(): Promise<RemoveVoiceOutcome> {
  const workspace = await requireCapability("manage_billing").catch(() => null);
  if (!workspace) return { ok: false, error: "Only the workspace owner can change the subscription." };
  const outcome = await removeProVoice(workspace);
  if (outcome.ok) revalidatePath("/app/settings");
  return outcome;
}

/** What the voice panel may offer this user (any member may look; only the owner may buy). */
export async function getVoicePurchaseStateAction(): Promise<VoicePurchaseState> {
  const workspace = await requireRole("member");
  return readVoicePurchaseState({ businessId: workspace.businessId, isOwner: await workspaceCan(workspace, "manage_billing") });
}
