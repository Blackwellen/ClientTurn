import * as React from "react";

/**
 * The example decision flow beside the decision-layer cards.
 *
 * Two gates, both of which can only ever *stop* the system: does this match
 * the criteria you configured, and is this contact eligible to be messaged
 * right now. There is deliberately no "override" or "send anyway" branch —
 * that branch does not exist in the product, and drawing one on a marketing
 * page would be describing a system we do not ship.
 */

function Node({
  kind,
  children,
}: {
  kind?: "decision" | "stop" | "hold" | "go";
  children: React.ReactNode;
}) {
  return (
    <span className="pub-flow-node" data-kind={kind}>
      {children}
    </span>
  );
}

function Drop() {
  return <span className="pub-flow-drop" aria-hidden />;
}

export function DecisionFlow() {
  return (
    <figure
      className="pub-flow"
      role="img"
      aria-label="Example decision flow. An enquiry or prospect is checked against the qualification criteria you configured. If it does not match, it is marked not a fit and stops. If it matches, contactability is checked. If the contact has opted out, bounced, complained or is outside quiet hours, it is suppressed and stops. Only when both checks pass does follow-up proceed."
    >
      <Node>Enquiry or prospect</Node>
      <Drop />

      <div className="pub-flow-arm">
        <span aria-hidden />
        <Node kind="decision">Matches your criteria?</Node>
        <span aria-hidden>
          <Node kind="stop">No — not a fit</Node>
        </span>
      </div>
      <Drop />

      <div className="pub-flow-arm">
        <span aria-hidden />
        <Node kind="decision">Eligible to contact?</Node>
        <span aria-hidden>
          <Node kind="stop">No — suppressed</Node>
        </span>
      </div>
      <Drop />

      <Node kind="go">Proceed with follow-up</Node>

      <ul className="pub-flow-legend">
        <li>
          <span>Reply received</span>
          <span className="pub-state" data-tone="go">
            Sequence stops
          </span>
        </li>
        <li>
          <span>Booking confirmed</span>
          <span className="pub-state" data-tone="go">
            Sequence stops
          </span>
        </li>
        <li>
          <span>Opt-out, bounce or complaint</span>
          <span className="pub-state" data-tone="stop">
            Suppressed
          </span>
        </li>
        <li>
          <span>Sender health or budget limit</span>
          <span className="pub-state" data-tone="hold">
            Paused
          </span>
        </li>
      </ul>
    </figure>
  );
}
