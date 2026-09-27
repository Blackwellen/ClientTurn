import * as React from "react";
import {
  BarChart3,
  Check,
  CreditCard,
  Eye,
  FileSignature,
  FileText,
  Mail,
  MessageCircle,
  MessageSquareText,
  PhoneCall,
} from "lucide-react";
import { IllustrativeTag } from "../shell";
import { InView } from "./in-view";
import {
  CALL_ELAPSED_SEC,
  CHANNEL_TIMELINE,
  EXAMPLE,
  ILLUSTRATIVE_LABEL,
  QUOTE_DEPOSIT_PENCE,
  QUOTE_DEPOSIT_RATE,
  QUOTE_GROSS_PENCE,
  QUOTE_LINES,
  QUOTE_NET_PENCE,
  QUOTE_VAT_PENCE,
  QUOTE_VAT_RATE,
  ROI_PACK,
  ROI_VOICE_COST_PENCE,
  money,
  type Channel,
} from "./data";
import { gbp, minutes } from "@/lib/marketing/voice-offer";

/**
 * Server-rendered product mocks for the revenue sections: the cross-channel
 * timeline, the quote to signed to paid sequence and the ROI example card.
 *
 * Plain HTML and CSS. The only client code is `InView`, which starts the CSS
 * entrance when the block scrolls into view. Every mock is labelled
 * "Illustrative example".
 */

const CHANNEL_ICON: Record<Channel, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  call: PhoneCall,
  email: Mail,
  sms: MessageSquareText,
  whatsapp: MessageCircle,
  signature: FileSignature,
  payment: CreditCard,
  crm: BarChart3,
};

/* ---------------------------------------------------- channel timeline --- */

export function ChannelTimeline() {
  return (
    <div className="rv-frame rv-timeline-frame">
      <div className="rv-frame-bar">
        <span className="rv-frame-title">
          {EXAMPLE.lead} · {EXAMPLE.company}
        </span>
        <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
      </div>
      <InView as="ol" className="rv-timeline" aria-label={`${ILLUSTRATIVE_LABEL}: one conversation across call, email, SMS and WhatsApp`}>
        {CHANNEL_TIMELINE.map((event, index) => {
          const Icon = CHANNEL_ICON[event.channel];
          return (
            <li
              key={`${event.channel}-${event.time}`}
              className="rv-stagger rv-timeline-item"
              data-channel={event.channel}
              style={{ "--i": index } as React.CSSProperties}
            >
              <span className="rv-timeline-icon" aria-hidden>
                <Icon className="size-3.5" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <p className="rv-timeline-meta">
                  <span>{event.channelLabel}</span>
                  <time>{event.time}</time>
                </p>
                <p className="rv-timeline-title">{event.title}</p>
                <p className="rv-timeline-detail">{event.detail}</p>
              </div>
            </li>
          );
        })}
      </InView>
    </div>
  );
}

/* ---------------------------------------------- quote, signed, paid --- */

