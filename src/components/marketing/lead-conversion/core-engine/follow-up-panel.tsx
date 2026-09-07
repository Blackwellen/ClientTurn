"use client";

import * as React from "react";
import {
  Clock,
  Mail,
  MessageCircle,
  MessageSquare,
  MoreVertical,
  Pencil,
  Plus,
  Repeat2,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { SEQUENCE } from "../data";
import { Panel, Pill } from "../primitives";
import { useStageLoop } from "../use-stage";

const CHANNEL_ICON = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageCircle,
} as const;

type StepState = "idle" | "active" | "done" | "stopped";

/**
 * Stage 4 is the resting frame — step one sent, the rest scheduled — so a
 * visitor with reduced motion, or one who never scrolls the panel into view,
 * sees a configured sequence rather than a half-played animation.
 */
function stepState(index: number, stage: number): StepState {
  if (stage === 4) return index === 0 ? "done" : "idle";
  if (stage === 3) return index <= 1 ? "done" : "stopped";
  if (index < stage) return "done";
  if (index === stage) return "active";
  return "idle";
}

function stateLabel(state: StepState, index: number) {
  switch (state) {
    case "done":
      return { tone: "sent" as const, label: "Sent" };
    case "active":
      return { tone: "sent" as const, label: "Sending" };
    case "stopped":
      return { tone: "scheduled" as const, label: "Stopped" };
    default:
      return {
        tone: index === 0 ? ("sent" as const) : ("scheduled" as const),
        label: index === 0 ? "Sent" : "Scheduled",
      };
  }
}

const SETTINGS: {
  icon: LucideIcon;
  label: string;
  detail?: string;
  toggle: boolean;
}[] = [
  { icon: Clock, label: "Quiet hours", detail: "8:00 PM – 8:00 AM", toggle: true },
  { icon: Repeat2, label: "Stop on reply", toggle: true },
  { icon: ShieldCheck, label: "Stop on booking", toggle: true },
  { icon: Workflow, label: "Max steps", detail: "4 steps", toggle: false },
];

export function FollowUpPanel() {
  const ref = React.useRef<HTMLDivElement>(null);
  const stage = useStageLoop(ref, 5, 1400, 3000);

  return (
    <div ref={ref}>
      <Panel
        title="Follow-up Sequence"
        actions={
          <>
            <span className="lcp-toggle-chip">
              Active
              <i aria-hidden />
            </span>
            <span className="lcp-btn-quiet">
              <Pencil size={12} strokeWidth={2} aria-hidden />
              Edit
            </span>
            <span className="lcp-icon-quiet" aria-hidden>
              <MoreVertical size={14} />
            </span>
          </>
        }
      >
        <div className="lcp-seq">
          {SEQUENCE.map((step, i) => {
            const Icon = CHANNEL_ICON[step.channel];
            const state = stepState(i, stage);
            const badge = stateLabel(state, i);
            return (
              <div key={step.title} className="lcp-seq-step" data-state={state}>
                <span className="lcp-seq-no" aria-hidden>
                  {i + 1}
                </span>
                <div className="lcp-seq-card">
                  <span className="lcp-seq-icon" data-ch={step.channel} aria-hidden>
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className="lcp-seq-text">
                    <b>{step.title}</b>
                    <small>{step.preview}</small>
                  </span>
                  <span className="lcp-seq-when">
                    <b>{step.when}</b>
                    {step.time && <small>{step.time}</small>}
                  </span>
                  <Pill tone={badge.tone}>{badge.label}</Pill>
                </div>
              </div>
            );
          })}
        </div>

        {stage === 3 && (
          <p className="lcp-seq-stopped">
            Lead replied — remaining steps stopped
          </p>
        )}

        <div className="lcp-seq-add">
          <span className="lcp-add-btn">
            <Plus size={13} strokeWidth={2.5} aria-hidden />
            Add step
          </span>
        </div>

        <div className="lcp-seq-split">
          <div className="lcp-subcard">
            <h5>Settings</h5>
            <ul className="lcp-settings">
              {SETTINGS.map(({ icon: Icon, label, detail, toggle }) => (
                <li key={label}>
                  <Icon size={15} strokeWidth={2} aria-hidden />
                  <span className="lcp-settings-text">
                    <b>{label}</b>
                    {detail && <small>{detail}</small>}
                  </span>
                  {toggle && <span className="lcp-switch" aria-hidden />}
                </li>
              ))}
            </ul>
          </div>

          <div className="lcp-subcard">
            <h5>Message preview</h5>
            <div className="lcp-preview-tabs">
              {["Email", "SMS", "WhatsApp"].map((tab, i) => (
                <span
                  key={tab}
                  className="lcp-preview-tab"
                  data-active={i === 0 ? "true" : undefined}
                >
                  {tab}
                </span>
              ))}
            </div>
            <div className="lcp-preview-note">
              <b>Subject: Thanks for your enquiry</b>
              <p>Hi {"{{first_name}}"},</p>
              <p>
                Thanks for getting in touch. We’ve received your enquiry about{" "}
                {"{{service}}"} and will be in touch shortly.
              </p>
              <p>
                If you have any additional information in the meantime, just
                reply to this email.
              </p>
              <p>
                Best regards,
                <br />
                {"{{company_name}}"}
              </p>
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
