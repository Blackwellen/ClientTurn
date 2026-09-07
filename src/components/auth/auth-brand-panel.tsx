import * as React from "react";
import {
  Zap,
  CalendarCheck2,
  TrendingUp,
  Users,
  Lock,
  ShieldCheck,
  RotateCw,
  UserCheck2,
  Link2,
  Wallet,
  LineChart,
  Megaphone,
  BadgePoundSterling,
  ShieldAlert,
  Server,
  ScrollText,
} from "lucide-react";
import {
  AdminFrame,
  AppFrame,
  DashboardFrame,
  AcquisitionFrame,
} from "@/components/marketing/public/home/app-frames";
import { PartnerFrame } from "@/components/marketing/public/home/partner-frame";
import { Annotation } from "./annotation";
import { FeatureList, type AuthFeature } from "./feature-list";
import { TiltWrapper } from "./tilt-wrapper";
import { WorksWithStrip } from "./works-with-strip";

export type AuthVariant =
  | "signup"
  | "login"
  | "forgot"
  | "reset"
  | "partner"
  | "partner-signup"
  | "admin";

/**
 * The operator door is an internal tool, not a storefront. It borrows the same
 * shell and card so the product feels like one thing, but it never carries
 * customer marketing: no "trusted by" logos, no growth claims, no handwritten
 * note. Someone signing in here already works here.
 */
export function isInternalVariant(variant: AuthVariant): boolean {
  return variant === "admin";
}

const FEATURES: Record<AuthVariant, AuthFeature[]> = {
  signup: [
    { icon: Zap, title: "Instant responses", description: "Never miss a new enquiry." },
    { icon: CalendarCheck2, title: "More bookings", description: "Turn enquiries into scheduled jobs." },
    { icon: TrendingUp, title: "Clear visibility", description: "See what's happening across your lead journey." },
    { icon: Users, title: "Built for service businesses", description: "Simple lead conversion software for trade and service teams." },
  ],
  login: [
    { icon: Zap, title: "Pick up where you left off", description: "Your leads, bookings and progress are always here." },
    { icon: Users, title: "Follow up smarter", description: "Turn more enquiries into jobs with less effort." },
    { icon: TrendingUp, title: "See real results", description: "Track growth and revenue in real time." },
    { icon: CalendarCheck2, title: "More jobs, less admin", description: "A simpler way to run your business." },
  ],
  forgot: [
    { icon: Lock, title: "Secure", description: "Your account stays protected." },
    { icon: Zap, title: "Fast & easy", description: "Request a reset link in moments." },
    { icon: UserCheck2, title: "Back in business", description: "Continue where you left off." },
  ],
  reset: [
    { icon: Lock, title: "Secure", description: "Your account stays protected." },
    { icon: ShieldCheck, title: "Strong by default", description: "Choose a strong new password." },
    { icon: RotateCw, title: "Back in minutes", description: "Continue where you left off." },
  ],
  "partner-signup": [
    { icon: Megaphone, title: "Share what you already recommend", description: "Tracked links you can put anywhere you reach people." },
    { icon: Users, title: "Introduce the businesses you know", description: "Trade and service firms who need to answer leads faster." },
    { icon: BadgePoundSterling, title: "Earn on what they pay", description: "Recurring commission, confirmed after the refund hold." },
    { icon: Wallet, title: "Get paid on a schedule", description: "Monthly payouts once approved commission clears the minimum." },
  ],
  admin: [
    { icon: ShieldAlert, title: "Step-up on every change", description: "Confirm your password before anything mutates." },
    { icon: ScrollText, title: "Written to the audit log", description: "Every operator action is attributable." },
    { icon: Server, title: "Platform-wide visibility", description: "Customers, usage, margins and system health." },
  ],
  partner: [
    { icon: Link2, title: "Your referral links", description: "Share a link and see every click it earns." },
    { icon: Users, title: "Referrals you introduced", description: "Follow each one from signup to active." },
    { icon: LineChart, title: "Commission as it accrues", description: "See what has been approved and what is pending." },
    { icon: Wallet, title: "Payouts and statements", description: "Every payment, with the detail behind it." },
  ],
};

