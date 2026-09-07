"use client";

import * as React from "react";
import { trackEngagement, type EngagementEvent } from "@/lib/marketing/track";
import { SectionHeading } from "./ui";

export type FaqItem = {
  q: string;
  a: string;
};

/**
 * The two-column FAQ used on the evaluation pages.
 *
 * A disclosure pattern, not a tab set: each row is an independent
 * button + region pair, several can be open at once, and roving arrow-key
 * movement between triggers means a keyboard user is not forced to tab
 * through an expanded answer to reach the next question.
 *
 * Reading order follows the DOM (question 1, 2, 3 …) while CSS lays the rows
 * out in two columns, so the announced order and the visual order agree.
 */
export function PublicFaq({
  id,
  eyebrow,
  title,
  aside,
  items,
  event,
}: {
  id: string;
  eyebrow: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  items: readonly FaqItem[];
  /** Fired once, the first time any row is expanded. Never on collapse. */
  event?: EngagementEvent;
}) {
  const [open, setOpen] = React.useState<ReadonlySet<number>>(new Set());
  const triggers = React.useRef<(HTMLButtonElement | null)[]>([]);
  const reported = React.useRef(false);

  function toggle(index: number) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
        if (event && !reported.current) {
          reported.current = true;
          trackEngagement(event);
        }
      }
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    let next: number | null = null;

    if (e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;

    if (next !== null) {
      e.preventDefault();
      triggers.current[next]?.focus();
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <SectionHeading id={`${id}-heading`} eyebrow={eyebrow} title={title} />
        {aside}
      </div>

      <div className="pub-faq">
        {items.map((item, index) => {
          const expanded = open.has(index);
          return (
            <div key={item.q} className="pub-faq-row">
              <h3>
                <button
                  type="button"
                  ref={(node) => {
                    triggers.current[index] = node;
                  }}
                  id={`${id}-q-${index}`}
                  aria-expanded={expanded}
                  aria-controls={`${id}-a-${index}`}
                  onClick={() => toggle(index)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  className="pub-faq-trigger"
                >
                  <span>{item.q}</span>
                  <span className="pub-faq-sign" aria-hidden />
                </button>
              </h3>
              <div
                id={`${id}-a-${index}`}
                role="region"
                aria-labelledby={`${id}-q-${index}`}
                hidden={!expanded}
                className="pub-faq-panel"
              >
                <p>{item.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/**
 * FAQPage structured data for a block of questions.
 *
 * Only ever rendered alongside the same questions and answers the visitor can
 * see on the page. Schema describing content that is not visible is a
 * guidelines violation, not a shortcut to a rich result.
 */
export function FaqJsonLd({ items }: { items: readonly FaqItem[] }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON-LD built from a local constant; no user input reaches this string.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
