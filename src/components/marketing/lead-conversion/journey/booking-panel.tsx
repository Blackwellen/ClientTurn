"use client";

import * as React from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Inbox,
  Users,
} from "lucide-react";
import { Panel, Pill } from "../primitives";
import { Avatar } from "../primitives";
import { useStageLoop } from "../use-stage";

const DESTINATIONS = [
  {
    icon: CalendarDays,
    title: "Book appointment",
    detail: "Send Calendly link and confirm automatically",
  },
  {
    icon: Users,
    title: "Handover to team",
    detail: "Assign to sales team with full context",
  },
  {
    icon: Inbox,
    title: "Add to nurture",
    detail: "Keep in follow-up sequence",
  },
] as const;

const DAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
/** September 2026 starts on a Tuesday, so the grid leads with one blank. */
const CAL_LEAD = 1;
const SLOTS = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00"];

export function BookingPanel() {
  const ref = React.useRef<HTMLDivElement>(null);
  // Two destinations are shown in turn; the booking route rests selected.
  const stage = useStageLoop(ref, 2, 2600, 4200);
  const selected = stage === 1 ? 0 : 1;

  return (
    <div ref={ref}>
      <Panel
        title="Book appointment"
        actions={
          <span className="lcp-btn-quiet">
            Send booking link
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </span>
        }
      >
        <div className="lcp-book-split">
          <div>
            <div className="lcp-book-lead">
              <div className="lcp-book-lead-top">
                <Avatar initials="JC" colours={["#dbe6f5", "#2d4a75"]} />
                <b>James Carter</b>
                <Pill tone="qualified">Qualified</Pill>
              </div>
              <p>New kitchen enquiry</p>
              <small>james@carterbuild.co.uk · 07812 345 678</small>
            </div>

            <div className="lcp-dest">
              {DESTINATIONS.map((dest, i) => {
                const Icon = dest.icon;
                return (
                  <div
                    key={dest.title}
                    className="lcp-dest-opt"
                    data-selected={selected === i ? "true" : undefined}
                  >
                    <span className="lcp-radio" aria-hidden />
                    <Icon size={15} strokeWidth={2} aria-hidden />
                    <span className="lcp-dest-text">
                      <b>{dest.title}</b>
                      <small>{dest.detail}</small>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lcp-cal">
            <div className="lcp-cal-row">
              Select a time
              <ChevronRight size={13} aria-hidden />
            </div>
            <div className="lcp-cal-row">
              September 2026
              <ChevronRight size={13} aria-hidden />
            </div>
            <div className="lcp-cal-grid" aria-hidden>
              {DAY_LABELS.map((day) => (
                <span key={day}>{day}</span>
              ))}
              {Array.from({ length: CAL_LEAD }, (_, i) => (
                <b key={`lead-${i}`} data-dim="true" />
              ))}
              {Array.from({ length: 30 }, (_, i) => (
                <b key={i} data-sel={i + 1 === 10 ? "true" : undefined}>
                  {i + 1}
                </b>
              ))}
            </div>
            <div className="lcp-slots" aria-hidden>
              {SLOTS.map((slot) => (
                <span
                  key={slot}
                  className="lcp-slot"
                  data-sel={slot === "14:00" ? "true" : undefined}
                >
                  {slot}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="lcp-confirm">
          <span className="lcp-confirm-icon" aria-hidden>
            <Check size={17} strokeWidth={3} />
          </span>
          <span className="lcp-confirm-text">
            <b>Appointment confirmed</b>
            <small>
              The lead has been added to your calendar and a confirmation email
              has been sent.
            </small>
          </span>
          <span className="lcp-btn-quiet">
            View in calendar
            <ArrowRight size={12} strokeWidth={2} aria-hidden />
          </span>
        </div>
      </Panel>
    </div>
  );
}
