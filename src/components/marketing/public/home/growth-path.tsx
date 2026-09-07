import * as React from "react";
import Link from "next/link";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  SquareCheckBig,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Arc, Glow, GridTexture, PublicCard, PublicContainer, PublicSection, SectionHeading, buttonClass } from "../ui";
import { ScrollDraw } from "./scroll-draw";
import { Reveal } from "../reveal";

/**
 * "Choose the growth path you need" — the two propositions, side by side.
 *
 * Each card carries a scatter of product fragments joined by dotted lime
 * connectors, authored on a 662x430 design canvas so the arrangement is the
 * approved one at every width. Below the two-column breakpoint the scatter is
 * replaced by a stacked sequence: the same fragments, ordered, not shrunk.
 */

const CANVAS_W = 662;
const CANVAS_H = 430;

/**
 * The copy column's footprint, in canvas units.
 *
 * The scatter is drawn on an absolute canvas that spans the whole card, so
 * nothing stops a panel or a connector from landing on top of the heading.
 * These bounds are what does: every panel sits either right of `TEXT_RIGHT`
 * or below `TEXT_BOTTOM`, and every connector is routed to stay out of that
 * rectangle.
 *
 * The numbers are the *worst case*, not the typical one. The canvas scales
 * with the card while the copy stays at fixed pixel sizes, so the text eats
 * more canvas units the narrower the card gets — measured, it is 272u at a
 * 1440px viewport but 296u at 1280px, the narrowest width that still shows
 * the scatter. Everything below clears 296u.
 */
const TEXT_RIGHT = 385;
const TEXT_BOTTOM = 300;

function u(value: number): string {
  return `calc(${value} * var(--u))`;
}

/* ---------------------------------------------------------- fragments --- */

