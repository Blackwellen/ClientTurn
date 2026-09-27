import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe, priceIdFor } from "@/lib/billing/stripe";
import { applyStripeSubscription } from "@/lib/billing/subscription-sync";
import { endTrialNow, isValidNonce } from "@/lib/billing/end-trial";
import { releaseHeldSmsReplies } from "@/lib/billing/trial-upgrade-service";
import { defineOperation, ServiceError, type HandlerInput } from "../runtime";

/**
 * `billing.end_trial_now` -- "Upgrade now: start your plan today".
 *
 * The declaration (registry.ts) makes it owner-only, UI-only and FINANCIAL,
 * so the runtime has already refused anyone else and demanded the modal's
 * confirmation before this runs. Here:
 *
 *   1. the Stripe trial is ended on the existing subscription, charging the
 *      saved card now (end-trial.ts: re-read first, idempotent per nonce);
 *   2. on success the local subscription row is mirrored from Stripe's
 *      response, so entitlements switch to the paid plan on this request
 *      rather than when the webhook lands (which then reconciles, a no-op);
 *   3. AI SMS replies held at the trial's limit are released back through the
 *      normal send path, where every gate runs again.
 *
 * A decline or an SCA requirement is a refusal (the runtime audits it as
 * `.denied`): the workspace stays in its trial and nothing is charged. For
 * SCA the hosted invoice URL travels as a warning with code
 * `requires_action`, since a failure envelope carries no payload.
 */

const schema = z.object({
  plan: z.enum(["starter", "growth", "pro"]),
  nonce: z.string().refine(isValidNonce, "The confirmation expired. Close this and try again."),
});

type Args = z.infer<typeof schema>;

export type EndTrialNowData = {
  status: "converted" | "already_active";
  plan: Args["plan"];
  amountPaidMinor: number | null;
  currency: string | null;
  released: { leadsReleased: number; messagesRequeued: number };
};

defineOperation("billing.end_trial_now", {
  schema,
  async run({ args, context }: HandlerInput<Args>) {
    if (!context.userId) throw new ServiceError("FORBIDDEN_ROLE", "Upgrading needs a signed-in owner.");

    const { data, error } = await (createAdminClient() as unknown as SupabaseClient)
      .from("subscriptions")
      .select("plan, status, stripe_subscription_id")
      .eq("business_id", context.businessId)
      .maybeSingle();
    if (error) throw new ServiceError("UNAVAILABLE", "Your subscription could not be read. Try again.");
    const row = data as { plan: string; status: string; stripe_subscription_id: string | null } | null;
    if (!row?.stripe_subscription_id) {
      throw new ServiceError("CONFLICT", "There is no trial subscription to start. Open Billing to choose a plan.");
    }

    const outcome = await endTrialNow({
      stripe,
      businessId: context.businessId,
      subscriptionId: row.stripe_subscription_id,
      targetPlan: args.plan,
      nonce: args.nonce,
      priceIdFor: (plan, interval) => priceIdFor(plan, interval),
    });

    if (!outcome.ok) {
      switch (outcome.kind) {
        case "requires_action":
          throw new ServiceError("PROVIDER_FAILED", outcome.message, [
            { code: "requires_action", message: outcome.hostedInvoiceUrl ?? "" },
          ]);
        case "declined":
          throw new ServiceError("PROVIDER_FAILED", outcome.message, [{ code: "declined", message: outcome.code ?? "" }]);
        case "not_trialing":
          throw new ServiceError("CONFLICT", outcome.message);
        case "wrong_workspace":
          throw new ServiceError("FORBIDDEN_WORKSPACE", outcome.message);
        case "no_price":
          throw new ServiceError("UNAVAILABLE", outcome.message);
        default:
          throw new ServiceError("PROVIDER_FAILED", outcome.message);
      }
    }

    // Mirror Stripe's answer now. A failure here is not a failed upgrade --
    // the card has been charged and the webhook will reconcile -- so it is a
    // warning, not a refusal.
    const warnings: { code: string; message: string }[] = [];
    try {
      await applyStripeSubscription(outcome.subscription, { eventType: "billing.end_trial_now" });
    } catch (syncError) {
      console.error("[billing.end_trial_now] local mirror failed; webhook will reconcile", {
        businessId: context.businessId,
        message: syncError instanceof Error ? syncError.message : String(syncError),
      });
      warnings.push({
        code: "sync_pending",
        message: "Your plan is active in Stripe. It can take a minute to show here.",
      });
    }

    const released = await releaseHeldSmsReplies(context.businessId, args.nonce);

    const result: EndTrialNowData = {
      status: outcome.kind,
      plan: args.plan,
      amountPaidMinor: outcome.kind === "converted" ? outcome.amountPaidMinor : null,
      currency: outcome.kind === "converted" ? outcome.currency : null,
      released: { leadsReleased: released.leadsReleased, messagesRequeued: released.messagesRequeued },
    };
    return {
      data: result,
      entityId: row.stripe_subscription_id,
      before: { plan: row.plan, status: row.status },
      after: {
        plan: args.plan,
        status: outcome.subscription.status,
        amount_paid_minor: result.amountPaidMinor,
        held_replies_requeued: released.messagesRequeued,
      },
      warnings,
    };
  },
});