const COPY: Record<
  AuthVariant,
  { headline: [string, string]; support: string; annotation: string[] }
> = {
  signup: {
    headline: ["Turn leads into", "paying clients."],
    support:
      "ClientTurn helps trade and service businesses respond faster, follow up smarter, and book more jobs.",
    annotation: ["A smarter way", "to grow"],
  },
  login: {
    headline: ["Welcome back", "to ClientTurn."],
    support: "Respond faster, follow up smarter, and book more jobs — all in one place.",
    annotation: ["More leads", "More bookings", "More growth"],
  },
  forgot: {
    headline: ["Get back to", "growth, quickly."],
    support: "Reset your password and get back to your leads, bookings and activity.",
    annotation: ["A smarter way", "to grow"],
  },
  reset: {
    headline: ["A fresh start", "for what's next."],
    support: "Set a strong password and get back to your leads, bookings and revenue.",
    annotation: ["Secure today", "Stronger tomorrow"],
  },
  "partner-signup": {
    headline: ["Get paid for the", "introductions you make."],
    support:
      "Join the ClientTurn partner programme, share tracked links, and earn recurring commission on the businesses you introduce.",
    annotation: ["Share a link", "Earn on every", "customer"],
  },
  admin: {
    headline: ["Platform", "operations."],
    support:
      "Internal access for ClientTurn staff. Every sign-in and every change is recorded against your account.",
    annotation: ["Staff only"],
  },
  partner: {
    headline: ["Welcome back,", "partner."],
    support:
      "Sign in to the ClientTurn partner portal for your links, referrals, commission and payouts.",
    annotation: ["Your links", "Your referrals", "Your commission"],
  },
};

/**
 * Placement of the handwritten note.
 *
 * Every auth design puts it in the same place: top-right of the brand column,
 * clear of the headline, sweeping down-right into the top-left corner of the
 * tilted product frame. It is measured up from the column's vertical centre —
 * the same anchor the product visual uses — so the note and the frame it
 * points at move together instead of drifting apart between breakpoints.
 *
 * The offsets put the note's first line level with the top of the headline
 * beside it — measured, not guessed — so the two read as one row.
 */
const ANNOTATION_POSITION =
  "bottom-[256px] right-[18px] min-[1536px]:bottom-[281px] min-[1536px]:right-[42px] min-[1700px]:bottom-[321px] min-[1700px]:right-[102px]";

/**
 * The product visual beside the form.
 *
 * These are the same workspace rebuilds the marketing site uses, not a
 * separate set of mockups. Two different-looking "products" either side of a
 * sign-in button is how a site tells a visitor that one of them is a
 * marketing illustration — so the doors show the real thing.
 *
 * Sample workspace, sample names, sample figures, as the frames' own
 * documentation records. Nothing here is a customer or a result.
 */
const FRAME_LABEL = {
  dashboard:
    "ClientTurn lead conversion dashboard showing connection status, lead and booking counts, the conversion funnel and estimated pipeline.",
  acquisition:
    "ClientTurn Find Leads screen showing a natural-language target, the filters derived from it and a list of verified prospects with scores.",
  partner:
    "The ClientTurn partner portal, showing clicks, signups, trials and paid customers, commission earned by month, a commission summary and recent referrals.",
  admin:
    "The ClientTurn operations console, showing workspace, trial and subscription counts, recent workspaces and system health.",
} as const;

