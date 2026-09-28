"use client";

import * as React from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Bot, CalendarCheck, FileText, Mic, ShieldCheck, TriangleAlert, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { CALL_BUDGET_MINUTES } from "@/lib/marketing/voice-offer";
import { IllustrativeTag } from "../shell";
import {
  CALL_CAPTIONS,
  CALL_ELAPSED_SEC,
  CALL_EVENTS,
  CALL_FACTS,
  EXAMPLE,
  ILLUSTRATIVE_LABEL,
  type CallEvent,
} from "./data";

/**
 * The live-call visual: a compact voice call, not a chat.
 *
 * Two parties with their own waveform (only the active speaker's moves), the
 * call timer inside the 5 minute time-governor ring, one live caption at a
 * time that swaps as the call plays, and the in-call events lighting up as
 * chips. The first caption is always the locked AI-disclosure opener from
 * `lib/voice/opener.ts`; the recording notice is a chip.
 *
 * Motion: captions cycle through Motion only while the card is on screen.
 * Under `prefers-reduced-motion` nothing cycles: the card shows the opener as
 * the representative caption with every event lit, which is also exactly what
 * the server renders, so hydration never mismatches.
 */

const BUDGET_SEC = CALL_BUDGET_MINUTES * 60;
/** Qualification route target is 210 s; amber from 75% of it (time-governor.ts). */
const AMBER_FROM_SEC = Math.round(210 * 0.75);
const RING_R = 27;
const RING_C = 2 * Math.PI * RING_R;
const STEP_MS = 2800;
const LOOP_PAUSE_MS = 2200;
const BARS = 14;

/** Deterministic bar heights, so server and client render the same markup. */
function barHeights(seed: number): number[] {
  return Array.from({ length: BARS }, (_, i) => {
    const v = Math.abs(Math.sin((i + seed) * 1.7) * 0.6 + Math.sin((i + seed) * 0.53) * 0.4);
    return Math.round(22 + v * 78);
  });
}
const AGENT_BARS = barHeights(0);
const LEAD_BARS = barHeights(5);

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Index -1 is the resting state: opener caption, every event lit, final time. */
const REST = -1;

function Party({
  role,
  name,
  sub,
  bars,
  speaking,
}: {
  role: "agent" | "lead";
  name: string;
  sub: string;
  bars: number[];
  speaking: boolean;
}) {
  const Icon = role === "agent" ? Bot : User;
  return (
    <div className="rv-party" data-role={role} data-speaking={speaking ? "true" : undefined}>
      <span className="rv-avatar" data-tone={role === "agent" ? "agent" : undefined}>
        <Icon className="size-4" strokeWidth={2.1} />
      </span>
      <span className="min-w-0">
        <b>{name}</b>
        <small>{sub}</small>
        <span className="rv-party-wave" aria-hidden>
          {bars.map((h, i) => (
            <i key={i} style={{ "--h": `${h}%`, "--i": i } as React.CSSProperties} />
          ))}
        </span>
      </span>
    </div>
  );
}

export function LiveCallMock({ className }: { className?: string }) {
  const ref = React.useRef<HTMLElement>(null);
  const onScreen = useInView(ref, { amount: 0.4 });
  const reduced = useReducedMotion();
  const [step, setStep] = React.useState<number>(REST);

  // Cycle the captions only while on screen and only when motion is allowed.
  React.useEffect(() => {
    if (reduced || !onScreen) return;
    const last = CALL_CAPTIONS.length - 1;
    const delay = step === last ? STEP_MS + LOOP_PAUSE_MS : step === REST ? 400 : STEP_MS;
    const timer = window.setTimeout(() => {
      setStep((current) => (current === REST || current >= last ? 0 : current + 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [step, onScreen, reduced]);

  const resting = step === REST;
  const caption = CALL_CAPTIONS[resting ? 0 : step];
  const elapsed = resting ? CALL_ELAPSED_SEC : caption.at;
  const reached = new Set<CallEvent>(
    resting
      ? CALL_EVENTS.map((event) => event.key)
      : CALL_CAPTIONS.slice(0, step + 1).flatMap((line) => (line.event ? [line.event] : [])),
  );
  const speaker = resting ? null : caption.speaker;
  const amber = elapsed >= AMBER_FROM_SEC;
  const offset = RING_C * (1 - Math.min(1, elapsed / BUDGET_SEC));

  return (
    <figure
      ref={ref}
      className={cn("rv-frame rv-call", className)}
      data-live={!resting && onScreen ? "true" : undefined}
      aria-label={`${ILLUSTRATIVE_LABEL}: a live AI sales call. It opens by saying it is an AI assistant calling from ${EXAMPLE.business}, gives a recording notice, handles a price objection, sends quote ${EXAMPLE.quoteNumber} and books a meeting. Call time ${clock(CALL_ELAPSED_SEC)} of a ${CALL_BUDGET_MINUTES} minute budget.`}
    >
      <div className="rv-frame-bar">
        <span className="rv-live">
          <span className="rv-live-dot" aria-hidden />
          Live call
        </span>
        <span className="rv-frame-meta">Qualification route</span>
        <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
      </div>

      <div className="rv-call-grid">
        <div className="rv-call-main">
          <div className="rv-call-parties" aria-hidden>
            <Party
              role="agent"
              name="AI Sales Agent"
              sub={`for ${EXAMPLE.business}`}
              bars={AGENT_BARS}
              speaking={speaker === "agent"}
            />
            <div className="rv-governor" data-amber={amber ? "true" : undefined}>
              <svg viewBox="0 0 64 64" width="64" height="64">
                <circle cx="32" cy="32" r={RING_R} className="rv-ring-track" />
                <circle
                  cx="32"
                  cy="32"
                  r={RING_R}
                  className="rv-ring-fill"
                  strokeDasharray={RING_C}
                  strokeDashoffset={offset}
                  transform="rotate(-90 32 32)"
                />
              </svg>
              <span className="rv-clock">{clock(elapsed)}</span>
              <small>of {clock(BUDGET_SEC)}</small>
            </div>
            <Party
              role="lead"
              name={EXAMPLE.lead}
              sub={EXAMPLE.company}
              bars={LEAD_BARS}
              speaking={speaker === "lead"}
            />
          </div>

          <div className="rv-caption" aria-live="off">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={resting ? "rest" : step}
                className="rv-caption-line"
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
              >
                <span className="rv-caption-who">
                  <Mic aria-hidden className="size-3" />
                  {caption.speaker === "agent" ? "Agent" : EXAMPLE.lead.split(" ")[0]}
                  {(resting || step === 0) && (
                    <span className="rv-tag">
                      <ShieldCheck aria-hidden className="size-3" />
                      AI disclosure
                    </span>
                  )}
                </span>
                <span className="rv-caption-text">{caption.text}</span>
              </motion.p>
            </AnimatePresence>
          </div>

          <ul className="rv-events" aria-label="Call events">
            <li className="rv-chip" data-tone="muted" data-on="true">
              <ShieldCheck aria-hidden className="size-3.5" />
              Recording notice given
            </li>
            {CALL_EVENTS.map((event) => {
              const Icon = event.key === "objection" ? TriangleAlert : event.key === "quote" ? FileText : CalendarCheck;
              return (
                <li
                  key={event.key}
                  className="rv-chip"
                  data-tone={event.tone}
                  data-on={reached.has(event.key) ? "true" : undefined}
                >
                  <Icon aria-hidden className="size-3.5" />
                  {event.label}
                </li>
              );
            })}
          </ul>
        </div>

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
        </aside>
      </div>
    </figure>
  );
}
