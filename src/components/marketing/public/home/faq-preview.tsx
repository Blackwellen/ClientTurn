"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { trackEngagement } from "@/lib/marketing/track";
import { Arc, Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { HOME_FAQS, type HomeFaq } from "./faq-data";

/**
 * FAQ preview.
 *
 * A disclosure list, not a tab set: each row is an independent
 * button + region pair and several may be open at once. Rows expand in place
 * inside their own card, so opening one never moves the row beside it.
 *
 * Every answer states something the product or the Terms actually commit to.
 * The trial length is read from the plan catalogue rather than written out,
 * so it cannot drift from what checkout grants.
 */

function FaqRow({ faq, index }: { faq: HomeFaq; index: number }) {
  const [open, setOpen] = React.useState(false);
  const id = `faq-${index}`;

  return (
    <li className="pub-card pub-card-interactive">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          id={`${id}-trigger`}
          onClick={() => {
            const next = !open;
            setOpen(next);
            if (next) trackEngagement("home_faq_expand", faq.q.slice(0, 60));
          }}
          className="flex w-full items-start gap-3.5 p-5 text-left"
        >
          <span className="pub-tile mt-0.5" style={{ width: 38, height: 38, borderRadius: 10 }}>
            <faq.icon className="size-4.5" strokeWidth={2.1} />
          </span>
          <span className="flex-1 pt-1.5 text-[15px] font-semibold leading-snug text-[var(--pub-text)]">
            {faq.q}
          </span>
          {/* A plus that becomes a minus: the two strokes are stacked on top
              of one another, and only the vertical one rotates away. */}
          <span
            aria-hidden
            className="relative mt-1.5 block size-4 shrink-0 text-[var(--pub-text-muted)]"
          >
            <span className="absolute left-0 top-1/2 block h-px w-4 -translate-y-1/2 bg-current" />
            <span
              className={cn(
                "absolute left-1/2 top-0 block h-4 w-px -translate-x-1/2 bg-current transition-transform duration-200",
                open ? "scale-y-0" : "scale-y-100",
              )}
            />
          </span>
        </button>
      </h3>
      <div
        id={`${id}-panel`}
        role="region"
        aria-labelledby={`${id}-trigger`}
        hidden={!open}
        className="px-5 pb-5 pl-[70px]"
      >
        <p className="text-[13.5px] leading-relaxed text-[var(--pub-text-secondary)]">{faq.a}</p>
      </div>
    </li>
  );
}

export function FaqPreviewSection() {
  return (
    <PublicSection
      id="faq"
      labelledBy="faq-heading"
      decoration={
        <>
          <GridTexture />
          <Arc corner="bl" />
          <Glow x="centre" y="bottom" />
        </>
      }
    >
      <PublicContainer narrow>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="pub-eyebrow">FAQ</p>
            <h2 id="faq-heading" className="pub-h2 mt-5 !text-[clamp(1.8rem,2.9vw,2.6rem)]">
              Questions before you start?
            </h2>
            <p className="pub-lead mt-6">
              Here are the questions people ask most often. For the commercial detail, see the
              pricing section above or the Terms.
            </p>
          </div>
          <Link href={"/pricing"} className={buttonClass("secondary", "lg", "shrink-0 lg:mt-14")}>
            See pricing
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>

        <ul className="mt-12 grid items-start gap-4 lg:grid-cols-2">
          {HOME_FAQS.map((faq, index) => (
            <FaqRow key={faq.q} faq={faq} index={index} />
          ))}
        </ul>
      </PublicContainer>
    </PublicSection>
  );
}
