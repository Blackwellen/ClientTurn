"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  MessageSquareText,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { Reveal } from "../reveal";
import { INDUSTRIES, INDUSTRY_STRIP, type Industry } from "./industry-data";

/**
 * "Built around your conversion goal — not your industry label."
 *
 * Two rows deep and scrolling sideways, as approved: `grid-flow-col` with
 * `grid-rows-2` fills column by column, so a page is three columns by two
 * rows and the arrows advance exactly one page. With sixteen sectors those
 * arrows have real work to do.
 *
 * The track is a native scroll region, so trackpad, touch and keyboard all
 * work whether or not the visitor uses the buttons.
 */

/* ------------------------------------------------------------- artwork --- */

/**
 * The tonal motif that stands in for photography. Decorative only: a soft
 * two-stop wash, a faint technical grid and the sector glyph, under the same
 * dark gradient a photograph would carry — so dropping a real image into the
 * `image` field changes nothing else about the card.
 */
function Motif({ industry }: { industry: Industry }) {
  return (
    <span
      aria-hidden
      className="absolute inset-0 block"
      style={{
        background: `radial-gradient(120% 90% at 20% 0%, ${industry.motif[0]}, ${industry.motif[1]} 72%)`,
      }}
    >
      <span
        className="absolute inset-0 block opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.06) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.06) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
        }}
      />
      <industry.icon
        className="absolute -right-5 -top-3 size-40 text-[rgb(183_243_74/0.07)]"
        strokeWidth={1}
      />
    </span>
  );
}

/* --------------------------------------------------------------- card --- */

const STAGE_ICONS: LucideIcon[] = [MessageSquareText, FileText, CalendarDays];

