"use client";

import * as React from "react";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  MoreVertical,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { QUESTIONS, ROUTING, SAMPLE_RESPONSE } from "../data";
import { Panel } from "../primitives";
import { useStageLoop } from "../use-stage";

const ROUTE_ICON = {
  qualified: CheckCircle2,
  review: AlertCircle,
  no: X,
} as const;

/**
 * The qualification builder. The outcome shown is produced by the configured
 * rules — that is what the trust statement under this band is about, and why
 * the panel shows the questions and the routing table next to the result
 * rather than just the verdict.
 */
export function QualificationPanel() {
  const ref = React.useRef<HTMLDivElement>(null);
  // Two states: the enquiry lands in review, then the rules resolve it.
  const stage = useStageLoop(ref, 2, 1300, 4200);
  const qualified = stage === 1;

  return (
    <div ref={ref}>
      <Panel
        title="Qualification"
        actions={<span className="lcp-btn-blue">Save changes</span>}
      >
        <div className="lcp-qual-tabs">
          {["Questions", "Rules", "Preview", "Outcomes"].map((tab, i) => (
            <span
              key={tab}
              className="lcp-tab"
              data-active={i === 0 ? "true" : undefined}
            >
              {tab}
            </span>
          ))}
        </div>

        <div className="lcp-qual-split">
          <div>
            <div className="lcp-qs">
              {QUESTIONS.map((question, i) => (
                <div key={question.label} className="lcp-q">
                  <span className="lcp-q-no" aria-hidden>
                    {i + 1}
                  </span>
                  <span className="lcp-q-text">
                    <b>{question.label}</b>
                    <small>{question.type}</small>
                  </span>
                  <MoreVertical size={13} className="lcp-app-kebab" aria-hidden />
                </div>
              ))}
            </div>
            <div className="lcp-seq-add">
              <span className="lcp-add-btn">
                <Plus size={13} strokeWidth={2.5} aria-hidden />
                Add question
              </span>
            </div>
          </div>

          <div className="lcp-sample">
            <h5>Sample lead response</h5>
            <dl>
              {SAMPLE_RESPONSE.map((row) => (
                <div key={row.label} className="lcp-sample-row">
                  <dt>{row.label}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="lcp-sample-extra">
              <small>Additional information</small>
              <p>Looking for a 4 bedroom property…</p>
            </div>
            <div
              className="lcp-result"
              data-state={qualified ? "qualified" : "review"}
            >
              {qualified ? (
                <CheckCircle2 size={19} aria-hidden />
              ) : (
                <AlertCircle size={19} aria-hidden />
              )}
              <span>
                <small>Qualification result</small>
                <b>{qualified ? "Qualified" : "Review"}</b>
              </span>
            </div>
          </div>
        </div>

      </Panel>

      <Panel
        title="Routing"
        className="lcp-routing"
        actions={
          <span className="lcp-btn-quiet">
            <Pencil size={12} strokeWidth={2} aria-hidden />
            Edit
          </span>
        }
      >
        <div className="lcp-routing-rows">
          {ROUTING.map((route) => {
            const Icon = ROUTE_ICON[route.tone];
            return (
              <div key={route.from} className="lcp-route">
                <span className="lcp-route-from">
                  <i data-tone={route.tone} aria-hidden>
                    <Icon size={11} strokeWidth={3} color="#05230f" />
                  </i>
                  {route.from}
                </span>
                <ArrowRight size={14} aria-hidden />
                <span className="lcp-route-to">{route.to}</span>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
