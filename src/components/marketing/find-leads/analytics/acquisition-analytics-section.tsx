import { ANALYTICS_METRICS, FUNNEL_STEPS, PROVIDER_ROWS } from "../data";
import {
  AppSurface,
  Badge,
  ChapterHead,
  FlSection,
} from "../pieces";
import { AcquisitionFunnel, ProviderBars, MetricTiles } from "./funnel";

/**
 * Acquisition analytics.
 *
 * The funnel is the page's argument in one picture: what it costs to build
 * pipeline, and what survives each step. Every figure is an interface
 * demonstration and the panel says so — a marketing page that presents sample
 * analytics as customer results is making a claim it cannot support.
 */
export function AcquisitionAnalyticsSection() {
  const widest = FUNNEL_STEPS[0].value;

  return (
    <FlSection id="analytics" glow="right">
      <ChapterHead
        eyebrow="Acquisition analytics"
        title="See what it costs to build pipeline —"
        accent="and what converts."
        aside="Sourcing, verification, outreach and prospect-to-lead performance, measured from one acquisition journey."
      />

      <div className="fl-split">
        <AppSurface
          title="Acquisition funnel"
          subtitle="Illustrative figures, not customer results"
          actions={<Badge tone="lime">Demo</Badge>}
        >
          <AcquisitionFunnel steps={FUNNEL_STEPS} widest={widest} />
        </AppSurface>

        <AppSurface
          title="Where the sourcing effort went"
          subtitle="By provider capability"
        >
          <ProviderBars rows={PROVIDER_ROWS} />
          <p className="fl-note-line">
            Capability, not vendor pricing. Raw provider unit costs stay
            internal — what you see is your own spend against your own
            allowance.
          </p>
        </AppSurface>
      </div>

      <MetricTiles items={ANALYTICS_METRICS} />
    </FlSection>
  );
}
