import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/session";
import { getAffiliate, getPublicPlan } from "@/lib/affiliates/queries";
import { formatMinor } from "@/lib/affiliates/types";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = {
  title: "Partner programme | ClientTurn",
  description:
    "Earn recurring commission introducing UK home-service businesses to ClientTurn.",
};

export const dynamic = "force-dynamic";

export default async function AffiliateProgrammePage() {
  const [user, affiliate, plan] = await Promise.all([
    getUser(),
    getAffiliate(),
    getPublicPlan(),
  ]);

  // Someone who already has a partner account belongs in the portal, not on
  // the sales page for a programme they have already joined.
  if (affiliate) redirect("/affiliates/app");

  const rate =
    plan?.commissionType === "FLAT_AMOUNT"
      ? formatMinor(plan.flatAmountMinor ?? 0, plan.currency)
      : `${plan?.percent ?? 20}%`;

  const recurring =
    plan?.commissionType === "RECURRING_PERCENT" && !plan.recurringMonths;

  return (
    <div className="min-h-dvh bg-surface-sunken">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <Logo href="/" height={24} />
          <Link
            href="/affiliates/login"
            className="text-[13px] text-content-muted underline-offset-4 hover:text-content hover:underline"
          >
            Partner sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        <div className="max-w-2xl">
          <p className="text-[12.5px] font-medium uppercase tracking-wide text-content-accent">
            Partner programme
          </p>
          <h1 className="mt-2 text-[32px] font-semibold leading-tight text-content sm:text-[40px]">
            Earn {rate} {recurring ? "for as long as they stay" : "on what they pay"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-content-secondary">
            ClientTurn answers a home-service business&rsquo;s leads in seconds,
            qualifies them against rules the owner sets, and books the ones worth
            booking. If you work with tradespeople, installers or home-service
            firms, introducing them earns you recurring commission.
          </p>
        </div>

        <dl className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            label="Commission"
            value={rate}
            detail={
              plan?.commissionType === "FIRST_PAYMENT_PERCENT"
                ? "Of the first payment"
                : recurring
                  ? "Of every payment, for life"
                  : plan?.recurringMonths
                    ? `Of every payment for ${plan.recurringMonths} months`
                    : "Per paying customer"
            }
          />
          <Fact
            label="Attribution window"
            value={`${plan?.cookieWindowDays ?? 60} days`}
            detail="From click to sign-up"
          />
          <Fact
            label="Hold period"
            value={`${plan?.holdDays ?? 30} days`}
            detail="Then commission is confirmed"
          />
          <Fact
            label="Minimum payout"
            value={formatMinor(plan?.minimumPayoutMinor ?? 5000, plan?.currency ?? "GBP")}
            detail="Balances carry over"
          />
        </dl>

        <section className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div className="space-y-6">
            <Block title="How it works">
              <ol className="space-y-2.5 text-[14px] leading-relaxed text-content-secondary">
                <Step n={1}>
                  Apply below. We review every partner by hand, usually within two
                  working days.
                </Step>
                <Step n={2}>
                  Create tracked links in your partner portal, and share them
                  however you already reach people.
                </Step>
                <Step n={3}>
                  When someone signs up through your link and starts paying, you
                  earn commission on what they pay.
                </Step>
                <Step n={4}>
                  Commission is confirmed after the hold period and paid in the
                  next monthly payout run.
                </Step>
              </ol>
            </Block>

            <Block title="What we ask">
              <ul className="space-y-2 text-[14px] leading-relaxed text-content-secondary">
                <Bullet>
                  Promote honestly. Use the copy and assets we supply, and do not
                  make claims about results we have not published.
                </Bullet>
                <Bullet>
                  No paid search on our brand name, and no coupon or cashback
                  sites — those take credit for customers who were already coming.
                </Bullet>
                <Bullet>
                  No spam. Anything you send on your own list has to comply with
                  UK marketing law, the same as ours does.
                </Bullet>
                <Bullet>
                  Signing up through your own link earns nothing.
                </Bullet>
              </ul>
            </Block>

            <Block title="What you can and cannot see">
              <p className="text-[14px] leading-relaxed text-content-secondary">
                Your portal shows sign-up dates, plan and lifetime revenue for the
                businesses you referred, so you can see what is working. It never
                shows their account, their data, their leads or their contacts —
                a partner is not a member of a customer&rsquo;s workspace.
              </p>
            </Block>
          </div>

          <div id="apply" className="lg:sticky lg:top-6 lg:self-start">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-xs">
              <h2 className="text-[16px] font-semibold text-content">
                {user ? "Finish your application" : "Apply to join"}
              </h2>

              {user ? (
                <>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">
                    You have a ClientTurn account. There are four short questions
                    left — about two minutes — and then a person reviews it.
                  </p>
                  <Link
                    href="/affiliates/onboarding"
                    className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-[14px] font-medium text-on-primary shadow-xs hover:bg-primary-hover"
                  >
                    Continue your application
                  </Link>
                </>
              ) : (
                <>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-content-muted">
                    Create a partner account, tell us about your audience, and a
                    person reviews your application — usually within two working
                    days.
                  </p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-content-subtle">
                    A partner account is not a subscription, and it does not set
                    up a workspace. It exists to track your links and pay you.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href="/affiliates/signup"
                      className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-[14px] font-medium text-on-primary shadow-xs hover:bg-primary-hover"
                    >
                      Create partner account
                    </Link>
                    <Link
                      href="/affiliates/login?redirect=/affiliates"
                      className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-4 text-[14px] text-content shadow-xs hover:bg-surface-hover"
                    >
                      Sign in
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-[12px] text-content-subtle sm:px-6">
          <p>
            Commission terms are set per partner and confirmed when your
            application is approved.
          </p>
          <div className="flex gap-4">
            <Link href="/terms" className="underline-offset-4 hover:underline">
              Terms
            </Link>
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Fact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-xs">
      <dt className="text-[12px] text-content-muted">{label}</dt>
      <dd className="mt-1 text-[22px] font-semibold text-content">{value}</dd>
      <dd className="text-[11.5px] text-content-subtle">{detail}</dd>
    </div>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[17px] font-semibold text-content">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-50 text-[11.5px] font-semibold text-content-accent">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-[9px] size-1.5 shrink-0 rounded-full bg-accent-500"
      />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