function IndustryCard({ industry }: { industry: Industry }) {
  const stageLabels = ["Enquiry", "Qualify", industry.finalLabel];

  return (
    <article className="pub-card pub-card-interactive group flex h-full min-w-0 flex-col overflow-hidden">
      <div className="relative h-[168px] shrink-0 overflow-hidden">
        {industry.image ? (
          <Image
            src={industry.image}
            alt={industry.imageAlt ?? ""}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            // Toned back so the photograph sits in the dark palette rather
            // than punching a bright hole in it; it lifts slightly on hover.
            className="object-cover brightness-[0.72] saturate-[0.85] transition-[transform,filter] duration-500 group-hover:scale-[1.03] group-hover:brightness-[0.82]"
          />
        ) : (
          <Motif industry={industry} />
        )}
        {/* Legibility wash. Needed over a photograph, harmless over the motif. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgb(2_6_10/0.35),rgb(2_6_10/0.9)_74%,var(--pub-card))]"
        />
      </div>

      <div className="relative -mt-9 flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3.5">
          <span
            className="pub-tile shrink-0 bg-[var(--pub-bg-elevated)]"
            style={{ width: 52, height: 52, borderRadius: 14 }}
          >
            <industry.icon className="size-6" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1 pt-2">
            <h3 className="text-[19px] font-semibold leading-tight tracking-[-0.02em] text-[var(--pub-text)]">
              {industry.name}
            </h3>
            <p className="mt-1 text-[11px] uppercase tracking-[0.1em] text-[var(--pub-text-muted)]">
              {industry.category}
            </p>
          </div>
        </div>

        <p className="mt-3.5 min-h-[2.9em] text-[13.5px] leading-relaxed text-[var(--pub-text-secondary)]">
          {industry.promise}
        </p>

        <ol className="mt-4 flex items-stretch gap-1.5">
          {industry.stages.map((stage, index) => (
            <React.Fragment key={stage}>
              {index > 0 ? (
                <li aria-hidden className="flex items-center">
                  <ChevronRight className="size-3.5 text-[var(--pub-text-muted)]" />
                </li>
              ) : null}
              <li className="flex min-w-0 flex-1 items-start gap-2">
                <span
                  className={cn(
                    "grid shrink-0 place-items-center rounded-full border transition-colors",
                    index === 2
                      ? "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]"
                      : "border-[var(--pub-border)] bg-[rgb(255_255_255/0.03)] text-[var(--pub-text-secondary)] group-hover:border-[var(--pub-lime-border)] group-hover:text-[var(--pub-lime)]",
                  )}
                  style={{ width: 30, height: 30 }}
                >
                  {React.createElement(STAGE_ICONS[index], {
                    className: "size-3.5",
                    strokeWidth: 2.1,
                  })}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-[var(--pub-text)]">
                    {stageLabels[index]}
                  </span>
                  <span className="block text-[11px] leading-snug text-[var(--pub-text-muted)]">
                    {stage}
                  </span>
                </span>
              </li>
            </React.Fragment>
          ))}
        </ol>

        {/* There is no per-sector page to link to, and inventing sixteen of
            them to satisfy a label would be worse than labelling the link
            for where it actually goes. It goes to How It Works, which is
            what a visitor reading this card wants next. */}
        <Link
          href="/how-it-works"
          className="pub-link mt-auto pt-5"
          onClick={() => trackEngagement("public_nav_click", `industry:${industry.id}`)}
        >
          See how it works
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}

/* =========================================================== section === */

export function IndustriesSection() {
  const track = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(false);

  /* The buttons only ever say what the track can actually do, so neither is
     left enabled at an end it cannot move past. */
  const sync = React.useCallback(() => {
    const node = track.current;
    if (!node) return;
    const max = node.scrollWidth - node.clientWidth;
    setAtStart(node.scrollLeft <= 2);
    setAtEnd(node.scrollLeft >= max - 2);
  }, []);

  React.useEffect(() => {
    sync();
    const node = track.current;
    if (!node) return;
    node.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    return () => {
      node.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [sync]);

  function page(direction: -1 | 1) {
    const node = track.current;
    if (!node) return;
    // One viewport at a time, so a card is never left half in view.
    node.scrollBy({ left: direction * node.clientWidth, behavior: "smooth" });
  }

  return (
    <PublicSection
      id="industries"
      labelledBy="industries-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="bl" />
          <Glow x="right" y="top" />
        </>
      }
    >
      <PublicContainer>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <p className="pub-eyebrow">Industries</p>
            <h2
              id="industries-heading"
              className="pub-h2 mt-5 !text-[clamp(1.9rem,3.2vw,2.9rem)]"
            >
              Built around your conversion goal —{" "}
              <span className="pub-accent">not your industry label.</span>
            </h2>
            <p className="pub-lead mt-6">
              The same engine can qualify different enquiries and route each business toward its
              own next action.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-4 lg:mt-14 lg:items-end">
            {/* Wraps at 320px, where the CTA and the two arrows together are
                wider than the viewport. */}
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/signup" className={buttonClass("primary", "lg")}>
                Start free
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label="Previous industries"
                  aria-controls="industry-track"
                  disabled={atStart}
                  onClick={() => page(-1)}
                  className={buttonClass(
                    "secondary",
                    "md",
                    "!w-11 !rounded-full !px-0 disabled:cursor-default disabled:opacity-35",
                  )}
                >
                  <ArrowLeft aria-hidden className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next industries"
                  aria-controls="industry-track"
                  disabled={atEnd}
                  onClick={() => page(1)}
                  className={buttonClass(
                    "secondary",
                    "md",
                    "!w-11 !rounded-full !px-0 disabled:cursor-default disabled:opacity-35",
                  )}
                >
                  <ArrowRight aria-hidden className="size-4" />
                </button>
              </div>
            </div>
            <p className="pub-small">Different enquiries. The same conversion engine.</p>
          </div>
        </div>

        {/* A native scroll region, so trackpad, touch and keyboard all work
            whether or not the visitor uses the buttons. */}
        <div
          id="industry-track"
          ref={track}
          role="group"
          aria-label="Industries"
          tabIndex={0}
          className="mt-10 grid snap-x snap-mandatory grid-flow-col grid-rows-2 gap-5 overflow-x-auto scroll-smooth pb-3 auto-cols-[84vw] [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--pub-lime)] md:auto-cols-[calc((100%-1.25rem)/2)] xl:auto-cols-[calc((100%-2.5rem)/3)] [&::-webkit-scrollbar]:hidden"
          // The track bleeds to the viewport edge so a partially visible card
          // reads as "there is more", but its content still starts on the
          // container's gutter so the first card lines up with the heading.
          style={{
            marginInline: "calc(var(--pub-gutter) * -1)",
            paddingInline: "var(--pub-gutter)",
            scrollPaddingInline: "var(--pub-gutter)",
          }}
        >
          {INDUSTRIES.map((industry, index) => (
            <Reveal
              key={industry.id}
              delay={(index % 6) * 0.05}
              className="h-full min-w-0 snap-start"
            >
              <IndustryCard industry={industry} />
            </Reveal>
          ))}
        </div>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-[var(--pub-border)] pt-8">
          {INDUSTRY_STRIP.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 text-[13.5px] text-[var(--pub-text-secondary)]"
            >
              <CheckCircle2 aria-hidden className="size-4 text-[var(--pub-lime)]" strokeWidth={2} />
              {item}
            </li>
          ))}
          <li className="flex items-center gap-2 text-[13.5px] text-[var(--pub-text-muted)]">
            <Plus aria-hidden className="size-4" strokeWidth={2} />
            Many more industries
          </li>
        </ul>
      </PublicContainer>
    </PublicSection>
  );
}
