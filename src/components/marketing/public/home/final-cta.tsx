import * as React from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { PublicCta } from "../cta-link";
import {
  Arc,
  Glow,
  GridTexture,
  Lockup,
  PublicContainer,
  PublicSection,
  buttonClass,
} from "../ui";
import { ScrollDraw } from "./scroll-draw";

/**
 * The closing panel.
 *
 * The outcome labels around the mark describe what the product does for the
 * pipeline — more leads reaching a next step, more bookings taken, follow-up
 * that is legible, visibility over what performs. They deliberately stop
 * short of promising revenue or growth: ClientTurn cannot know a business's
 * close rate or margin, so it must not imply it.
 *
 * The four assurances underneath are the actual commercial terms: the trial
 * length comes from the plan catalogue, and "no card" and "cancel anytime"
 * are what the Terms say.
 */

const OUTCOMES = ["More leads", "More bookings", "Clearer follow-up", "Better visibility"];

/* The 620x360 canvas the outcome map is drawn on, matching the approved
   composition: the mark at the top, a centre statement below it, and four
   labels fanned out around them. */
const CANVAS_W = 620;
const CANVAS_H = 360;

function OutcomeMap() {
  return (
    <div
      aria-hidden
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
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {[
            "M 246 224 C 200 224 150 210 122 190 L 122 84",
            "M 374 224 C 420 224 470 210 498 190 L 498 84",
            "M 258 258 C 210 268 160 286 138 300 L 138 330",
            "M 362 258 C 410 268 460 286 482 300 L 482 330",
          ].map((d, index) => (
            <React.Fragment key={d}>
              <path
                d={d}
                pathLength={1}
                data-draw
                className="pub-path-dotted"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={d}
                pathLength={1}
                className="pub-path-pulse"
                vectorEffect="non-scaling-stroke"
                style={
                  {
                    "--pub-pulse-delay": `${index * 0.5}s`,
                    "--pub-pulse-duration": "8s",
                  } as React.CSSProperties
                }
              />
            </React.Fragment>
          ))}
          {[
            [122, 84],
            [498, 84],
            [138, 330],
            [482, 330],
          ].map(([cx, cy]) => (
            <React.Fragment key={`${cx}-${cy}`}>
              <circle data-draw-pop cx={cx} cy={cy} r={7} fill="rgb(183 243 74 / 0.2)" />
              <circle data-draw-pop cx={cx} cy={cy} r={3.4} fill="var(--pub-lime)" />
            </React.Fragment>
          ))}
        </svg>

        {/* The mark. */}
        <span
          className="absolute left-1/2 flex -translate-x-1/2 justify-center"
          style={{ top: `calc(104 * var(--u))` }}
        >
          <Lockup inkHeight="calc(34 * var(--u))" />
        </span>

        {/* The centre statement. */}
        <div
          className="pub-card absolute left-1/2 flex -translate-x-1/2 items-center justify-center text-center"
          style={{
            top: `calc(216 * var(--u))`,
            width: `calc(190 * var(--u))`,
            height: `calc(62 * var(--u))`,
            borderRadius: `calc(12 * var(--u))`,
            borderColor: "var(--pub-lime-border)",
            boxShadow: "0 0 50px -14px rgb(183 243 74 / 0.6)",
            padding: `calc(10 * var(--u))`,
          }}
        >
          <span
            className="font-semibold text-[var(--pub-text)]"
            style={{ fontSize: `calc(14 * var(--u))`, lineHeight: 1.35 }}
          >
            A more efficient way to grow
          </span>
        </div>

        {[
          { label: OUTCOMES[0], left: 12, top: 52 },
          { label: OUTCOMES[1], left: 430, top: 52 },
          { label: OUTCOMES[2], left: 14, top: 306 },
          { label: OUTCOMES[3], left: 424, top: 306 },
        ].map((chip) => (
          <span
            key={chip.label}
            className="pub-card absolute inline-flex items-center justify-center whitespace-nowrap"
            style={{
              left: `calc(${chip.left} * var(--u))`,
              top: `calc(${chip.top} * var(--u))`,
              borderRadius: `calc(9 * var(--u))`,
              padding: `calc(9 * var(--u)) calc(14 * var(--u))`,
              fontSize: `calc(13 * var(--u))`,
              color: "var(--pub-text)",
              fontWeight: 500,
            }}
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FinalCtaSection() {
  const assurances = [
    `${TRIAL_DAYS}-day free trial`,
    "No card required",
    "Guided setup",
    "Cancel anytime",
  ];

  return (
    <PublicSection
      labelledBy="final-cta-heading"
      tight
      decoration={
        <>
          <GridTexture />
          <Arc corner="tr" />
        </>
      }
    >
      <PublicContainer narrow>
        <div className="pub-card relative overflow-hidden p-8 sm:p-12 xl:p-14">
          <Glow x="right" y="middle" className="!absolute" style={{ width: "min(900px, 90%)" }} />

          <div className="relative grid items-center gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <p className="pub-eyebrow">Get started</p>
              <h2 id="final-cta-heading" className="pub-h2 mt-5 !text-[clamp(2rem,3.2vw,3.1rem)]">
                Give every opportunity
                <br />
                <span className="pub-accent">a clear next step.</span>
              </h2>
              <p className="pub-lead mt-6 max-w-lg">
                Whether you&rsquo;re converting existing leads or finding new customers, ClientTurn
                helps you turn opportunities into real business.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <PublicCta placement="final_cta" size="lg" arrow className="sm:min-w-[190px]">
                  Start Free
                </PublicCta>
                <Link
                  href="/contact-sales"
                  className={buttonClass("secondary", "lg", "sm:min-w-[190px]")}
                >
                  Contact Sales
                </Link>
              </div>

              <ul className="mt-8 flex flex-wrap gap-x-7 gap-y-3">
                {assurances.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-2 text-[13px] text-[var(--pub-text-secondary)]"
                  >
                    <CircleCheck
                      aria-hidden
                      className="size-4 shrink-0 text-[var(--pub-lime)]"
                      strokeWidth={2}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <ScrollDraw>
              <OutcomeMap />
            </ScrollDraw>
          </div>
        </div>

        {/* Facts about the operating company and the commercial terms — not
            testimonials, logos, counts or ratings. */}
        <ul className="mt-10 grid gap-4 border-t border-[var(--pub-border)] pt-8 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { title: "A registered UK company", detail: "Blackwellen Limited, England and Wales." },
            { title: "Opt-outs enforced", detail: "Re-checked immediately before every send." },
            { title: "No long-term contract", detail: "Self-serve plans cancel from settings." },
            { title: "Support from a person", detail: "Email support on every plan." },
          ].map((item) => (
            <li key={item.title} className="flex items-start gap-2.5">
              <CircleCheck
                aria-hidden
                className="mt-0.5 size-4 shrink-0 text-[var(--pub-lime)]"
                strokeWidth={2}
              />
              <span>
                <span className="block text-[13.5px] font-semibold text-[var(--pub-text)]">
                  {item.title}
                </span>
                <span className="block text-[12.5px] text-[var(--pub-text-muted)]">
                  {item.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </PublicContainer>
    </PublicSection>
  );
}
