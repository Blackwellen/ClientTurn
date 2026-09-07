import { ChevronRight, Mail, Pencil } from "lucide-react";
import { REACTIVATION, REACTIVATION_COUNTS } from "../data";
import { Avatar, Panel, Pill } from "../primitives";

/**
 * Reactivation with its suppression showing.
 *
 * Suppressed and unsubscribed rows are rendered muted and have no "Add to
 * campaign" action — not a greyed-out button someone could imagine clicking,
 * no action at all. Suppression is not a setting on this screen, and the panel
 * should not suggest it can be waved through.
 */
export function ReactivationPanel() {
  return (
    <Panel
      title="Reactivation campaign"
      actions={<span className="lcp-btn-blue">Create campaign</span>}
    >
      <div className="lcp-counters">
        {REACTIVATION_COUNTS.map((counter) => (
          <div key={counter.label} className="lcp-counter">
            <b>{counter.value}</b>
            <small>{counter.label}</small>
            {counter.chevron && <ChevronRight size={13} aria-hidden />}
          </div>
        ))}
      </div>

      <div className="lcp-react-table">
        <div className="lcp-react-thead">
          <span>Name</span>
          <span>Last enquiry</span>
          <span>Status</span>
          <span className="lcp-hide-sm">Next step</span>
        </div>
        {REACTIVATION.map((row) => (
          <div
            key={row.name}
            className="lcp-react-row"
            data-out={row.actionable ? undefined : "true"}
          >
            <span className="lcp-react-who">
              <Avatar initials={row.initials} colours={row.avatar} />
              <b>{row.name}</b>
            </span>
            <span className="lcp-react-when">{row.last}</span>
            <span>
              <Pill tone={row.tone}>{row.status}</Pill>
            </span>
            <span className="lcp-hide-sm">
              {row.actionable ? (
                <span className="lcp-mini-btn">Add to campaign</span>
              ) : (
                <span className="lcp-dash" aria-label="No action available">
                  —
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="lcp-react-msg">
        <div className="lcp-msg-card">
          <div className="lcp-msg-head">
            <Mail size={15} strokeWidth={2} aria-hidden />
            <b>Reactivation message</b>
            <span className="lcp-btn-quiet">
              <Pencil size={12} strokeWidth={2} aria-hidden />
              Edit
            </span>
          </div>
          <div className="lcp-msg-body">
            <b>Subject: Still planning your project?</b>
            <p>
              Hi {"{first_name}"},
              <br />
              Just checking if you’re still considering a {"{project_type}"}. If
              you have any questions or would like an updated quote, we’re here
              to help.
            </p>
          </div>
        </div>

        <div className="lcp-msg-stats">
          <div className="lcp-msg-stat">
            <small>Recipients</small>
            <b>314</b>
          </div>
          <div className="lcp-msg-stat">
            <small>Open rate</small>
            <b data-empty="true">—</b>
          </div>
          <div className="lcp-msg-stat">
            <small>Reply rate</small>
            <b data-empty="true">—</b>
          </div>
        </div>
      </div>
    </Panel>
  );
}
