import * as React from "react";
import { Check } from "lucide-react";
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
  assurances,
  points,
}: {
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  actions: React.ReactNode;
  /** Short reassurances under the buttons, as the reference lays them out. */
  assurances?: readonly string[];
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

          {assurances && (
            <ul className="pub-assurances">
              {assurances.map((item) => (
                <li key={item}>
                  <Check aria-hidden className="size-3.5" />
                  {item}
                </li>
              ))}
            </ul>
          )}
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