function QuoteDocument() {
  return (
    <div className="rv-quote-doc">
      <div className="rv-quote-brand">
        <span className="rv-quote-logo" aria-hidden>
          N
        </span>
        <span className="min-w-0">
          <b>{EXAMPLE.business}</b>
          <small>
            Quote {EXAMPLE.quoteNumber} for {EXAMPLE.company}
          </small>
        </span>
      </div>
      <table className="rv-quote-table">
        <caption className="sr-only">Quote lines</caption>
        <tbody>
          {QUOTE_LINES.map((line) => (
            <tr key={line.label}>
              <th scope="row">{line.label}</th>
              <td>{money(line.pence)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Subtotal</th>
            <td>{money(QUOTE_NET_PENCE)}</td>
          </tr>
          <tr>
            <th scope="row">VAT {Math.round(QUOTE_VAT_RATE * 100)}%</th>
            <td>{money(QUOTE_VAT_PENCE)}</td>
          </tr>
          <tr className="rv-quote-total">
            <th scope="row">Total</th>
            <td>{money(QUOTE_GROSS_PENCE)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="rv-quote-powered">Powered by ClientTurn</p>
    </div>
  );
}

export function QuoteSequence() {
  return (
    <InView
      as="ol"
      className="rv-quote-seq"
      aria-label={`${ILLUSTRATIVE_LABEL}: quote ${EXAMPLE.quoteNumber} is sent and viewed, then signed with a simple electronic signature, then the deposit is paid`}
    >
      <li className="rv-stagger rv-frame rv-quote-card" style={{ "--i": 0 } as React.CSSProperties}>
        <div className="rv-frame-bar">
          <span className="rv-quote-state">
            <Eye aria-hidden className="size-3.5" /> Sent · viewed
          </span>
          <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
        </div>
        <QuoteDocument />
      </li>

      <li className="rv-stagger rv-frame rv-quote-card" style={{ "--i": 1 } as React.CSSProperties}>
        <div className="rv-frame-bar">
          <span className="rv-quote-state" data-tone="lime">
            <FileSignature aria-hidden className="size-3.5" /> Signed
          </span>
        </div>
        <div className="rv-sign">
          <p className="rv-sign-k">Accepted by</p>
          <p className="rv-sign-name" aria-hidden>
            {EXAMPLE.lead}
          </p>
          <p className="rv-sign-line">
            {EXAMPLE.lead}, co-founder, {EXAMPLE.company}
          </p>
          <ul className="rv-sign-audit">
            <li>
              <Check aria-hidden className="size-3" /> Simple electronic signature
            </li>
            <li>
              <Check aria-hidden className="size-3" /> Audit trail: time, email, IP address
            </li>
            <li>
              <Check aria-hidden className="size-3" /> Fingerprint of this exact quote version
            </li>
          </ul>
        </div>
      </li>

      <li className="rv-stagger rv-frame rv-quote-card" style={{ "--i": 2 } as React.CSSProperties}>
        <div className="rv-frame-bar">
          <span className="rv-quote-state" data-tone="lime">
            <CreditCard aria-hidden className="size-3.5" /> Paid
          </span>
        </div>
        <div className="rv-paid">
          <p className="rv-sign-k">
            Deposit, {Math.round(QUOTE_DEPOSIT_RATE * 100)}% of the total
          </p>
          <p className="rv-paid-amount">{money(QUOTE_DEPOSIT_PENCE)}</p>
          <p className="rv-paid-note">Paid through your Stripe account</p>
          <div className="rv-paid-rows">
            <span>
              <FileText aria-hidden className="size-3.5" /> Balance invoice scheduled
            </span>
            <span>
              <BarChart3 aria-hidden className="size-3.5" /> CRM deal moved to won
            </span>
          </div>
        </div>
      </li>
    </InView>
  );
}

/* ------------------------------------------------------------ ROI card --- */

export function RoiCard() {
  const callMinutes = CALL_ELAPSED_SEC / 60;
  return (
    <div className="rv-frame rv-roi">
      <div className="rv-frame-bar">
        <span className="rv-frame-title">What it cost, what it earned</span>
        <IllustrativeTag>{ILLUSTRATIVE_LABEL}</IllustrativeTag>
      </div>
      <div className="rv-roi-grid">
        <div>
          <p className="rv-roi-k">What it cost</p>
          <p className="rv-roi-v">{money(ROI_VOICE_COST_PENCE)}</p>
          <p className="rv-roi-note">
            {callMinutes.toFixed(1)} voice minutes at the {minutes(ROI_PACK.minutes)} pack rate (
            {gbp(ROI_PACK.priceGbp)} for {minutes(ROI_PACK.minutes)}).
          </p>
        </div>
        <div>
          <p className="rv-roi-k">What it earned</p>
          <p className="rv-roi-v rv-roi-lime">{money(QUOTE_NET_PENCE, true)}</p>
          <p className="rv-roi-note">
            Signed quote, ex VAT. {money(QUOTE_DEPOSIT_PENCE)} deposit already paid.
          </p>
        </div>
      </div>
      <p className="rv-roi-foot">
        {ILLUSTRATIVE_LABEL}, not a customer result or a forecast. What a call costs depends on
        your plan, your pack and how long the call runs; what it earns depends on your offer.
      </p>
    </div>
  );
}