function ProductVisual({ variant }: { variant: AuthVariant }) {
  // `AppFrame` measures itself against its container, and this one is
  // absolutely positioned and `w-fit` — so the width has to be stated here or
  // the frame has nothing to scale from.
  const frame = (node: React.ReactNode, label: string) => (
    <div className="w-[800px]">
      <AppFrame label={label}>{node}</AppFrame>
    </div>
  );

  // The operator door shows the operations console, not a customer's
  // workspace — but in the same frame as every other door, so the product
  // reads as one thing. It still carries no handwritten note or trust strip.
  if (variant === "admin") {
    return frame(<AdminFrame />, FRAME_LABEL.admin);
  }

  // A partner signing in wants their own portal, not a customer's workspace.
  if (variant === "partner" || variant === "partner-signup") {
    return frame(<PartnerFrame />, FRAME_LABEL.partner);
  }

  if (variant === "signup") {
    return frame(<AcquisitionFrame />, FRAME_LABEL.acquisition);
  }

  return frame(<DashboardFrame />, FRAME_LABEL.dashboard);
}

const EYEBROW: Record<AuthVariant, string> = {
  signup: "More leads. More bookings. More growth.",
  login: "More leads. More bookings. More growth.",
  forgot: "More leads. More bookings. More growth.",
  reset: "More leads. More bookings. More growth.",
  partner: "ClientTurn partner programme",
  "partner-signup": "ClientTurn partner programme",
  admin: "ClientTurn internal",
};

export function AuthBrandPanel({ variant }: { variant: AuthVariant }) {
  const internal = isInternalVariant(variant);
  const copy = COPY[variant];
  const features = FEATURES[variant];

  return (
    <div className="relative flex flex-col justify-center py-10 lg:py-0">
      <div className="max-w-[430px] min-[1440px]:max-w-[430px] min-[1536px]:max-w-[440px] min-[1700px]:max-w-[465px]">
      <p className="text-[13px] font-medium tracking-[0.24em] text-[var(--auth-eyebrow)] uppercase">
        {EYEBROW[variant]}
      </p>

      <h1
        className="mt-5 font-bold text-[var(--auth-text)]"
        style={{
          fontSize: "clamp(2.5rem, 1.9rem + 2.6vw, 4.25rem)",
          lineHeight: 1,
          letterSpacing: "-0.04em",
        }}
      >
        {copy.headline[0]}
        <br />
        <span
          className="text-[var(--auth-lime)]"
          style={{ textShadow: "0 0 34px rgba(168,255,31,0.30)" }}
        >
          {copy.headline[1]}
        </span>
      </h1>

      <p className="mt-6 text-[17px] leading-relaxed text-[var(--auth-text-muted)] lg:text-[19px]">
        {copy.support}
      </p>

      <div className="mt-11">
        <FeatureList items={features} />
      </div>
      </div>

      {/* The product visual sits beside the feature list and runs past the
          column edge to tuck behind the auth card, as in the mockups. Its
          wrapper is transformed, so it forms its own stacking context and
          stays below the card — which is exactly what we want here. */}
      <div className="absolute top-1/2 right-0 hidden w-fit -translate-y-1/2 translate-x-[70%] scale-[0.82] min-[1440px]:block min-[1536px]:translate-x-[69%] min-[1536px]:scale-[0.9] min-[1700px]:translate-x-[66%] min-[1700px]:scale-[1.02]">
        <div className="ct-auth-float" style={{ perspective: 1600 }}>
          <TiltWrapper baseTransform="perspective(1500px) rotateY(-7deg) rotateZ(3deg)">
            <ProductVisual variant={variant} />
          </TiltWrapper>
        </div>
      </div>

      {/* The handwritten note needs the opposite: its own wrapper carries the
          z-index, so the stacking context the transform creates sits ABOVE the
          auth card rather than being trapped underneath it. */}
      {!internal && (
      <div className="pointer-events-none absolute top-1/2 right-0 z-40 hidden -translate-y-1/2 min-[1440px]:block">
        <div className={`absolute w-max ${ANNOTATION_POSITION}`}>
          <Annotation lines={copy.annotation} arrow="down-right" />
        </div>
      </div>
      )}

      {!internal && (
        <div className="mt-12 max-w-[620px] min-[1536px]:max-w-[680px] lg:mt-16">
          <WorksWithStrip />
        </div>
      )}
    </div>
  );
}
