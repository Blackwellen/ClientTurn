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
import { Annotation } from "./annotation";
import { FeatureList, type AuthFeature } from "./feature-list";
import { DashboardPreview, SecurityPreview, StackedCardsPreview } from "./product-preview";
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

const RECENT_LEADS = [
  { initials: "SM", name: "Sarah Mitchell", detail: "Roof repair", time: "2m ago" },
  { initials: "JC", name: "James Carter", detail: "Loft conversion", time: "14m ago" },
  { initials: "EW", name: "Emma Wilson", detail: "New roof", time: "1h ago" },
];

const RECENT_ACTIVITY = [
  { initials: "SM", name: "Sarah Mitchell", detail: "New lead", time: "2m ago" },
  { initials: "JC", name: "James Carter", detail: "Booking confirmed", time: "14m ago" },
  { initials: "EW", name: "Emma Wilson", detail: "Follow-up sent", time: "1h ago" },
];

/** Placement of the handwritten note, measured from the brand column's right
 * edge at its vertical centre — the same anchor the product visual uses — so
 * the two stay related while living in separate stacking contexts. */
const ANNOTATION_POSITION: Record<AuthVariant, string> = {
  signup:
    "bottom-[225px] -right-[20px] min-[1536px]:bottom-[245px] min-[1536px]:right-[20px] min-[1700px]:bottom-[300px] min-[1700px]:right-[125px]",
  login:
    "bottom-[225px] -right-[20px] min-[1536px]:bottom-[245px] min-[1536px]:right-[20px] min-[1700px]:bottom-[300px] min-[1700px]:right-[95px]",
  forgot:
    "top-[110px] right-[45px] min-[1536px]:right-[70px] min-[1700px]:top-[130px] min-[1700px]:right-[190px]",
  reset:
    "bottom-[175px] -right-[60px] min-[1536px]:right-[0px] min-[1700px]:bottom-[200px] min-[1700px]:right-[70px]",
  partner:
    "top-[110px] right-[45px] min-[1536px]:right-[70px] min-[1700px]:top-[130px] min-[1700px]:right-[190px]",
  "partner-signup":
    "top-[110px] right-[45px] min-[1536px]:right-[70px] min-[1700px]:top-[130px] min-[1700px]:right-[190px]",
  // Never rendered -- the operator door has no handwritten note.
  admin: "",
};

function ProductVisual({ variant }: { variant: AuthVariant }) {
  if (variant === "signup") {
    return (
      <DashboardPreview
        title="Good afternoon!"
        subtitle="Here's what's happening with your leads today."
        kpis={[
          { label: "New Leads", value: "142", delta: "12%" },
          { label: "Contacted", value: "87", delta: "8%" },
          { label: "Booked", value: "36", delta: "20%" },
        ]}
        chartTitle="Lead Funnel"
        bars={[
          { label: "Leads", value: "142", height: 100 },
          { label: "Contacted", value: "87", height: 62 },
          { label: "Responded", value: "36", height: 34 },
          { label: "Qualified", value: "28", height: 27 },
          { label: "Booked", value: "18", height: 18 },
        ]}
        showBarValues
        listTitle="Recent Leads"
        rows={RECENT_LEADS}
      />
    );
  }
  if (variant === "login") {
    return (
      <DashboardPreview
        title="Good to see you again!"
        subtitle="Here's your latest performance."
        kpis={[
          { label: "New Leads", value: "142", delta: "12%" },
          { label: "Booked Jobs", value: "87", delta: "8%" },
          { label: "Revenue", value: "£12.4k", delta: "20%" },
        ]}
        chartTitle="Leads This Month"
        chartChip="This Month"
        bars={[
          { label: "Jan", value: "58", height: 46 },
          { label: "Feb", value: "72", height: 58 },
          { label: "Mar", value: "104", height: 84 },
          { label: "Apr", value: "81", height: 66 },
          { label: "May", value: "96", height: 78 },
          { label: "Jun", value: "124", height: 100 },
        ]}
        listTitle="Recent Activity"
        rows={RECENT_ACTIVITY}
      />
    );
  }
  if (variant === "forgot" || variant === "partner" || variant === "partner-signup")
    return <StackedCardsPreview />;
  return <SecurityPreview />;
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
      <p className="text-[13px] font-medium tracking-[0.24em] text-[var(--auth-eyebrow)] uppercase">
        {EYEBROW[variant]}
      </p>

      <h1
        className="mt-5 font-bold text-[var(--auth-text)]"
        style={{
          fontSize: "clamp(2.75rem, 2rem + 3.2vw, 4.75rem)",
          lineHeight: 0.98,
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

      <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed text-[var(--auth-text-muted)] lg:text-[19px] min-[1440px]:max-w-[400px]">
        {copy.support}
      </p>

      <div className="mt-11">
        <FeatureList items={features} />
      </div>

      {/* The product visual sits beside the feature list and runs past the
          column edge to tuck behind the auth card, as in the mockups. Its
          wrapper is transformed, so it forms its own stacking context and
          stays below the card — which is exactly what we want here. */}
      <div className="absolute top-1/2 right-0 hidden w-fit -translate-y-1/2 translate-x-[52%] scale-[0.8] min-[1440px]:block min-[1536px]:translate-x-[48%] min-[1536px]:scale-[0.88] min-[1700px]:translate-x-[47%] min-[1700px]:scale-[1.1]">
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
        <div className={`absolute w-max ${ANNOTATION_POSITION[variant]}`}>
          <Annotation
            lines={copy.annotation}
            arrow={
              variant === "forgot" ||
              variant === "partner" ||
              variant === "partner-signup"
                ? "up-right"
                : "down-left"
            }
          />
        </div>
      </div>
      )}

      {!internal && (
        <div className="mt-12 lg:mt-16">
          <WorksWithStrip />
        </div>
      )}
    </div>
  );
}
