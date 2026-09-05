import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Container } from "../section";

/**
 * One shell for every section after the cinematic story.
 *
 * The page is a single continuous descent from the 3D world into the footer, so sections never
 * introduce their own background colour or a hard rule across the page. They take a `depth` step
 * instead, which maps to a shared background ramp, and an optional `glow` that places one soft lime
 * bloom behind the content. Intensity reduces as the visitor moves closer to the buying decision.
 */
export type SectionDepth = 0 | 1 | 2 | 3;

const DEPTH_CLASS: Record<SectionDepth, string> = {
  0: "ct-depth-0",
  1: "ct-depth-1",
  2: "ct-depth-2",
  3: "ct-depth-3",
};

export function MarketingSection({
  id, depth = 0, glow, className, children, labelledBy,
}: {
  id?: string;
  depth?: SectionDepth;
  glow?: "left" | "right" | "centre";
  className?: string;
  children: ReactNode;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("ct-section", DEPTH_CLASS[depth], className)}>
      {glow && <span className="ct-section-glow" data-position={glow} aria-hidden />}
      {children}
    </section>
  );
}

/** Eyebrow, headline and one supporting sentence. The same rhythm in every section. */
export function SectionIntro({
  eyebrow, title, lead, id, align = "left", aside,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  id?: string;
  align?: "left" | "centre";
  aside?: ReactNode;
}) {
  return (
    <Container>
      <div className={cn("ct-intro", align === "centre" && "ct-intro-centre", aside && "ct-intro-split")}>
        <div>
          <p className="ct-section-eyebrow">{eyebrow}</p>
          <h2 id={id}>{title}</h2>
          {lead && <p className="ct-section-lead">{lead}</p>}
        </div>
        {aside && <div className="ct-intro-aside">{aside}</div>}
      </div>
    </Container>
  );
}
