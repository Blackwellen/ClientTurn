"use client";

import {
  CountUp,
  fadeUp,
  funnelReveal,
  motion,
  stagger,
  useReducedMotion,
} from "../motion";

/**
 * The animated parts of the analytics section.
 *
 * Split out so the section itself stays a Server Component: only the three
 * charts need the browser, and shipping the surrounding copy to the client
 * would be paying hydration for text that never changes.
 *
 * Every bar grows from its own left edge via `scaleX`, which the compositor
 * can do on its own thread — animating `width` here would lay the whole panel
 * out again on every frame.
 */

export function AcquisitionFunnel({
  steps,
  widest,
}: {
  steps: readonly { label: string; value: number }[];
  widest: number;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="fl-funnel"
      initial={reduced ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount: 0.25 }}
      variants={stagger(reduced ? 0 : 0.08)}
    >
      {steps.map((step) => (
        <motion.li key={step.label} variants={fadeUp}>
          <span className="fl-funnel-label">{step.label}</span>
          <span className="fl-funnel-bar" aria-hidden>
            <motion.span
              style={{ width: `${Math.max((step.value / widest) * 100, 4)}%` }}
              variants={funnelReveal}
            />
          </span>
          <span className="fl-funnel-value">
            <CountUp value={step.value} />
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

export function ProviderBars({
  rows,
}: {
  rows: readonly { label: string; detail: string; share: number }[];
}) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="fl-bars"
      initial={reduced ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount: 0.3 }}
      variants={stagger(reduced ? 0 : 0.08)}
    >
      {rows.map((row) => (
        <motion.li key={row.label} variants={fadeUp}>
          <div>
            <strong>{row.label}</strong>
            <small>{row.detail}</small>
          </div>
          <span className="fl-bars-track" aria-hidden>
            <motion.span
              style={{ width: `${row.share}%`, transformOrigin: "left center" }}
              variants={funnelReveal}
            />
          </span>
        </motion.li>
      ))}
    </motion.ul>
  );
}

export function MetricTiles({
  items,
}: {
  items: readonly { label: string; value: string }[];
}) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="fl-metrics"
      style={{ marginTop: 22 }}
      initial={reduced ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount: 0.2 }}
      variants={stagger(reduced ? 0 : 0.05)}
    >
      {items.map((metric) => (
        <motion.li className="fl-metric" key={metric.label} variants={fadeUp}>
          <b>{metric.value}</b>
          <span>{metric.label}</span>
        </motion.li>
      ))}
    </motion.ul>
  );
}
