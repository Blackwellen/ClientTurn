"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Check,
  Coins,
  Heart,
  TrendingUp,
  Users,
} from "lucide-react";
import { describeRate, type ProgrammePolicy } from "@/lib/affiliates/programme";
import { AppFrame } from "@/components/marketing/public/home/app-frames";
import { PartnerFrame } from "@/components/marketing/public/home/partner-frame";

/**
 * The affiliate programme hero.
 *
 * Page-scoped under `.afp`, following the same pattern as the two product
 * pages: a designed surface owns its own stylesheet rather than bending the
 * shared evaluation-page primitives, which is what keeps a bespoke layout from
 * dragging every other public page around with it.
 *
 * Two honesty constraints shape the content:
 *
 *   * the partner dashboard on the right is an **example** of the portal, and
 *     says so, because a figure like "£2,840 total earnings" presented plainly
 *     would be an earnings claim the programme does not make;
 *   * the fourth benefit card does not claim a customer count. The approved
 *     design reads "loved by thousands of businesses", and there is no
 *     approved evidence for that, so it states what is actually true instead.
 */

const BENEFITS = [
  {
    icon: Users,
    title: "Attract new customers",
    body: "Introduce businesses to a platform that actually delivers.",
  },
  {
    icon: Coins,
    title: "Earn recurring commission",
    body: "Get paid for every customer you refer, with ongoing earnings.",
  },
  {
    icon: TrendingUp,
    title: "Make a real difference",
    body: "Help businesses respond faster, book more jobs and grow.",
  },
  {
    icon: Heart,
    title: "Partner with a trusted brand",
    body: "Clear terms, transparent tracking and a published payout policy.",
  },
] as const;

const ASSURANCES = ["Free to join", "Simple tracking", "Real commission"] as const;

export function AffiliateHero({
  policy,
  ctaHref,
  ctaLabel,
  signedIn,
}: {
  policy: ProgrammePolicy;
  ctaHref: string;
  ctaLabel: string;
  signedIn: boolean;
}) {
  const reduced = useReducedMotion();

  /**
   * An entrance that cannot strand its own content.
   *
   * The library writes `initial` into the server-rendered HTML, so `animate`
   * has to be unconditional: dropping it under reduced motion leaves the
   * markup at `opacity: 0` with nothing left to clear it. Reduced motion
   * collapses the duration instead, which lands on the same final state
   * without the movement.
   */
  const enter = (delay: number) => ({
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: reduced
      ? { duration: 0 }
      : { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section className="afp-hero" aria-labelledby="afp-hero-title">
      <span aria-hidden className="afp-texture" />
      <span aria-hidden className="afp-bloom" />

      <div className="afp-shell">
        <div className="afp-hero-grid">
          {/* ----------------------------------------------------- copy */}
          <div className="afp-hero-copy">
            <motion.p className="afp-eyebrow" {...enter(0)}>
              Affiliate programme
            </motion.p>
            <motion.h1 className="afp-h1" id="afp-hero-title" {...enter(0.06)}>
              Earn by helping <span>businesses grow.</span>
            </motion.h1>
            <motion.p className="afp-lead" {...enter(0.12)}>
              Join the ClientTurn affiliate programme and earn{" "}
              {describeRate(policy)} for every new customer you refer. It is a
              win for you, and a bigger future for the businesses you support.
            </motion.p>

            <motion.div className="afp-hero-actions" {...enter(0.18)}>
              <Link href={ctaHref} className="afp-btn afp-btn-primary">
                {ctaLabel}
                <ArrowRight size={17} aria-hidden />
              </Link>
              <Link
                href={signedIn ? "/affiliates/app" : "/affiliates/login"}
                className="afp-btn afp-btn-ghost"
              >
                Log in to Partner Portal
              </Link>
            </motion.div>

            <motion.ul className="afp-assurances" {...enter(0.24)}>
              {ASSURANCES.map((item) => (
                <li key={item}>
                  <span aria-hidden className="afp-tick">
                    <Check size={11} strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </motion.ul>
          </div>

          {/* ------------------------------------------ partner dashboard */}
          {/*
            Deliberately not animated in. This panel is the first thing a
            partner looks at, and an entrance animation that fails to settle
            leaves the dashboard invisible — which is exactly what happened.
            Content wins over choreography above the fold.
          */}
          <div className="afp-panel-wrap">
            {/*
              The same branded workspace frame the rest of the public site
              uses, showing the partner portal rather than a customer
              workspace. A bespoke card here made the partner funnel look like
              a different product from the one it is selling.
            */}
            <AppFrame label="The ClientTurn partner portal, showing clicks, signups, trials and paid customers, commission earned by month, a commission summary and recent referrals.">
              <PartnerFrame />
            </AppFrame>

            <p className="afp-panel-note">
              An example of the partner portal. Figures illustrate the
              interface — they are not a forecast of what you will earn.
            </p>

            {/* The design's handwritten aside. Decorative. */}
            <span aria-hidden className="afp-script">
              Real opportunities.
              <br />
              Real rewards.
              <svg width="66" height="42" viewBox="0 0 66 42" fill="none">
                <path
                  d="M64 3C52 20 32 30 4 34"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <path
                  d="M14 27L3 34l12 5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>
        </div>

        {/* ------------------------------------------------- benefit strip */}
        <motion.ul
          data-reveal
          className="afp-benefits"
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, amount: 0.3 }}
          variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.08 } } }}
        >
          {BENEFITS.map((benefit) => {
            const BenefitIcon = benefit.icon;
            return (
              <motion.li
                key={benefit.title}
                data-reveal-item
                variants={{
                  hidden: { opacity: 0, y: 14 },
                  shown: {
                    opacity: 1,
                    y: 0,
                    transition: reduced
                      ? { duration: 0 }
                      : { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                  },
                }}
              >
                <span aria-hidden className="afp-benefit-icon">
                  <BenefitIcon size={19} strokeWidth={2} />
                </span>
                <div>
                  <strong>{benefit.title}</strong>
                  <p>{benefit.body}</p>
                </div>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
    </section>
  );
}
