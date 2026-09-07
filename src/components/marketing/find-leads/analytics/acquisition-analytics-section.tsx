import { ANALYTICS_METRICS, FUNNEL_STEPS, PROVIDER_ROWS } from "../data";
import {
  AppSurface,
  Badge,
  ChapterHead,
  FlSection,
} from "../pieces";

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
          <ul className="fl-funnel">
            {FUNNEL_STEPS.map((step) => (
              <li key={step.label}>
                <span className="fl-funnel-label">{step.label}</span>
                <span className="fl-funnel-bar" aria-hidden>
                  <span
                    style={{
                      width: `${Math.max((step.value / widest) * 100, 4)}%`,
                    }}
                  />
                </span>
                <span className="fl-funnel-value">
                  {step.value.toLocaleString("en-GB")}
                </span>
              </li>
            ))}
          </ul>
        </AppSurface>

        <AppSurface
          title="Where the sourcing effort went"
          subtitle="By provider capability"
        >
          <ul className="fl-bars">
            {PROVIDER_ROWS.map((row) => (
              <li key={row.label}>
                <div>
                  <strong>{row.label}</strong>
                  <small>{row.detail}</small>
                </div>
                <span className="fl-bars-track" aria-hidden>
                  <span style={{ width: `${row.share}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="fl-note-line">
            Capability, not vendor pricing. Raw provider unit costs stay
            internal — what you see is your own spend against your own
            allowance.
          </p>
        </AppSurface>
      </div>

      <ul className="fl-metrics" style={{ marginTop: 22 }}>
        {ANALYTICS_METRICS.map((metric) => (
          <li className="fl-metric" key={metric.label}>
            <b>{metric.value}</b>
            <span>{metric.label}</span>
          </li>
        ))}
      </ul>
    </FlSection>
  );
}
