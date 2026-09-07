"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  FileText,
  HardHat,
  Home,
  Leaf,
  MessageSquareText,
  Plus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { ANCHORS } from "../nav-data";
import { Reveal } from "../reveal";

/**
 * "Built around your conversion goal — not your industry label."
 *
 * Six sectors, each shown as the same three-stage route: the enquiry that
 * arrives, what gets qualified, and the action it ends in. The point of the
 * section is that the engine is one engine, so every card renders from the
 * same shape.
 *
 * Imagery: the repository ships no sector photography, and inventing it is
 * not something a marketing page should do on its own. Each card therefore
 * renders a restrained tonal motif in place of a photograph, and carries an
 * optional `image` field — set it to a real asset path and the card uses the
 * photograph instead, with no other change.
 */

type Industry = {
  id: string;
  name: string;
  category: string;
  icon: LucideIcon;
  promise: string;
  /** Real photography, when it exists. Falls back to the tonal motif. */
  image?: string;
  imageAlt?: string;
  /** The motif's two stops. Distinct per sector, all within the dark palette. */
  motif: [string, string];
  stages: [string, string, string];
  final: { label: string; value: string };
};

const INDUSTRIES: Industry[] = [
  {
    id: "roofing",
    name: "Roofing",
    category: "Home services",
    icon: Home,
    promise: "Turn roof enquiries into booked surveys.",
    motif: ["#16303c", "#071019"],
    stages: ["New roof quote", "Property, scope, timing", "Site survey"],
    final: { label: "Book", value: "Site survey" },
  },
  {
    id: "kitchens",
    name: "Kitchens",
    category: "Home improvements",
    icon: Building2,
    promise: "Convert kitchen enquiries into design appointments.",
    motif: ["#2a2438", "#0a0d16"],
    stages: ["New kitchen quote", "Budget, style, timeline", "Design appointment"],
    final: { label: "Book", value: "Design appointment" },
  },
  {
    id: "windows-doors",
    name: "Windows & Doors",
    category: "Home improvements",
    icon: Building2,
    promise: "Turn enquiries into measured quotes.",
    motif: ["#12303a", "#060f18"],
    stages: ["Window or door quote", "Property type, quantity", "Measure-up"],
    final: { label: "Book", value: "Measure-up" },
  },
  {
    id: "landscaping",
    name: "Landscaping",
    category: "Outdoor services",
    icon: Leaf,
    promise: "Convert garden enquiries into site visits.",
    motif: ["#16321f", "#060f0b"],
    stages: ["Garden project", "Location, scope, budget", "Site visit"],
    final: { label: "Book", value: "Site visit" },
  },
  {
    id: "plumbing",
    name: "Plumbing",
    category: "Trade services",
    icon: Wrench,
    promise: "Get the right jobs to the right engineer.",
    motif: ["#152a3a", "#060d15"],
    stages: ["Plumbing issue", "Urgency, location, job type", "Engineer visit"],
    final: { label: "Book", value: "Engineer visit" },
  },
  {
    id: "builders",
    name: "Builders",
    category: "Construction",
    icon: HardHat,
    promise: "Turn build enquiries into qualified projects.",
    motif: ["#33291a", "#100c06"],
    stages: ["Build or extension", "Scope, budget, timeline", "Qualified project"],
    final: { label: "Handover", value: "Qualified project" },
  },
];

const FOOTER_STRIP = [
  "Service businesses",
  "Home improvements",
  "Trade services",
  "Property services",
  "Facilities management",
];

/* ------------------------------------------------------------- artwork --- */

/**
 * The tonal motif that stands in for photography. Decorative only: a soft
 * two-stop wash, a faint technical grid and the sector glyph, under the same
 * dark gradient a photograph would carry so the typography over it stays
 * legible either way.
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

function IndustryCard({ industry }: { industry: Industry }) {
  const stageIcons: LucideIcon[] = [MessageSquareText, FileText, CalendarDays];
  const stageLabels = ["Enquiry", "Qualify", industry.final.label];

  return (
    <article className="pub-card pub-card-interactive group flex h-full min-w-0 snap-start flex-col overflow-hidden">
      <div className="relative h-[168px] shrink-0 overflow-hidden">
        {industry.image ? (
          <Image
            src={industry.image}
            alt={industry.imageAlt ?? ""}
            fill
            sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <Motif industry={industry} />
        )}
        {/* Legibility wash. Needed over a photograph, harmless over the motif. */}
        <span
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgb(2_6_10/0.15),rgb(2_6_10/0.86)_78%,var(--pub-card))]"
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
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-[var(--pub-text)]">
                {industry.name}
              </h3>
              <span className="pub-chip shrink-0 !py-1 !text-[10.5px]">{industry.category}</span>
            </div>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--pub-text-secondary)]">
              {industry.promise}
            </p>
          </div>
        </div>

        <ol className="mt-5 flex items-stretch gap-1.5">
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
                  {React.createElement(stageIcons[index], {
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

        <Link
          href={ANCHORS.howItWorks}
          className="pub-link mt-auto pt-5"
          onClick={() => trackEngagement("public_nav_click", `industry:${industry.id}`)}
        >
          View {industry.name.toLowerCase()} solution
          <ArrowRight aria-hidden className="size-4" />
        </Link>
      </div>
    </article>
  );
}

/* =========================================================== section === */

export function IndustriesSection() {
  const scroller = React.useRef<HTMLDivElement>(null);

  /* Below the three-column breakpoint the grid becomes a snap carousel, and
     these controls page it. At xl all six cards are on screen, so the
     controls are hidden rather than left on the page doing nothing. */
  function page(direction: -1 | 1) {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.9, behavior: "smooth" });
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

          <div className="flex shrink-0 items-center gap-4 lg:mt-14">
            <Link href={ANCHORS.howItWorks} className={buttonClass("primary", "lg")}>
              Explore all industries
              <ArrowRight aria-hidden className="size-4" />
            </Link>
            <div className="flex gap-2 xl:hidden">
              <button
                type="button"
                aria-label="Previous industries"
                onClick={() => page(-1)}
                className={buttonClass("secondary", "md", "!w-11 !rounded-full !px-0")}
              >
                <ArrowLeft aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Next industries"
                onClick={() => page(1)}
                className={buttonClass("secondary", "md", "!w-11 !rounded-full !px-0")}
              >
                <ArrowRight aria-hidden className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <p className="pub-small mt-4 lg:text-right">
          Different enquiries. The same conversion engine.
        </p>

        <div
          ref={scroller}
          className="-mx-[var(--pub-gutter)] mt-10 flex snap-x snap-mandatory gap-5 overflow-x-auto px-[var(--pub-gutter)] pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3"
        >
          {INDUSTRIES.map((industry, index) => (
            <Reveal
              key={industry.id}
              delay={(index % 3) * 0.06}
              className="w-[min(86vw,340px)] shrink-0 md:w-auto md:shrink"
            >
              <IndustryCard industry={industry} />
            </Reveal>
          ))}
        </div>

        <ul className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t border-[var(--pub-border)] pt-8">
          {FOOTER_STRIP.map((item) => (
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
