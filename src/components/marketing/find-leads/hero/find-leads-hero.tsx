import Link from "next/link";
import { FlCta } from "../fl-cta";
import { HERO_STEPS } from "../data";
import {
  ArrowRight,
  Chat,
  ChevronRight,
  Database,
  Doc,
  Play,
  Shield,
  Users,
} from "../pieces";
import { FindLeadsHeroChat } from "./find-leads-hero-chat";

const STEP_ICONS = [Chat, Doc, Database, Users];

/**
 * Hero.
 *
 * Copy first and centred, then the workspace: the visual has to say "this is
 * a conversation with an AI that plans a search", which a left-text /
 * right-dashboard split cannot. The headline, body, both calls to action and
 * the four-step summary are all server-rendered text — the page reads
 * completely with JavaScript switched off.
 */
export function FindLeadsHero() {
  return (
    <section className="fl-section fl-hero" aria-labelledby="fl-hero-title">
      <div aria-hidden className="fl-grid-bg" />
      <div aria-hidden className="fl-glow" />

      <div className="fl-wrap">
        <div className="fl-hero-copy">
          <p className="fl-eyebrow">Find Leads</p>
          <h1 className="fl-h1" id="fl-hero-title">
            Describe your ideal customer.
            <span>Build a verified prospect pipeline.</span>
          </h1>
          <p className="fl-lead">
            ClientTurn learns your business context, converts natural language
            into a structured search and lets you review the plan before
            sourcing begins.
          </p>

          <div className="fl-hero-actions">
            <FlCta placement="find_leads_hero_cta">
              Start Finding Leads
              <ArrowRight size={16} />
            </FlCta>
            <Link href="#sourcing" className="fl-btn fl-btn-secondary">
              <span aria-hidden className="fl-btn-play">
                <Play />
              </span>
              See how sourcing works
            </Link>
          </div>

          <p className="fl-trust">
            <Shield size={16} />
            Review targeting and limits before provider spend begins.
          </p>

          {/* Decorative annotations, exactly as in the approved design. */}
          <span aria-hidden className="fl-note fl-note-left">
            From a simple request…
            <svg width="72" height="52" viewBox="0 0 72 52" fill="none">
              <path
                d="M2 3C14 22 34 34 62 41"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M52 34l11 7-13 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span aria-hidden className="fl-note fl-note-right">
            …to a verified prospect pipeline.
            <svg width="72" height="52" viewBox="0 0 72 52" fill="none">
              <path
                d="M70 3C58 22 38 34 10 41"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <path
                d="M20 34L9 41l13 5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </div>

        <FindLeadsHeroChat />

        <ol className="fl-steps">
          {HERO_STEPS.map((step, index) => {
            const StepIcon = STEP_ICONS[index] ?? Chat;
            return (
              <li key={step.title}>
                <span aria-hidden className="fl-step-icon">
                  <StepIcon size={19} />
                </span>
                <div>
                  <strong>
                    <span className="fl-step-index">{index + 1}.</span>{" "}
                    {step.title}
                  </strong>
                  <p>{step.body}</p>
                </div>
                {index < HERO_STEPS.length - 1 && (
                  <ChevronRight
                    aria-hidden
                    size={15}
                    className="ml-auto hidden shrink-0 self-center text-[#2c384d] lg:block"
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
