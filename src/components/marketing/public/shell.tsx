"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { RevealStagger, RevealItem } from "./reveal";

/**
 * Compositions the evaluation pages add to the shared V2 primitives.
 *
 * Layout, typography, buttons, cards and glyph tiles all come from `./ui`
 * and `clientturn.css` — nothing here re-declares them. What lives here is
 * only what /how-it-works, /results, /pricing, /enterprise and /contact-sales
 * compose and the homepage does not: the panel stack, the numbered rail, the
 * stat strip, and the marker that keeps demo figures honest.
 *
 * Styling is in `(marketing)/evaluation.css`, on the same `--pub-*` tokens.
 * Server components throughout — none of this needs the browser.
 */

/**
 * A page section.
 *
 * Sits directly on the page ground — no container surface. The only raised
 * surfaces on these pages are the things that genuinely are objects: a card, a
 * product screen, the closing CTA band. Wrapping every section in a panel as
 * well put a box inside a box and flattened the hierarchy, so sections carry
 * rhythm through spacing and a hairline instead.
 */
export function Band({
  divided = true,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  /** The hairline above the section. Omitted on the first band of a page. */
  divided?: boolean;
}) {
  return (
    <section
      className={cn("pub-band", divided && "pub-band-divided", className)}
      {...props}
    />
  );
}

/** The vertical rhythm of a page's sections. */
export function BandStack({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("pub-band-stack", className)} {...props} />;
}

/**
 * The decorative "CAPTURE -> ENGAGE -> QUALIFY -> ROUTE" strip beside a
 * section eyebrow. Shorthand for the rail below it, so it is hidden from
 * assistive technology rather than read out twice.
 */
export function StepStrip({ steps }: { steps: readonly string[] }) {
  return (
    <ul className="pub-steps-strip" aria-hidden>
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ul>
  );
}

export type Step = {
  title: string;
  body: string;
};

/**
 * The numbered process rail. Horizontal on desktop, a vertical spine on
 * narrow screens — an ordered list either way, so the sequence survives
 * without sight of the connector.
 */
export function StepRail({
  steps,
  variant = "rail",
  className,
}: {
  steps: readonly Step[];
  variant?: "rail" | "timeline";
  className?: string;
}) {
  // Steps arrive in order, which is the one thing the rail is saying.
  return (
    <RevealStagger
      as="ol"
      step={0.09}
      className={cn(variant === "rail" ? "pub-rail" : "pub-timeline", className)}
      style={{ "--pub-rail-steps": steps.length } as React.CSSProperties}
    >
      {steps.map((step, index) => (
        <RevealItem as="li" key={step.title} className="pub-step">
          <span className="pub-step-num" aria-hidden>
            {index + 1}
          </span>
          <h3>{step.title}</h3>
          <p>{step.body}</p>
        </RevealItem>
      ))}
    </RevealStagger>
  );
}

/** The ringed assurance row under a hero. Facts only — never a metric. */
export function TrustRow({
  items,
  className,
}: {
  items: readonly { icon: React.ReactNode; label: string }[];
  className?: string;
}) {
  return (
    <RevealStagger as="ul" step={0.06} className={cn("pub-trust", className)}>
      {items.map((item) => (
        <RevealItem as="li" key={item.label}>
          <span className="pub-ring" aria-hidden>
            {item.icon}
          </span>
          {item.label}
        </RevealItem>
      ))}
    </RevealStagger>
  );
}

export function StatStrip({
  items,
  className,
}: {
  items: readonly { value: string; label: string }[];
  className?: string;
}) {
  return (
    <dl
      className={cn("pub-stats", className)}
      style={{ "--pub-stat-cols": items.length } as React.CSSProperties}
    >
      {items.map((item) => (
        <div key={item.label} className="pub-stat">
          <dt>
            <b>{item.value}</b>
          </dt>
          <dd>
            <span>{item.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type StateTone = "go" | "info" | "hold" | "stop" | "muted";

/**
 * A system state, in the product's own vocabulary.
 *
 * Lime means "the system is doing what you configured" rather than "healthy":
 * the public site never uses green as a status colour.
 */
export function StatePill({
  tone,
  children,
}: {
  tone: StateTone;
  children: React.ReactNode;
}) {
  return (
    <span className="pub-state" data-tone={tone}>
      {children}
    </span>
  );
}

/**
 * Marks every figure on a public page that came from a demo fixture.
 *
 * A screenshot of the product is evidence that the product exists. It is not
 * evidence of what customers achieve, and nothing on these pages is allowed
 * to blur the two — so no surface renders metrics without one of these.
 */
export function IllustrativeTag({
  surface = "dark",
  children = "Illustrative data",
}: {
  surface?: "dark" | "light";
  children?: React.ReactNode;
}) {
  return (
    <span className={cn("pub-demo-tag", surface === "light" && "pub-demo-tag-light")}>
      {children}
    </span>
  );
}
