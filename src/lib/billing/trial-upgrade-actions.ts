"use server";

import { workspaceCan } from "@/lib/auth/permissions";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireWorkspace } from "@/lib/auth/session";
import { runOperation } from "@/lib/services";
import type { EndTrialNowData } from "@/lib/services/operations/billing";
import {
  getTrialUpgradeOffer,
  previewTrialConversion,
  type TrialUpgradeOffer,
} from "./trial-upgrade-service";

/**
 * The trial "Upgrade now" modal's server calls. Thin: the conversion itself
 * is the `billing.end_trial_now` service operation, which checks the role,
 * the caller and the confirmation again whatever the page did.
 */

export type OfferResult =
  | { ok: true; offer: TrialUpgradeOffer; canUpgrade: boolean }
  | { ok: false; error: string };

/** The plan chosen at checkout, the interval and the card, for the modal. */
export async function loadTrialUpgradeOfferAction(): Promise<OfferResult> {
  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace) return { ok: false, error: "Sign in again to continue." };
  if (!hasRole(workspace.role, "admin")) return { ok: false, error: "Only an owner or admin can see billing." };
  try {
    const offer = await getTrialUpgradeOffer(workspace.businessId);
    if (!offer) return { ok: false, error: "This workspace is not in a trial." };
    return { ok: true, offer, canUpgrade: await workspaceCan(workspace, "manage_billing") };
  } catch {
    return { ok: false, error: "Your plan could not be loaded. Try again." };
  }
}

const planSchema = z.object({ plan: z.enum(["starter", "growth", "pro"]) });

export type PreviewResult = { ok: true; amountDueMinor: number; currency: string } | { ok: false };

/** Stripe's figure for today's charge, for the confirmation step. */
export async function previewTrialUpgradeAction(input: unknown): Promise<PreviewResult> {
  const parsed = planSchema.safeParse(input);
  if (!parsed.success) return { ok: false };
  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace || !(await workspaceCan(workspace, "manage_billing"))) return { ok: false };
  const preview = await previewTrialConversion(workspace.businessId, parsed.data.plan);
  return preview ? { ok: true, ...preview } : { ok: false };
}

export type EndTrialActionResult =
  | { ok: true; data: EndTrialNowData; warning?: string }
  | {
      ok: false;
      error: string;
      /** SCA: Stripe's hosted invoice page, or the billing portal when there is none. */
      actionUrl?: string;
      requiresAction?: boolean;
    };

const endSchema = z.object({ plan: z.enum(["starter", "growth", "pro"]), nonce: z.string().min(8).max(64) });

export async function endTrialNowAction(input: unknown): Promise<EndTrialActionResult> {
  const parsed = endSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan to continue." };

  const workspace = await requireWorkspace().catch(() => null);
  if (!workspace) return { ok: false, error: "Sign in again to continue." };

  const result = await runOperation<EndTrialNowData>("billing.end_trial_now", parsed.data, {
    businessId: workspace.businessId,
    userId: workspace.userId,
    role: workspace.role,
    caller: "UI",
    correlationId: randomUUID(),
    idempotencyKey: parsed.data.nonce,
    // The modal's confirmation step, which states the amount, is the
    // confirmation this FINANCIAL operation needs.
    confirmed: true,
  });

  if (!result.success) {
    const sca = result.warnings.find((warning) => warning.code === "requires_action");
    if (sca) {
      return {
        ok: false,
        error: result.message,
        requiresAction: true,
        actionUrl: sca.message || "/api/billing/portal",
      };
    }
    return { ok: false, error: result.message };
  }

  revalidatePath("/app", "layout");
  return { ok: true, data: result.data, warning: result.warnings[0]?.message };
}
