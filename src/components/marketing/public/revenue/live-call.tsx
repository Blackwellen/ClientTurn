"use client";

import * as React from "react";
import { Bot, FileText, PhoneCall, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { CALL_BUDGET_MINUTES } from "@/lib/marketing/voice-offer";
import { IllustrativeTag } from "../shell";
import {
  CALL_ELAPSED_SEC,
  CALL_FACTS,
  CALL_TRANSCRIPT,
  EXAMPLE,
  ILLUSTRATIVE_LABEL,
} from "./data";

/**
 * The live-call mock: waveform, call timer inside the 5 minute time-governor
 * ring, the locked AI-disclosure opener, a detected objection and the "quote
 * sent" event.
 *
 * Built from product-like markup, not an image. Every name and figure is an
 * illustrative example and labelled as one; the opener and the recording
 * notice are the real locked strings from `lib/voice/opener.ts`.
 *
 * Motion is lazy: nothing moves until the card scrolls into view, and under
 * `prefers-reduced-motion` the timer shows its final value, the waveform is
 * static and the transcript is simply there.
 */

const BUDGET_SEC = CALL_BUDGET_MINUTES * 60;
/** Qualification route target is 210 s; amber from 75% of it (time-governor.ts). */
const AMBER_FROM_SEC = Math.round(210 * 0.75);
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;
const BARS = 36;

/** Deterministic bar heights, so server and client render the same markup. */
const BAR_HEIGHTS = Array.from({ length: BARS }, (_, i) => {
  const v = Math.abs(Math.sin(i * 1.7) * 0.6 + Math.sin(i * 0.53) * 0.4);
  return Math.round(18 + v * 82);
});

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function useInViewOnce<T extends Element>(amount = 0.35) {
  const ref = React.useRef<T>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const node = ref.current;
    if (!node || inView || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setInView(true);
      },
      { threshold: amount },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [amount, inView]);
  return [ref, inView] as const;
}

export function LiveCallMock({ className }: { className?: string }) {
  const [ref, inView] = useInViewOnce<HTMLElement>();
  const [armed, setArmed] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(CALL_ELAPSED_SEC);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: enables the entrance once JS runs.
    setArmed(true);
  }, []);

  React.useEffect(() => {
    if (!inView) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const duration = 3600;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setElapsed(Math.round(eased * CALL_ELAPSED_SEC));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView]);

  const amber = elapsed >= AMBER_FROM_SEC;
  const offset = RING_C * (1 - Math.min(1, elapsed / BUDGET_SEC));

  return (
    <figure
      ref={ref}
      data-armed={armed ? "true" : undefined}
      data-inview={inView ? "true" : undefined}
      className={cn("rv-frame rv-call rv-inview", className)}
      aria-label={`${ILLUSTRATIVE_LABEL}: a live AI sales call. The assistant opens by saying it is an AI calling from ${EXAMPLE.business}, gives the recording notice, qualifies the project, detects a price objection, answers it and sends quote ${EXAMPLE.quoteNumber}. Call time 3 minutes 24 seconds of a ${CALL_BUDGET_MINUTES} minute budget.`}
    >
      <div className="rv-frame-bar">
        <span className="rv-live">
          <span className="rv-live-dot" aria-hidden />
          Live call
        </span>
        <span className="rv-frame-meta">Qualification route</span>
        <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
      </div>

      <div className="rv-call-head" aria-hidden>
        <div className="rv-party">
          <span className="rv-avatar" data-tone="agent">
            <Bot className="size-4" strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <b>AI Sales Agent</b>
            <small>for {EXAMPLE.business}</small>
          </span>
        </div>
        <PhoneCall className="rv-call-link size-4" strokeWidth={2} />
        <div className="rv-party">
          <span className="rv-avatar">
            <User className="size-4" strokeWidth={2.1} />
          </span>
          <span className="min-w-0">
            <b>{EXAMPLE.lead}</b>
            <small>{EXAMPLE.company}</small>
          </span>
        </div>

        <div className="rv-governor" data-amber={amber ? "true" : undefined}>
          <svg viewBox="0 0 72 72" width="72" height="72">
            <circle cx="36" cy="36" r={RING_R} className="rv-ring-track" />
            <circle
              cx="36"
              cy="36"
              r={RING_R}
              className="rv-ring-fill"
              strokeDasharray={RING_C}
              strokeDashoffset={offset}
              transform="rotate(-90 36 36)"
            />
          </svg>
          <span className="rv-clock">{clock(elapsed)}</span>
          <small>of {clock(BUDGET_SEC)}</small>
        </div>
      </div>

      <div className="rv-wave" aria-hidden>
        {BAR_HEIGHTS.map((h, i) => (
          <span key={i} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />
        ))}
      </div>

      <div className="rv-call-body">
        <ol className="rv-transcript">
          {CALL_TRANSCRIPT.map((line, index) => {
            const style = { "--i": index } as React.CSSProperties;
            if (line.kind === "chip") {
              return (
                <li key={index} className="rv-stagger rv-line-chip" style={style}>
                  <span className="rv-chip" data-tone="amber">
                    <TriangleAlert aria-hidden className="size-3.5" />
                    {line.text}
                  </span>
                </li>
              );
            }
            if (line.kind === "event") {
              return (
                <li key={index} className="rv-stagger rv-line-event" style={style}>
                  <span className="rv-chip" data-tone="lime">
                    <FileText aria-hidden className="size-3.5" />
                    {line.text}
                  </span>
                </li>
              );
            }
            return (
              <li key={index} className="rv-stagger rv-line" data-speaker={line.kind} style={style}>
                <span className="rv-speaker">
                  {line.kind === "agent" ? "Agent" : EXAMPLE.lead.split(" ")[0]}
                  {line.kind === "agent" && line.tag ? (
                    <span className="rv-tag">
                      <ShieldCheck aria-hidden className="size-3" />
                      {line.tag}
                    </span>
                  ) : null}
                </span>
                <q>{line.text}</q>
              </li>
            );
          })}
        </ol>

        <aside className="rv-facts" aria-label="Captured on the call">
          <p className="rv-facts-title">Captured on the call</p>
          <dl>
            {CALL_FACTS.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <p className="rv-facts-note">
            Written to the lead record against your qualification questions. Your rules decide the
            verdict, not the model.
          </p>
        </aside>
      </div>
    </figure>
  );
}
