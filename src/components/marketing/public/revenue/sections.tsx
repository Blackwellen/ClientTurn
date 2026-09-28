import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  Clock,
  FileSignature,
  Landmark,
  PhoneIncoming,
  Scale,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
import {
  CALL_BUDGET_MINUTES,
  PRO_MONTHLY_GBP,
  PRO_WITH_VOICE_MONTHLY_GBP,
  VOICE_ADDON,
  VOICE_NUMBER_MONTHLY_GBP,
  VOICE_PACKS_FROM_GBP,
  VOICE_TRIAL_NOTE,
  gbp,
  minutes,
} from "@/lib/marketing/voice-offer";
import { PublicCta } from "../cta-link";
import {
  Arc,
  Glow,
  GridTexture,
  PublicContainer,
  PublicSection,
  SectionHeading,
  buttonClass,
} from "../ui";
import { IllustrativeTag } from "../shell";
import { Reveal } from "../reveal";
import { JourneyRail } from "./journey";
import { LiveCallMock } from "./live-call";
import { ChannelTimeline, QuoteSequence, RoiCard } from "./pieces";
import { ILLUSTRATIVE_LABEL } from "./data";
import "./revenue.css";

/**
 * The three home-page sections that tell the revenue story:
 *
 *  - #revenue-journey: one AI sales agent across the whole journey.
 *  - #voice-agent: the AI Voice Sales Agent, with the live-call mock and the
 *    cross-channel timeline.
 *  - #quotes-and-payments: quote to signed to paid, with the ROI example.
 *
 * Server Components. The client islands are the journey rail (scroll
 * position), the live call (timer) and `InView` (starts CSS entrances), and
 * each is below the fold, so none of them touches the largest contentful
 * paint. Prices come from `lib/marketing/voice-offer`; no figure is typed
 * into this file.
 */

type Point = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  body: string;
};

