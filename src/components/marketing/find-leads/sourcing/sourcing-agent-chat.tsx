"use client";

import * as React from "react";
import Link from "next/link";
import { COUNTER_DEFINITIONS } from "@/lib/find-leads/types";
import { trackEngagement } from "@/lib/marketing/track";
import {
  AnimatedBar,
  CountUp,
  fadeUp,
  motion,
  runStageAdvance,
  stagger,
  useSequence,
  T,
} from "../motion";
import {
  DEMO_STAGES,
  HERO_REQUEST,
  RUN_COUNTERS,
  RUN_TILES,
  type DemoStage,
} from "../data";
import {
  AppSurface,
  Badge,
  BrandMark,
  Check,
  ChevronDown,
  ChevronRight,
  Pause,
  Pencil,
  Spinner,
} from "../pieces";

/**
 * The sourcing run, presented as agent activity rather than a job console.
 *
 * The distinction matters commercially: a customer paying for sourcing wants
 * to see work being done on their behalf, and a terminal-styled log of
 * provider calls reads as somebody else's infrastructure. So the twelve stages
 * live inside the agent conversation, described in the product's own words —
 * every string comes from `STAGES`, not from this file.
 *
 * The run advances from stage 4 to stage 8 and then stops. Progress is
 * `completed / 12`, exactly as `progressPercent` computes it, so the bar can
 * never creep toward 100% while the work is actually stalled.
 */

/** Stages the demo completes after the resting frame. */
const ADVANCE = 5;

function statusWord(stage: DemoStage): string {
  switch (stage.status) {
    case "COMPLETED":
      return "Completed";
    case "RUNNING":
      return stage.count ? stage.count.toLocaleString("en-GB") : "Running";
    case "PAUSED":
      return "Review required";
    case "FAILED":
      return "Failed";
    default:
      return "Pending";
  }
}

export function SourcingAgentChat() {
  const { ref, step, reduced } = useSequence<HTMLDivElement>(ADVANCE, 1300);

  /**
   * Applies the demo's advance to the canonical stage list: each tick
   * completes the running stage and starts the next one.
   */
  const stages = React.useMemo<DemoStage[]>(() => {
    const frontier = 4 + step;
    return DEMO_STAGES.map((stage) => {
      if (stage.number < frontier) {
        return {
          ...stage,
          status: "COMPLETED",
          duration: stage.duration ?? `${15 + stage.number * 4}s`,
        };
      }
      if (stage.number === frontier) return { ...stage, status: "RUNNING" };
      return { ...stage, status: "PENDING", count: null, duration: null };
    });
  }, [step]);

  const done = stages.filter((s) => s.status === "COMPLETED").length;
  const percent = Math.round((done / stages.length) * 100);
  const current = Math.min(done + 1, stages.length);

  return (
    <AppSurface
      title="Sourcing in progress"
      subtitle={`Stage ${current} of ${stages.length}`}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone="lime" dot>
            Running
          </Badge>
          <span className="fl-mini-btn">
            <Pause size={11} />
            Pause
            <ChevronDown size={10} />
          </span>
        </div>
      }
      footer={
        <div className="fl-app-foot">
          <span className="fl-mini-btn">
            Run details
            <ChevronRight size={11} />
          </span>
          <span>You will be notified when it is ready.</span>
        </div>
      }
    >
      <div ref={ref}>
        {/* The request the run is executing, still editable. */}
        <div className="fl-run-request">
          <span aria-hidden className="fl-avatar" style={{ width: 26, height: 26 }}>
            <BrandMark size={14} />
          </span>
          <p>{HERO_REQUEST}</p>
          <span className="fl-mini-btn">
            <Pencil size={11} />
            Edit
          </span>
        </div>

        <div className="fl-progress">
          <AnimatedBar
            percent={percent}
            className="fl-progress-track"
            fillClassName="fl-progress-fill"
            label="Sourcing run progress"
          />
          <b>{percent}%</b>
        </div>

        <motion.ul
          className="fl-tiles"
          initial={reduced ? "shown" : "hidden"}
          whileInView="shown"
          viewport={{ once: true, amount: 0.4 }}
          variants={stagger(reduced ? 0 : 0.07)}
        >
          {RUN_TILES.map((tile) => (
            <motion.li className="fl-tile" key={tile.label} variants={fadeUp}>
              <b>{tile.value}</b>
              <span>{tile.label}</span>
            </motion.li>
          ))}
        </motion.ul>

        {/* ---------------------------------------------- the twelve stages */}
        <ol className="fl-stages" aria-label="Sourcing stages">
          {stages.map((stage) => (
            <motion.li
              key={stage.number}
              className="fl-stage"
              data-status={stage.status}
              initial={reduced ? "shown" : "hidden"}
              animate="shown"
              variants={runStageAdvance}
              transition={T.fast}
            >
              <span aria-hidden className="fl-stage-mark">
                {stage.status === "COMPLETED" ? (
                  <Check size={11} />
                ) : stage.status === "RUNNING" ? (
                  <Spinner size={11} />
                ) : (
                  stage.number
                )}
              </span>
              <span className="fl-stage-name" title={stage.description}>
                {stage.title}
              </span>
              <span className="fl-stage-status">{statusWord(stage)}</span>
              <span className="fl-stage-time">{stage.duration ?? "—"}</span>
            </motion.li>
          ))}
        </ol>

        {/* ------------------------------------------------- run counters */}
        <dl className="fl-counters">
          {COUNTER_DEFINITIONS.map((counter) => (
            <div key={counter.key}>
              <dt title={counter.definition}>{counter.label}</dt>
              <dd>
                <CountUp value={RUN_COUNTERS[counter.key]} />
              </dd>
            </div>
          ))}
        </dl>

        {/* ------------------------------------------------ run allowance */}
        <div className="fl-run-request" style={{ marginTop: 14, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong
              style={{
                display: "block",
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--fl-ink)",
              }}
            >
              Sourcing allowance used
            </strong>
            <AnimatedBar
              percent={percent}
              className="fl-meter"
              fillClassName=""
            />
            <small
              style={{
                display: "block",
                marginTop: 8,
                fontSize: 10.5,
                color: "var(--fl-ink-4)",
              }}
            >
              Target 100 verified prospects · provider availability healthy
            </small>
          </div>
        </div>

        <ul className="fl-controls">
          {["Pause", "Resume", "Stop", "Open prospects", "Open issues"].map(
            (control) => (
              <li key={control}>{control}</li>
            ),
          )}
        </ul>

        <Link
          href="#analytics"
          className="fl-btn fl-btn-ghost mt-3 w-full"
          onClick={() => trackEngagement("find_leads_sourcing_demo", "counters")}
        >
          See how sourcing is measured
          <ChevronRight size={13} />
        </Link>
      </div>
    </AppSurface>
  );
}