function MiniPanel({
  icon: Icon,
  title,
  meta,
  x,
  y,
  width,
  dot,
  children,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties; strokeWidth?: number }>;
  title: string;
  meta?: string;
  x: number;
  y: number;
  width: number;
  /** Trailing live dot, as the approved "New enquiry" fragment carries. */
  dot?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="pub-card absolute"
      style={{ left: u(x), top: u(y), width: u(width), borderRadius: u(12), padding: u(11) }}
    >
      <div className="flex items-center" style={{ gap: u(9) }}>
        <span className="pub-tile" style={{ width: u(28), height: u(28), borderRadius: u(8) }}>
          <Icon style={{ width: u(15), height: u(15) }} strokeWidth={2.1} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-semibold text-[var(--pub-text)]"
            style={{ fontSize: u(12.5), lineHeight: 1.2 }}
          >
            {title}
          </span>
          {meta ? (
            <span
              className="block text-[var(--pub-text-muted)]"
              style={{ fontSize: u(9.5), lineHeight: 1.3, marginTop: u(1) }}
            >
              {meta}
            </span>
          ) : null}
        </span>
        {dot ? <span className="pub-node-dot" style={{ width: u(7), height: u(7) }} /> : null}
      </div>
      {children ? (
        <div style={{ marginTop: u(9) }}>{children}</div>
      ) : null}
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="pub-fragment" style={{ padding: u(9), borderRadius: u(9) }}>
      <p className="text-[var(--pub-text-secondary)]" style={{ fontSize: u(10), lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

function CriteriaRows({ rows }: { rows: string[] }) {
  return (
    <div className="pub-fragment" style={{ padding: u(7), borderRadius: u(9) }}>
      {rows.map((row, index) => (
        <div
          key={row}
          className="flex items-center justify-between"
          style={{
            paddingBlock: u(4.5),
            borderBottom:
              index === rows.length - 1 ? undefined : "1px solid rgb(117 148 180 / 0.12)",
          }}
        >
          <span className="text-[var(--pub-text-secondary)]" style={{ fontSize: u(10) }}>
            {row}
          </span>
          <Check
            aria-hidden
            className="text-[var(--pub-lime)]"
            style={{ width: u(11), height: u(11) }}
            strokeWidth={3}
          />
        </div>
      ))}
    </div>
  );
}

function DottedLink({ d }: { d: string }) {
  return (
    <path
      d={d}
      pathLength={1}
      data-draw
      className="pub-path-dotted"
      vectorEffect="non-scaling-stroke"
    />
  );
}

function Junction({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <circle data-draw-pop cx={cx} cy={cy} r={6} fill="rgb(183 243 74 / 0.18)" />
      <circle data-draw-pop cx={cx} cy={cy} r={3} fill="var(--pub-lime)" />
    </>
  );
}

function Canvas({ children }: { children: React.ReactNode }) {
  return (
    <ScrollDraw
      className="pointer-events-none absolute inset-0 hidden xl:block"
    >
    <div
      aria-hidden
      className="h-full w-full"
      style={{ containerType: "inline-size" }}
    >
      <div
        className="relative"
        style={
          {
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            "--u": `${100 / CANVAS_W}cqw`,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </div>
    </ScrollDraw>
  );
}

/* ------------------------------------------------------- summary strip --- */

type Step = {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  detail: string;
};

function SummaryStrip({ steps }: { steps: Step[] }) {
  return (
    <ol className="pub-fragment mt-8 flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
      {steps.map((step, index) => (
        <React.Fragment key={step.title}>
          {index > 0 ? (
            <li aria-hidden className="hidden shrink-0 sm:block">
              <span className="pub-node-dot block" />
            </li>
          ) : null}
          <li className="flex min-w-0 flex-1 items-center gap-3">
            <span className="pub-tile" style={{ width: 34, height: 34, borderRadius: 9 }}>
              <step.icon className="size-4" strokeWidth={2.1} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-[var(--pub-text)]">
                {index + 1}. {step.title}
              </span>
              {/* These are labels, not data — they wrap rather than truncate. */}
              <span className="block text-[11.5px] leading-snug text-[var(--pub-text-muted)]">
                {step.detail}
              </span>
            </span>
          </li>
        </React.Fragment>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------ the card --- */

function PathCard({
  eyebrow,
  title,
  titleAccent,
  copy,
  ctaLabel,
  href,
  steps,
  canvas,
  stack,
}: {
  eyebrow: string;
  title: string;
  titleAccent: string;
  copy: string;
  ctaLabel: string;
  href: string;
  steps: Step[];
  canvas: React.ReactNode;
  stack: React.ReactNode;
}) {
  return (
    <PublicCard
      interactive
      className="relative flex min-w-0 flex-col overflow-hidden p-6 sm:p-8 xl:min-h-[600px]"
    >
      {canvas}

      {/* The copy column is measured to clear the fragment scatter beside and
          below it (see TEXT_RIGHT / TEXT_BOTTOM). `z-10` is belt and braces:
          if a future edit moves a panel into this rectangle, the words stay
          readable rather than disappearing behind a card. */}
      <div className="relative z-10 xl:max-w-[58%]">
        <p className="pub-eyebrow pub-eyebrow-pill" style={{ fontSize: "0.66rem" }}>
          {eyebrow}
        </p>
        <h3 className="mt-4 text-[clamp(1.6rem,2.15vw,2rem)] font-semibold leading-[1.06] tracking-[-0.035em] text-[var(--pub-text)]">
          {title} <span className="pub-accent">{titleAccent}</span>
        </h3>
        <p className="mt-3.5 max-w-[340px] text-[14px] leading-[1.55] text-[var(--pub-text-secondary)]">
          {copy}
        </p>
        <Link href={href} className={cn(buttonClass("primary", "md"), "mt-5")}>
          {ctaLabel}
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>

      {/* The narrow-column stand-in for the scatter above. */}
      <div aria-hidden className="relative mt-8 xl:hidden">
        {stack}
      </div>

      <div className="relative mt-auto">
        <SummaryStrip steps={steps} />
      </div>
    </PublicCard>
  );
}

/** Stacked fragments for narrow columns. */
function StackList({ items }: { items: { icon: Step["icon"]; title: string; detail: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:hidden">
      {items.map((item) => (
        <li key={item.title} className="pub-fragment flex items-center gap-3 p-3">
          <span className="pub-tile" style={{ width: 32, height: 32, borderRadius: 8 }}>
            <item.icon className="size-4" strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[var(--pub-text)]">
              {item.title}
            </span>
            <span className="block text-[12px] text-[var(--pub-text-muted)]">{item.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* =========================================================== section === */

export function GrowthPathSection() {
  return (
    <PublicSection
      id="growth-paths"
      labelledBy="growth-paths-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
          <Glow x="centre" y="top" />
        </>
      }
    >
      <PublicContainer narrow>
        <Reveal>
        <SectionHeading
          id="growth-paths-heading"
          align="centre"
          eyebrow="Two ways to grow"
          eyebrowPill
          title={
            <>
              Choose the growth path <span className="pub-accent">you need.</span>
            </>
          }
          description="Whether you want to convert more of the leads already coming in, or find new customers, ClientTurn gives you the tools to grow — your way."
        />
        </Reveal>

        <div className="mt-16 grid gap-6 lg:grid-cols-2 lg:gap-7">
          <PathCard
            eyebrow="Inbound lead conversion"
            title="Convert"
            titleAccent="Existing Leads"
            copy="Respond, follow up, qualify, book and reactivate the enquiries already coming into your business."
            ctaLabel="Explore Lead Conversion"
            href="/product/lead-conversion"
            steps={[
              { icon: Users, title: "Lead", detail: "New enquiry" },
              { icon: SquareCheckBig, title: "Qualify", detail: "Guided conversation" },
              { icon: CalendarDays, title: "Book", detail: "Appointment scheduled" },
            ]}
            stack={
              <StackList
                items={[
                  { icon: Users, title: "New enquiry", detail: "Website form" },
                  { icon: MessageSquareText, title: "AI response", detail: "Sent in seconds" },
                  { icon: SquareCheckBig, title: "Qualified", detail: "Fit for service" },
                  { icon: CalendarDays, title: "Appointment booked", detail: "Mon, 18 Nov" },
                ]}
              />
            }
            canvas={
              <Canvas>
                <svg
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  <DottedLink d="M 530 89 L 530 127" />
                  {/* Stays right of TEXT_RIGHT until it is below TEXT_BOTTOM,
                      then turns in to meet the qualification panel's top-right
                      corner — so it never crosses the paragraph. */}
                  <DottedLink d="M 436 252 C 424 284 404 308 372 312" />
                  <DottedLink d="M 372 396 C 398 396 412 366 435 358" />
                  <Junction cx={530} cy={108} />
                  <Junction cx={410} cy={296} />
                  <Junction cx={404} cy={378} />
                </svg>

                <MiniPanel icon={Users} title="New enquiry" meta="Website form" x={434} y={31} width={194} dot />

                <MiniPanel icon={MessageSquareText} title="AI response" meta="1m ago" x={435} y={127} width={190}>
                  <Bubble>Hi James! Thanks for your enquiry. How can we help?</Bubble>
                </MiniPanel>

                <MiniPanel icon={SquareCheckBig} title="Qualified" meta="Fit for service" x={199} y={310} width={172}>
                  <CriteriaRows rows={["Budget", "Authority", "Need", "Timeline"]} />
                </MiniPanel>

                <MiniPanel icon={CalendarDays} title="Appointment booked" x={434} y={300} width={192}>
                  <div className="pub-fragment flex items-center" style={{ padding: u(9), borderRadius: u(9), gap: u(8) }}>
                    <span className="flex-1">
                      <span className="block font-medium text-[var(--pub-text)]" style={{ fontSize: u(10.5) }}>
                        Mon, 18 Nov
                      </span>
                      <span className="block text-[var(--pub-text-muted)]" style={{ fontSize: u(10) }}>
                        10:00 AM
                      </span>
                    </span>
                    <span
                      className="pub-tile"
                      data-solid="true"
                      style={{ width: u(17), height: u(17), borderRadius: u(9) }}
                    >
                      <Check style={{ width: u(11), height: u(11) }} strokeWidth={3.2} />
                    </span>
                  </div>
                </MiniPanel>
              </Canvas>
            }
          />

          <PathCard
            eyebrow="Outbound prospecting"
            title="Find"
            titleAccent="New Customers"
            copy="Describe your target, source and verify prospects, monitor intent and coordinate permitted outbound outreach."
            ctaLabel="Explore Find Leads"
            href="/product/find-leads"
            steps={[
              { icon: Target, title: "Target", detail: "Define your ICP" },
              { icon: ShieldCheck, title: "Verify", detail: "Validate prospects" },
              { icon: Send, title: "Outreach", detail: "Start conversations" },
            ]}
            stack={
              <StackList
                items={[
                  { icon: Search, title: "Target audience", detail: "Define your ideal customer" },
                  { icon: ShieldCheck, title: "Verified prospects", detail: "High-quality, validated" },
                  { icon: Send, title: "Outreach", detail: "AI-assisted messaging" },
                ]}
              />
            }
            canvas={
              <Canvas>
                <svg
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  {/* Runs down the right of the copy and only crosses back
                      once it is below TEXT_BOTTOM. */}
                  <DottedLink d="M 429 100 C 402 170 392 250 388 292 C 384 304 372 310 347 310" />
                  <DottedLink d="M 559 145 L 559 310" />
                  <DottedLink d="M 444 388 L 470 380" />
                  <Junction cx={390} cy={264} />
                  <Junction cx={559} cy={226} />
                  <Junction cx={457} cy={384} />
                </svg>

                <MiniPanel icon={Search} title="Target audience" meta="Define your ideal customer" x={428} y={27} width={209}>
                  <div className="flex flex-wrap" style={{ gap: u(6) }}>
                    {["Construction", "Residential", "Property Developers"].map((chip) => (
                      <span
                        key={chip}
                        className="pub-chip"
                        style={{ fontSize: u(9.5), paddingInline: u(9), paddingBlock: u(4) }}
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                </MiniPanel>

                <MiniPanel icon={ShieldCheck} title="Verified prospects" meta="High-quality, validated" x={249} y={310} width={194}>
                  <div className="pub-fragment" style={{ padding: u(7), borderRadius: u(9) }}>
                    {["Smith Construction", "Riverside Homes", "Oakwood Developments"].map((name) => (
                      <div key={name} className="flex items-center" style={{ gap: u(7), paddingBlock: u(4.5) }}>
                        <Building2
                          aria-hidden
                          className="text-[var(--pub-text-muted)]"
                          style={{ width: u(11), height: u(11) }}
                        />
                        <span className="flex-1 truncate text-[var(--pub-text-secondary)]" style={{ fontSize: u(10) }}>
                          {name}
                        </span>
                        <Check
                          aria-hidden
                          className="text-[var(--pub-lime)]"
                          style={{ width: u(11), height: u(11) }}
                          strokeWidth={3}
                        />
                      </div>
                    ))}
                  </div>
                </MiniPanel>

                <MiniPanel icon={Send} title="Outreach" meta="AI-assisted messaging" x={469} y={310} width={181}>
                  <Bubble>Hi there, We help contractors win more high-value projects&hellip;</Bubble>
                </MiniPanel>
              </Canvas>
            }
          />
        </div>
      </PublicContainer>
    </PublicSection>
  );
}