function PointList({ points }: { points: readonly Point[] }) {
  return (
    <ul className="rv-points">
      {points.map((point) => (
        <li key={point.title}>
          <span className="pub-tile" aria-hidden style={{ width: 34, height: 34, borderRadius: 9 }}>
            <point.icon className="size-4" strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <strong>{point.title}</strong>
            <span>{point.body}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ====================================================== revenue journey === */

export function RevenueJourneySection() {
  return (
    <PublicSection
      id="revenue-journey"
      labelledBy="revenue-journey-heading"
      decoration={
        <>
          <GridTexture />
          <Glow x="left" y="middle" style={{ opacity: 0.8 }} />
        </>
      }
    >
      <PublicContainer>
        <div className="rv-journey-layout">
          <div className="rv-journey-intro">
            <Reveal>
              <SectionHeading
                id="revenue-journey-heading"
                eyebrow="The revenue journey"
                title={
                  <>
                    One AI sales agent.{" "}
                    <span className="pub-accent">The whole revenue journey.</span>
                  </>
                }
                description="Most tools answer the lead and stop. ClientTurn carries one conversation from first enquiry to paid invoice."
              />
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
                <span className="pub-small">Names and figures are invented.</span>
              </div>
              <div className="mt-8 flex flex-wrap gap-3">
                <PublicCta placement="revenue_journey" size="md" arrow>
                  Start free
                </PublicCta>
                <Link href="#voice-agent" className={buttonClass("secondary", "md")}>
                  Meet the voice agent
                </Link>
              </div>
            </Reveal>
          </div>
          <JourneyRail />
        </div>
      </PublicContainer>
    </PublicSection>
  );
}

/* ========================================================= voice agent === */

const VOICE_POINTS: readonly Point[] = [
  {
    icon: BadgeCheck,
    title: "Says it is an AI, every call",
    body: "A fixed opening line that cannot be edited away.",
  },
  {
    icon: PhoneIncoming,
    title: "Calls only people who asked",
    body: "Leads who asked for a call or agreed on your form. Never cold calls.",
  },
  {
    icon: CalendarClock,
    title: "Calling hours in their time zone",
    body: "No Sundays or bank holidays by default.",
  },
  {
    icon: Clock,
    title: `A ${CALL_BUDGET_MINUTES} minute time budget`,
    body: "Each call is steered to its next step, so minutes are not wasted.",
  },
  {
    icon: Landmark,
    title: "Your own dedicated UK number",
    body: "Never shared or rotated, so leads recognise you.",
  },
  {
    icon: UserRound,
    title: "A person when it matters",
    body: "Anything outside its rules goes to your team, with context.",
  },
];

export function VoiceAgentSection() {
  return (
    <PublicSection
      id="voice-agent"
      labelledBy="voice-agent-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Glow x="right" y="top" />
        </>
      }
    >
      <PublicContainer>
        <Reveal>
          <SectionHeading
            id="voice-agent-heading"
            eyebrow="AI Voice Sales Agent"
            eyebrowPill
            title={
              <>
                The lead asked for a call.{" "}
                <span className="pub-accent">Your AI sales agent makes it.</span>
              </>
            }
            description="It calls B2B leads who asked for a call, qualifies them, and sends the quote or books the meeting."
          />
        </Reveal>

        <div className="rv-voice-grid mt-12">
          <LiveCallMock />
          <PointList points={VOICE_POINTS} />
        </div>

        <div className="rv-voice-grid rv-voice-grid-flip mt-16">
          <div className="min-w-0">
            <h3 className="pub-h3">One conversation across every channel.</h3>
            <p className="pub-lead mt-4">
              Call, email, SMS and WhatsApp share one thread and one memory. Opt-outs and quiet
              hours are checked before every send.
            </p>
            <p className="pub-small mt-4">
              SMS and WhatsApp only go to a mobile the lead gave you.
            </p>
          </div>
          <ChannelTimeline />
        </div>

        <div className="rv-price-strip mt-16" aria-labelledby="voice-price-heading">
          <div className="min-w-0">
            <h3 id="voice-price-heading" className="rv-price-strip-title">
              Voice is a paid feature
            </h3>
            <p className="rv-price-strip-body">
              <strong>
                Pro {gbp(PRO_WITH_VOICE_MONTHLY_GBP)}/month with Voice
              </strong>
              : {minutes(VOICE_ADDON.includedMinutes)} a month and a dedicated number. Don&rsquo;t
              need voice? Pro {gbp(PRO_MONTHLY_GBP)}. Starter and Growth: packs from{" "}
              {gbp(VOICE_PACKS_FROM_GBP)} plus a {gbp(VOICE_NUMBER_MONTHLY_GBP)}/month number.
            </p>
            <p className="pub-small mt-2">{VOICE_TRIAL_NOTE} Prices exclude VAT.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <PublicCta placement="voice_agent_section" href="/signup?plan=pro" size="md" arrow>
              Choose Pro with Voice
            </PublicCta>
            <Link href="/pricing#voice-pricing" className={buttonClass("secondary", "md")}>
              See voice pricing
            </Link>
          </div>
        </div>
        <p className="pub-small mt-4">
          <Link href="/compliance#voice-calls" className="pub-link">
            How AI calls stay within PECR
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </p>
      </PublicContainer>
    </PublicSection>
  );
}

/* ================================================== quotes and payments === */

const QUOTE_STAGES = [
  "Quote requested",
  "Details collected",
  "Priced by your rules",
  "Branded quote",
  "Approval if needed",
  "Viewed",
  "Signed",
  "Paid",
  "CRM updated",
  "Revenue attributed",
] as const;

const QUOTE_POINTS: readonly Point[] = [
  {
    icon: Scale,
    title: "Deterministic pricing",
    body: "Prices, VAT and discounts come from your rules. The AI never sets a price.",
  },
  {
    icon: ShieldCheck,
    title: "Approval when it matters",
    body: "Quotes over your thresholds wait for the right person.",
  },
  {
    icon: FileSignature,
    title: "Simple electronic signature",
    body: "Branded signing page with an audit trail. Signed quotes cannot be edited.",
  },
  {
    icon: Wallet,
    title: "Paid into your Stripe",
    body: "Deposit and balance invoices, with reminders, through your own Stripe.",
  },
];

export function QuotesPaymentsSection() {
  return (
    <PublicSection
      id="quotes-and-payments"
      labelledBy="quotes-heading"
      decoration={
        <>
          <GridTexture />
          <Glow x="centre" y="middle" style={{ opacity: 0.8 }} />
        </>
      }
    >
      <PublicContainer>
        <Reveal>
          <SectionHeading
            id="quotes-heading"
            eyebrow="Quote to cash"
            eyebrowPill
            title={
              <>
                From &ldquo;can you send a quote?&rdquo;{" "}
                <span className="pub-accent">to paid.</span>
              </>
            }
            description="The agent collects the details, your rules price the job, and the lead signs and pays in one flow."
          />
        </Reveal>

        <ol className="rv-stages mt-10" aria-label="Quote to cash stages">
          {QUOTE_STAGES.map((stage, index) => (
            <li key={stage}>
              <span aria-hidden>{String(index + 1).padStart(2, "0")}</span>
              {stage}
            </li>
          ))}
        </ol>

        <div className="mt-10">
          <QuoteSequence />
        </div>

        <div className="rv-voice-grid mt-14">
          <PointList points={QUOTE_POINTS} />
          <RoiCard />
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3">
          <PublicCta placement="quotes_section" size="md" arrow>
            Start free
          </PublicCta>
          <Link href="/pricing#voice-pricing" className={buttonClass("secondary", "md")}>
            Quotes and voice pricing
          </Link>
          <span className="pub-small inline-flex items-center gap-2">
            <Check aria-hidden className="size-3.5 text-[var(--pub-lime)]" />
            Quotes, signatures and invoices are part of every paid plan.
          </span>
        </div>
      </PublicContainer>
    </PublicSection>
  );
}
