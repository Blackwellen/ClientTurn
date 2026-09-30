import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActiveWorkspace, requireUser } from "@/lib/auth/session";
import { onboardingIncomplete } from "@/lib/app/health";
import { getEntitlements } from "@/lib/billing/entitlements";
import { confirmCheckoutReturn } from "@/lib/billing/subscription-sync";
import { requestOrigin } from "@/lib/billing/terms-acceptance";
import { needsCheckout, trialOffer, type SubscriptionRowLike } from "@/lib/billing/lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceWorkspaceSecurity } from "@/lib/auth/account-security";
import { planOrder, ANNUAL_DISCOUNT_PERCENT } from "@/lib/billing/plans";
import { TERMS_PATH } from "@/lib/marketing/terms-version";
import { Logo } from "@/components/ui/logo";
import { signOut } from "@/lib/auth/actions";
import { ToastProvider } from "@/components/ui/toast";
import { StartTrialPicker, type PickerPlan } from "@/components/billing/start-trial-picker";

export const metadata: Metadata = {
  title: "Start your free trial",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

async function signOutToLogin() {
  "use server";
  await signOut("/login");
}

const searchSchema = z.object({
  session_id: z.string().regex(/^cs_[A-Za-z0-9_]+$/).optional(),
  checkout: z.enum(["cancelled"]).optional(),
  // The plan picked on /pricing before signing up (8.29): highlighted, nothing more.
  plan: z.enum(["starter", "growth", "pro"]).optional(),
});

/**
 * Card-first trial (8.10). Every app route sends a workspace here until Stripe
 * has confirmed a subscription: a verified card on file and the terms
 * accepted in Checkout. Also the resubscribe page for a workspace whose
 * subscription ended.
 */
export default async function StartTrialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const workspace = await getActiveWorkspace();
  if (!workspace) redirect("/onboarding");
  // Two-factor and idle timeout before billing, as on every /app page
  // (surface QA 2026-09-30).
  await enforceWorkspaceSecurity(workspace.businessId);

  const raw = await searchParams;
  const params = searchSchema.safeParse({
    session_id: typeof raw.session_id === "string" ? raw.session_id : undefined,
    checkout: typeof raw.checkout === "string" ? raw.checkout : undefined,
    plan: typeof raw.plan === "string" ? raw.plan : undefined,
  });
  const query = params.success ? params.data : {};

  const destination = onboardingIncomplete(workspace) ? "/onboarding" : "/app";
  let confirmError: string | null = null;

  // Back from Checkout: read the session from Stripe and apply it now, so the
  // owner is not left waiting on the webhook. Redirect rather than re-read in
  // this render (a read after a write here returns the old row).
  if (query.session_id && workspace.role === "owner") {
    const origin = requestOrigin(await headers());
    const result = await confirmCheckoutReturn({
      sessionId: query.session_id,
      businessId: workspace.businessId,
      ip: origin.ip,
      userAgent: origin.userAgent,
    });
    if (result.ok && result.status !== "INCOMPLETE") redirect(destination);
    confirmError = result.ok
      ? "Stripe is still confirming your card. This usually takes a few seconds; refresh the page."
      : result.reason === "not_complete"
        ? "Checkout was not completed. Choose a plan to try again."
        : "We could not find that checkout. Choose a plan to start again.";
  }

  const entitlements = await getEntitlements(workspace.businessId);
  if (!needsCheckout(entitlements.state) && entitlements.state !== "CANCELLED") {
    redirect(destination);
  }

  const { data: row } = await createAdminClient()
    .from("subscriptions")
    .select(
      "plan, status, trial_ends_at, stripe_subscription_id, current_period_start, current_period_end, lead_limit, user_limit, whatsapp_enabled, campaigns_enabled, ai_assist_allowed",
    )
    .eq("business_id", workspace.businessId)
    .maybeSingle();
  const offer = trialOffer((row as SubscriptionRowLike | null) ?? null, new Date());

  const plans: PickerPlan[] = planOrder()
    .filter((plan) => plan.selfServe && plan.monthlyPrice !== null)
    .map((plan) => ({
      id: plan.id as PickerPlan["id"],
      name: plan.name,
      tagline: plan.tagline,
      monthlyPrice: plan.monthlyPrice!,
      yearlyPrice: plan.yearlyPrice!,
      // The plan they picked on /pricing takes the highlight, when there is one.
      recommended: query.plan ? plan.id === query.plan : plan.recommended,
      features: plan.features.slice(0, 5),
    }));

  const heading =
    entitlements.state === "CANCELLED"
      ? "Resubscribe to carry on"
      : offer.kind === "trial_days"
        ? `Start your ${offer.days}-day free trial`
        : "Choose a plan to carry on";

  return (
    <ToastProvider>
      <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Logo href={null} height={48} />
          {/* A way out: this page has no app shell, so without it the only
              exit for someone not ready to add a card was closing the tab. */}
          <form action={signOutToLogin} className="flex items-center gap-3 text-[12.5px] text-[#96a1b3]">
            <span className="hidden max-w-[240px] truncate sm:inline">{user.email}</span>
            <button
              type="submit"
              className="rounded-[9px] border border-[rgba(150,170,190,0.35)] px-3 py-1.5 font-medium text-[#eef2f7] transition-colors hover:border-[var(--auth-lime)] hover:text-[var(--auth-lime)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--auth-lime)]"
            >
              Sign out
            </button>
          </form>
        </div>
        <h1 className="mt-6 text-[26px] font-semibold tracking-[-0.01em] text-[#f8fafc]">{heading}</h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-[#96a1b3]">
          {offer.kind === "trial_days"
            ? `Add a card to start. Nothing is charged today: Stripe checks the card is valid, and the first payment is taken when the ${offer.days}-day trial ends unless you cancel before then. We email you three days before.`
            : entitlements.state === "CANCELLED"
              ? "Your data is intact. Choose a plan and your workspace picks up where it left off."
              : "Your free trial has ended. Choose a plan to carry on; your setup and data are all still here."}{" "}
          You will be asked to accept the{" "}
          <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-[var(--auth-lime)] underline">
            Terms of Service
          </a>{" "}
          in checkout.
        </p>

        {query.checkout === "cancelled" && !confirmError ? (
          <p role="status" className="mt-4 rounded-[10px] border border-[rgba(150,170,190,0.28)] px-3 py-2 text-[13px] text-[#cbd5e1]">
            Checkout was cancelled. Nothing was charged; choose a plan when you are ready.
          </p>
        ) : null}
        {confirmError ? (
          <p role="alert" className="mt-4 rounded-[10px] border border-[rgba(245,158,11,0.45)] px-3 py-2 text-[13px] text-[#fcd34d]">
            {confirmError}
          </p>
        ) : null}

        {workspace.role === "owner" ? (
          <StartTrialPicker
            plans={plans}
            trialDays={offer.kind === "trial_days" ? offer.days : null}
            annualDiscountPercent={ANNUAL_DISCOUNT_PERCENT}
          />
        ) : (
          <div className="mt-8 rounded-[14px] border border-[rgba(150,170,190,0.28)] bg-[#0a131b] p-6">
            <p className="text-[14px] text-[#e2e8f0]">
              Only the workspace owner can start the subscription. Ask them to sign in and add a card;
              you will have access as soon as they do.
            </p>
            <p className="mt-2 text-[12px] text-[#96a1b3]">Signed in as {user.email}</p>
          </div>
        )}
      </main>
    </ToastProvider>
  );
}
