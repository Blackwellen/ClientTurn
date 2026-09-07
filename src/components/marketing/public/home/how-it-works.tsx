import * as React from "react";
import {
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  FileText,
  MessageSquareText,
  Send,
  Sparkles,
  SquareCheckBig,
  TrendingUp,
  User,
  Users,
} from "lucide-react";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, SectionHeading } from "../ui";
import { ScrollDraw } from "./scroll-draw";

/**
 * "From opportunity to next action" — the six stages of the engine.
 *
 * An ordered list, so the sequence is conveyed structurally and not only by
 * the drawn connector. The connector itself is decorative: it is drawn once
 * across the top of the row on wide screens and runs vertically on narrow
 * ones, and carries no information the list does not already carry.
 *
 * Stage wording is deliberate. Qualification is deterministic — configured
 * criteria and explainable scoring decide, never a model — so no stage here
 * is labelled "AI qualification".
 */

type Stage = {
  n: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  copy: string;
  tag: string;
  fragment: React.ReactNode;
};

/* --------------------------------------------------- fragment helpers --- */

function Frag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`pub-fragment p-2.5 ${className ?? ""}`}>{children}</div>;
}

function FragRow({
  icon: Icon,
  title,
  sub,
  meta,
  dot,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  sub: string;
  meta: string;
  dot?: boolean;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="pub-tile" style={{ width: 26, height: 26, borderRadius: 7 }}>
        <Icon className="size-3.5" strokeWidth={2.1} />
      </span>
      {/* The title gets the full row; the timestamp moves down beside the
          secondary line, so a two-word label never has to truncate. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-semibold text-[var(--pub-text)]">
          {title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-[10px] text-[var(--pub-text-secondary)]">
            {sub}
          </span>
          <span className="shrink-0 text-[9px] text-[var(--pub-text-muted)]">{meta}</span>
          {dot ? <span className="pub-node-dot size-1.5 shrink-0" /> : null}
        </span>
      </span>
    </div>
  );
}

function TickRow({ label, last }: { label: string; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between py-1"
      style={{ borderBottom: last ? undefined : "1px solid rgb(117 148 180 / 0.12)" }}
    >
      <span className="text-[10px] text-[var(--pub-text-secondary)]">{label}</span>
      <Check aria-hidden className="size-3 text-[var(--pub-lime)]" strokeWidth={3} />
    </div>
  );
}

function ActionRow({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <div className="pub-fragment flex items-center gap-2 px-2.5 py-2">
      <Icon aria-hidden className="size-3.5 shrink-0 text-[var(--pub-lime)]" strokeWidth={2.1} />
      <span className="flex-1 truncate text-[10.5px] text-[var(--pub-text-secondary)]">{label}</span>
      <ChevronRight aria-hidden className="size-3 shrink-0 text-[var(--pub-text-muted)]" />
    </div>
  );
}

/* Sample bar heights for the "Learn" fragment. Illustrative UI, and labelled
   as a lead-source breakdown rather than as any customer's real numbers. */
const SPARK = [34, 46, 30, 58, 44, 66, 52, 78, 62, 92];
const SOURCE_BARS: { label: string; value: number }[] = [
  { label: "Website", value: 76 },
  { label: "Referrals", value: 54 },
  { label: "Paid campaigns", value: 38 },
  { label: "Outbound", value: 30 },
];

const STAGES: Stage[] = [
  {
    n: "01",
    icon: User,
    title: "Capture",
    copy: "Bring in inbound leads or source new prospects.",
    tag: "Inbound + outbound",
    fragment: (
      <div className="space-y-2.5">
        <Frag>
          <FragRow icon={User} title="New enquiry" sub="James Taylor" meta="1m ago" dot />
        </Frag>
        <Frag>
          <FragRow
            icon={Users}
            title="Sourced prospect"
            sub="Riverside Homes"
            meta="2m ago"
            dot
          />
        </Frag>
      </div>
    ),
  },
  {
    n: "02",
    icon: MessageSquareText,
    title: "Engage",
    copy: "Respond through permitted channels.",
    tag: "AI-assisted response",
    fragment: (
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <span className="pub-tile" style={{ width: 24, height: 24, borderRadius: 7 }}>
            <MessageSquareText className="size-3" strokeWidth={2.1} />
          </span>
          <Frag className="flex-1">
            <p className="text-[10px] leading-relaxed text-[var(--pub-text-secondary)]">
              Hi James! Thanks for your enquiry. How can we help?
            </p>
          </Frag>
        </div>
        <div className="flex items-start gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[rgb(117_148_180/0.16)] text-[8.5px] font-semibold text-[var(--pub-text-secondary)]">
            JT
          </span>
          <Frag className="flex-1">
            <p className="text-[10px] leading-relaxed text-[var(--pub-text-secondary)]">
              I&rsquo;d like to know more about your services.
            </p>
          </Frag>
        </div>
        <div className="pub-fragment ml-8 flex w-fit gap-1 px-2.5 py-2">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1 rounded-full bg-[var(--pub-text-muted)]" />
          ))}
        </div>
      </div>
    ),
  },
  {
    n: "03",
    icon: SquareCheckBig,
    title: "Qualify",
    copy: "Use configured criteria and explainable scoring.",
    tag: "Configured criteria",
    fragment: (
      <Frag>
        <div className="flex items-center gap-2">
          <BarChart3 aria-hidden className="size-3.5 text-[var(--pub-lime)]" strokeWidth={2.2} />
          <span className="flex-1 text-[10.5px] font-semibold text-[var(--pub-text)]">
            Lead qualification
          </span>
          <span className="rounded-full border border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--pub-lime)]">
            92
          </span>
        </div>
        <div className="mt-2">
          <TickRow label="Budget" />
          <TickRow label="Authority" />
          <TickRow label="Need" />
          <TickRow label="Timeline" last />
        </div>
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-[rgb(183_243_74/0.24)] bg-[var(--pub-lime-softer)] px-2 py-1.5">
          <Sparkles aria-hidden className="size-3 shrink-0 text-[var(--pub-lime)]" />
          <span className="min-w-0">
            <span className="block text-[10px] font-semibold text-[var(--pub-text)]">
              High intent
            </span>
            <span className="block truncate text-[9.5px] text-[var(--pub-text-muted)]">
              Good fit for your criteria
            </span>
          </span>
        </div>
      </Frag>
    ),
  },
  {
    n: "04",
    icon: CalendarDays,
    title: "Route",
    copy: "Booking, handover, outreach or review.",
    tag: "Automated routing",
    fragment: (
      <div className="space-y-2">
        <ActionRow icon={CalendarDays} label="Book appointment" />
        <ActionRow icon={Users} label="Handover to sales" />
        <ActionRow icon={Send} label="Start outreach" />
        <ActionRow icon={FileText} label="Add to nurture" />
      </div>
    ),
  },
  {
    n: "05",
    icon: TrendingUp,
    title: "Convert",
    copy: "Keep context through the journey.",
    tag: "Full journey context",
    fragment: (
      <Frag>
        {/* The badge sits under the identity rather than beside it: at the
            six-column width there is not room for both, and a truncated name
            in a product screenshot reads as a bug. */}
        <div className="flex items-center gap-2">
          <span className="pub-tile" style={{ width: 22, height: 22, borderRadius: 6 }}>
            <User className="size-3" strokeWidth={2.1} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10.5px] font-semibold text-[var(--pub-text)]">
              James Taylor
            </span>
            <span className="block truncate text-[9.5px] text-[var(--pub-text-muted)]">
              Acme Construction
            </span>
          </span>
        </div>
        <span className="mt-2 inline-flex whitespace-nowrap rounded-full border border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] px-2 py-0.5 text-[9px] font-semibold text-[var(--pub-lime)]">
          Customer
        </span>
        <ol className="mt-2.5 space-y-2">
          {[
            { label: "Enquiry received", done: true },
            { label: "Qualified", done: true },
            { label: "Appointment booked", done: true },
            { label: "Converted", done: false },
          ].map((item) => (
            <li key={item.label} className="flex items-center gap-2">
              {item.done ? (
                <span
                  className="pub-tile"
                  data-solid="true"
                  style={{ width: 15, height: 15, borderRadius: 8 }}
                >
                  <Check className="size-2.5" strokeWidth={3.2} />
                </span>
              ) : (
                <span className="grid size-[15px] shrink-0 place-items-center rounded-full border-2 border-[var(--pub-lime)]">
                  <span className="size-1.5 rounded-full bg-[var(--pub-lime)]" />
                </span>
              )}
              <span
                className={
                  item.done
                    ? "text-[10px] text-[var(--pub-text-secondary)]"
                    : "text-[10px] font-semibold text-[var(--pub-text)]"
                }
              >
                {item.label}
              </span>
            </li>
          ))}
        </ol>
      </Frag>
    ),
  },
  {
    n: "06",
    icon: BarChart3,
    title: "Learn",
    copy: "Understand which sources and actions perform.",
    tag: "Insights that compound",
    fragment: (
      <Frag>
        <p className="text-[10.5px] font-semibold text-[var(--pub-text)]">
          Lead source performance
        </p>
        <div className="mt-2.5 flex h-12 items-end gap-1" aria-hidden>
          {SPARK.map((height, index) => (
            <span
              key={index}
              className="flex-1 rounded-sm bg-[var(--pub-lime)]"
              style={{ height: `${height}%`, opacity: 0.35 + (index / SPARK.length) * 0.6 }}
            />
          ))}
        </div>
        <dl className="mt-3 space-y-1.5">
          {SOURCE_BARS.map((bar) => (
            <div key={bar.label} className="flex items-center gap-2">
              <dt className="w-[52%] truncate text-[9.5px] text-[var(--pub-text-secondary)]">
                {bar.label}
              </dt>
              <dd className="flex-1">
                <span className="block h-1.5 rounded-full bg-[rgb(117_148_180/0.18)]" aria-hidden>
                  <span
                    className="block h-full rounded-full bg-[var(--pub-lime)]"
                    style={{ width: `${bar.value}%` }}
                  />
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </Frag>
    ),
  },
];

/* =========================================================== section === */

export function HowItWorksSection() {
  return (
    <PublicSection
      id="how-it-works"
      labelledBy="how-it-works-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Arc corner="bl" />
          <Glow x="centre" y="top" />
        </>
      }
    >
      <PublicContainer narrow>
        <SectionHeading
          id="how-it-works-heading"
          align="centre"
          eyebrow="How it works"
          eyebrowPill
          title={
            <>
              From opportunity to next action — <span className="pub-accent">automatically.</span>
            </>
          }
          description="ClientTurn connects your leads, conversations and customers in one workflow — so you can grow without the manual work."
        />

        <ScrollDraw className="relative mt-20">
          {/* The connector. Decorative: the list below is already ordered. */}
          <span
            aria-hidden
            data-draw-line
            className="absolute left-6 top-0 hidden h-full w-px bg-[linear-gradient(180deg,rgb(183_243_74/0.55),rgb(183_243_74/0.1))] md:block xl:left-0 xl:top-[22px] xl:h-px xl:w-full xl:bg-[linear-gradient(90deg,rgb(183_243_74/0.1),rgb(183_243_74/0.55)_12%,rgb(183_243_74/0.55)_88%,rgb(183_243_74/0.1))]"
          />

          <ol className="grid gap-x-3 gap-y-10 md:grid-cols-2 xl:grid-cols-6 xl:gap-x-3">
            {STAGES.map((stage) => (
              <li key={stage.n} className="relative flex flex-col pl-16 md:pl-16 xl:pl-0 xl:pt-11">
                {/* Numbered marker, sitting on the connector. */}
                <span
                  aria-hidden
                  data-draw-pop
                  className="absolute left-0 top-0 grid size-11 place-items-center rounded-full border border-[var(--pub-lime-border)] bg-[var(--pub-bg)] text-[13px] font-semibold text-[var(--pub-lime)] shadow-[0_0_22px_-6px_rgb(183_243_74/0.6)] xl:left-1/2 xl:-translate-x-1/2"
                >
                  {stage.n}
                </span>

                <div className="pub-card pub-card-interactive flex h-full flex-col items-center p-4 text-center">
                  <span
                    className="pub-tile"
                    data-solid="true"
                    style={{ width: 44, height: 44, borderRadius: 12 }}
                  >
                    <stage.icon className="size-5" strokeWidth={2.2} />
                  </span>
                  <h3 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[var(--pub-text)]">
                    <span className="sr-only">{`Step ${Number(stage.n)}: `}</span>
                    {stage.title}
                  </h3>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--pub-text-secondary)]">
                    {stage.copy}
                  </p>

                  {/* The fragment takes the leftover height and sits centred
                      in it, so the six cards read as one tidy row however
                      many rows each fragment happens to carry. */}
                  <div
                    aria-hidden
                    className="mt-4 flex w-full flex-1 flex-col justify-center text-left"
                  >
                    {stage.fragment}
                  </div>

                  <p className="mt-auto w-full pt-4">
                    <span className="pub-eyebrow pub-eyebrow-pill w-full justify-center whitespace-nowrap !px-2 !text-[8.5px] !tracking-[0.09em]">
                      {stage.tag}
                    </span>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </ScrollDraw>
      </PublicContainer>
    </PublicSection>
  );
}
