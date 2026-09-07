import * as React from "react";
import { PublicCard, SectionHeading } from "./ui";

/**
 * The band every evaluation page closes on: eyebrow, headline, one supporting
 * sentence, the page's two actions, and four ringed points alongside.
 *
 * The actions are passed in rather than fixed, because /enterprise and
 * /contact-sales close on a sales conversation while the others close on a
 * trial. Putting "Start Free" everywhere would push a procurement-led buyer
 * into the self-serve funnel they were explicitly avoiding.
 */
export function FinalCtaBand({
  eyebrow,
  title,
  body,
  actions,
  points,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  actions: React.ReactNode;
  points: readonly { icon: React.ReactNode; title: string; body: string }[];
}) {
  return (
    <PublicCard as="section" lit className="pub-panel" aria-labelledby="final-cta-heading">
      <div className="pub-final">
        <div>
          <SectionHeading
            id="final-cta-heading"
            eyebrow={eyebrow}
            title={title}
            description={body}
          />
          <div className="mt-8 flex flex-wrap items-center gap-3">{actions}</div>
        </div>

        <ul className="pub-final-points">
          {points.map((point) => (
            <li key={point.title}>
              <span className="pub-ring" aria-hidden>
                {point.icon}
              </span>
              <span>
                <strong>{point.title}</strong>
                <span>{point.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </PublicCard>
  );
}
