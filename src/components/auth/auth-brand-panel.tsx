import {
  Zap,
  CalendarCheck2,
  TrendingUp,
  Users,
  Lock,
  ShieldCheck,
  RotateCw,
  UserCheck2,
} from "lucide-react";
import { Annotation } from "./annotation";
import { FeatureList, type AuthFeature } from "./feature-list";
import { DashboardPreview, SecurityPreview, StackedCardsPreview } from "./product-preview";
import { TiltWrapper } from "./tilt-wrapper";
import { WorksWithStrip } from "./works-with-strip";

export type AuthVariant = "signup" | "login" | "forgot" | "reset";

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

/** Where the handwritten note sits relative to each variant's visual, so it
 * lands in open space rather than across the headline. */
const ANNOTATION_POSITION: Record<AuthVariant, string> = {
  signup: "-top-32 left-8",
  login: "-top-32 left-8",
  forgot: "-bottom-28 -left-16",
  reset: "-top-32 left-4",
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
  if (variant === "forgot") return <StackedCardsPreview />;
  return <SecurityPreview />;
}

export function AuthBrandPanel({ variant }: { variant: AuthVariant }) {
  const copy = COPY[variant];
  const features = FEATURES[variant];

  return (
    <div className="relative flex flex-col justify-center py-10 lg:py-0">
      <p className="text-[13px] font-medium tracking-[0.24em] text-[var(--auth-eyebrow)] uppercase">
        More leads. More bookings. More growth.
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

      <p className="mt-6 max-w-[480px] text-[17px] leading-relaxed text-[var(--auth-text-muted)] lg:text-[19px]">
        {copy.support}
      </p>

      <div className="mt-11">
        <FeatureList items={features} />
      </div>

      {/* The product visual sits beside the feature list and runs past the
          column edge to tuck behind the auth card, as in the mockups. */}
      <div className="absolute top-1/2 right-0 hidden w-fit -translate-y-1/2 translate-x-[52%] scale-[0.84] xl:block 2xl:translate-x-[46%] 2xl:scale-100">
        {/* Kept outside the perspective/animated wrappers so it keeps its own
            stacking order and stays above the card it overlaps. */}
        <div className={`absolute z-30 ${ANNOTATION_POSITION[variant]}`}>
          <Annotation lines={copy.annotation} align="right" />
        </div>
        <div className="ct-auth-float" style={{ perspective: 1600 }}>
          <TiltWrapper baseTransform="perspective(1500px) rotateY(-7deg) rotateZ(3deg)">
            <ProductVisual variant={variant} />
          </TiltWrapper>
        </div>
      </div>

      <div className="mt-12 lg:mt-16">
        <WorksWithStrip />
      </div>
    </div>
  );
}
