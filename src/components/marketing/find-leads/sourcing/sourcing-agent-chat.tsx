"use client";

import * as React from "react";
import { COUNTER_DEFINITIONS } from "@/lib/find-leads/types";
import { trackEngagement } from "@/lib/marketing/track";
import { useStagedReveal } from "../../use-staged";
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
 * live inside the conversation, described in the product's own words — the
 * strings come from `STAGES`, not from this file.
 *
 * Progress advances a few stages and then stops. There is no loop: an endless
 * animation on a marketing page is noise, and it would also imply a run that
 * never finishes.
 */

/** How far the demo walks: stages 5 and 6 complete after the initial frame. */
const ADVANCE = 3;

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
  const { ref, revealed } = useStagedReveal(ADVANCE, 1400);

  /**
   * Applies the demo's advance to the canonical stage list: each tick
   * completes the running stage and starts the next one.
   */
  const stages = React.useMemo<DemoStage[]>(() => {
    const frontier = 4 + revealed;
    return DEMO_STAGES.map((stage) => {
      if (stage.number < frontier) {
        return {
          ...stage,
          status: "COMPLETED",
          duration: stage.duration ?? `${18 + stage.number * 3}s`,
        };
      }
      if (stage.number === frontier) {
        return { ...stage, status: "RUNNING" };
      }
      return { ...stage, status: "PENDING", count: null, duration: null };
    });
  }, [revealed]);

  const done = stages.filter((s) => s.status === "COMPLETED").length;
  const percent = Math.round((done / stages.length) * 100);
  const complete = done === stages.length;

  return (
    <AppSurface
      title="Sourcing in progress"
      subtitle={`Stage ${Math.min(done + 1, stages.length)} of ${stages.length}`}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={complete ? "green" : "lime"} dot>
            {complete ? "Complete" : "Running"}
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
            View full run details
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
          <div
            className="fl-progress-track"
            role="progressbar"
            aria-label="Sourcing run progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span className="fl-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <b>{percent}%</b>
        </div>

        <ul className="fl-tiles">
          {RUN_TILES.map((tile) => (
            <li className="fl-tile" key={tile.label}>
              <b>{tile.value}</b>
              <span>{tile.label}</span>
            </li>
          ))}
        </ul>

        {/* ---------------------------------------------- the twelve stages */}
        <ol className="fl-stages" aria-label="Sourcing stages">
          {stages.map((stage) => (
            <li key={stage.number} className="fl-stage" data-status={stage.status}>
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
            </li>
          ))}
        </ol>

        {/* ------------------------------------------------- run counters */}
        <dl className="fl-counters">
          {COUNTER_DEFINITIONS.map((counter) => (
            <div key={counter.key}>
              <dt title={counter.definition}>{counter.label}</dt>
              <dd>{RUN_COUNTERS[counter.key].toLocaleString("en-GB")}</dd>
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
            <div className="fl-meter" aria-hidden style={{ marginTop: 9 }}>
              <span style={{ width: "25%" }} />
            </div>
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

        <button
          type="button"
          className="fl-btn fl-btn-ghost mt-3 w-full"
          onClick={() => trackEngagement("find_leads_sourcing_demo", "counters")}
        >
          Illustrative figures — see how sourcing is measured
        </button>
      </div>
    </AppSurface>
  );
}
