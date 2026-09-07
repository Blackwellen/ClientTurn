import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import { PublicCta } from "../cta-link";
import { Glow, GridTexture, PublicContainer, PublicSection, buttonClass } from "../ui";
import { HeroFlowMap, HeroFlowStack } from "./hero-flow-map";
import { ScrollDraw } from "./scroll-draw";

/**
 * Homepage hero.
 *
 * A Server Component: the only interactive things on it are two links, and
 * the flow map animates entirely in CSS. Nothing here blocks or delays the
 * largest contentful paint, which is the H1.
 *
 * The trust line states the trial terms that are actually configured
 * (`TRIAL_DAYS`) and contracted for in the Terms — it is not design copy.
 */
export function Hero() {
  return (
    <PublicSection
      labelledBy="hero-heading"
      className="!pt-10 sm:!pt-14"
      decoration={
        <>
          <GridTexture />
          <Glow x="right" y="top" style={{ width: "min(1400px, 130vw)" }} />
          <Glow x="left" y="bottom" style={{ opacity: 0.7 }} />
          {/* The wide arc sweeping up from the lower left, as approved. */}
          <div
            className="pub-arc"
            data-corner="bl"
            style={{ bottom: "-118vw", left: "-84vw" }}
          />
        </>
      }
    >
      <PublicContainer>
        <div className="grid items-center gap-14 xl:min-h-[760px] xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] xl:gap-10">
          <div className="max-w-2xl">
            <p className="pub-eyebrow">AI Lead Acquisition &amp; Conversion</p>

            <h1 id="hero-heading" className="pub-h1 mt-7">
              Respond faster.
              <br />
              Qualify automatically.
              <br />
              <span className="pub-accent">Convert more opportunities.</span>
            </h1>

            <p className="pub-lead mt-8 max-w-xl">
              ClientTurn helps you manage inbound leads and build new pipeline — with follow-up,
              qualification, booking, reactivation and AI-assisted prospecting in one system.
            </p>

            <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
              <PublicCta placement="hero_primary" size="lg" arrow className="sm:min-w-[200px]">
                Start Free
              </PublicCta>
              {/* No play glyph: there is no video behind this, and an icon
                  that promises one is a small lie. It goes to the How It
                  Works page. */}
              <Link
                href="/how-it-works"
                className={buttonClass("secondary", "lg", "sm:min-w-[220px]")}
              >
                See how it works
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            </div>

            <p className="pub-small mt-6">
              {TRIAL_DAYS}-day free trial <span aria-hidden className="px-2">&middot;</span> No card
              required
            </p>
          </div>

          {/* The flow map is decorative reinforcement of the copy beside it —
              every claim it depicts is already stated in the paragraph above,
              so it is hidden from assistive technology rather than narrated
              node by node. */}
          <ScrollDraw>
            <div aria-hidden>
              <HeroFlowMap className="hidden xl:block" />
              <HeroFlowStack className="xl:hidden" />
            </div>
          </ScrollDraw>
        </div>
      </PublicContainer>
    </PublicSection>
  );
}
