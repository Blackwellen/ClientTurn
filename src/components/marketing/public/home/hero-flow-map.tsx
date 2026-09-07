import * as React from "react";
import {
  Building2,
  CalendarDays,
  Check,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  SquareCheckBig,
  User,
} from "lucide-react";
import { Lockup } from "../ui";

/**
 * The hero orchestration map.
 *
 * Two lanes — inbound conversion above, outbound prospecting below — meeting
 * at a central ClientTurn node. It is HTML, CSS and one SVG: no WebGL, no
 * canvas, no raster scene, and no JavaScript at all, so it costs nothing at
 * hydration and cannot delay LCP.
 *
 * The whole composition is authored on a fixed 800x540 design canvas and
 * scaled as one unit. `--u` is one design pixel expressed in container-query
 * units, so every offset, radius, gap and font size below is the literal
 * measurement from the approved design and the proportions hold exactly at
 * any container width. The SVG shares that coordinate space, and its strokes
 * carry `vector-effect="non-scaling-stroke"` so line weight stays 1-2px
 * however the canvas is scaled.
 *
 * Desktop only — below the two-column breakpoint the hero renders
 * `HeroFlowStack` instead, which is a composition designed for a narrow
 * column rather than this one shrunk.
 */

const CANVAS_W = 800;
const CANVAS_H = 540;

/** A design-pixel measurement, in the canvas's scaled units. */
function u(value: number): string {
  return `calc(${value} * var(--u))`;
}

/* ----------------------------------------------------------- fragments --- */

function NodeCard({
  icon: Icon,
  title,
  subtitle,
  solid,
  x,
  y,
  width,
  children,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties; strokeWidth?: number }>;
  title: string;
  subtitle: string;
  solid?: boolean;
  x: number;
  y: number;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="pub-card absolute"
      style={{
        left: u(x),
        top: u(y),
        width: u(width),
        borderRadius: u(14),
        padding: u(12),
      }}
    >
      <div className="flex items-center" style={{ gap: u(9) }}>
        <span
          className="pub-tile"
          data-solid={solid ? "true" : undefined}
          style={{ width: u(30), height: u(30), borderRadius: u(8) }}
        >
          <Icon style={{ width: u(16), height: u(16) }} strokeWidth={2.1} />
        </span>
        <span className="min-w-0">
          <span
            className="block font-semibold text-[var(--pub-text)]"
            style={{ fontSize: u(13.5), lineHeight: 1.2 }}
          >
            {title}
          </span>
          <span
            className="block text-[var(--pub-text-muted)]"
            style={{ fontSize: u(10), lineHeight: 1.3, marginTop: u(1) }}
          >
            {subtitle}
          </span>
        </span>
      </div>
      <div className="pub-fragment" style={{ marginTop: u(11), padding: u(9), borderRadius: u(9) }}>
        {children}
      </div>
    </div>
  );
}

/** One "label — tick" row, as used by Qualify and Verify. */
function CheckRow({ label, last }: { label: string; last?: boolean }) {
  return (
    <div
      className="flex items-center justify-between"
      style={{
        paddingBlock: u(5),
        borderBottom: last ? undefined : "1px solid rgb(117 148 180 / 0.12)",
      }}
    >
      <span className="text-[var(--pub-text-secondary)]" style={{ fontSize: u(10.5) }}>
        {label}
      </span>
      <span
        className="pub-tile"
        data-solid="true"
        style={{ width: u(13), height: u(13), borderRadius: u(4) }}
      >
        <Check style={{ width: u(9), height: u(9) }} strokeWidth={3.2} />
      </span>
    </div>
  );
}

/** One sourced-company row, as used by Find. */
function CompanyRow({ name, verified }: { name: string; verified?: boolean }) {
  return (
    <div className="flex items-center" style={{ gap: u(7), paddingBlock: u(5) }}>
      <Building2
        aria-hidden
        className="text-[var(--pub-text-muted)]"
        style={{ width: u(12), height: u(12) }}
      />
      <span className="flex-1 truncate text-[var(--pub-text-secondary)]" style={{ fontSize: u(10.5) }}>
        {name}
      </span>
      {verified ? (
        <Check
          aria-hidden
          className="text-[var(--pub-lime)]"
          style={{ width: u(11), height: u(11) }}
          strokeWidth={3}
        />
      ) : null}
    </div>
  );
}

function LanePill({ label, x, y }: { label: string; x: number; y: number }) {
  return (
    <span
      className="pub-eyebrow pub-eyebrow-pill absolute"
      style={{
        left: u(x),
        top: u(y),
        fontSize: u(9.5),
        letterSpacing: u(1.6),
        paddingInline: u(14),
        paddingBlock: u(6),
      }}
    >
      {label}
    </span>
  );
}

/* --------------------------------------------------------- connectors --- */

/**
 * A connector. `pathLength={1}` normalises the dash geometry so one pulse
 * definition works on paths of any real length.
 */
function Connector({
  d,
  dotted,
  pulse,
  delay = 0,
  duration = 10,
}: {
  d: string;
  dotted?: boolean;
  pulse?: boolean;
  delay?: number;
  duration?: number;
}) {
  return (
    <>
      {pulse ? <path d={d} className="pub-path-glow" vectorEffect="non-scaling-stroke" /> : null}
      <path
        d={d}
        pathLength={1}
        data-draw
        className={dotted ? "pub-path-dotted" : "pub-path-base"}
        vectorEffect="non-scaling-stroke"
      />
      {pulse ? (
        <path
          d={d}
          pathLength={1}
          className="pub-path-pulse"
          vectorEffect="non-scaling-stroke"
          style={
            {
              "--pub-pulse-delay": `${delay}s`,
              "--pub-pulse-duration": `${duration}s`,
            } as React.CSSProperties
          }
        />
      ) : null}
    </>
  );
}

function Junction({ cx, cy }: { cx: number; cy: number }) {
  return (
    <>
      <circle data-draw-pop cx={cx} cy={cy} r={7} fill="rgb(183 243 74 / 0.18)" />
      <circle data-draw-pop cx={cx} cy={cy} r={3.4} fill="var(--pub-lime)" />
    </>
  );
}

/* ------------------------------------------------------------- canvas --- */

/* Column geometry, shared by both lanes. */
const CARD_W = 174;
const COL_X = [15, 217, 422, 624];
const INBOUND_Y = 42;
const OUTBOUND_Y = 366;

/* The platform node, as measured from the approved comp. */
const NODE_X = 271;
const NODE_Y = 231;
const NODE_W = 265;
const NODE_H = 86;
const NODE_L = NODE_X;                    // left edge
const NODE_R = NODE_X + NODE_W;           // right edge
const NODE_MID = NODE_Y + NODE_H / 2;     // vertical centre

export function HeroFlowMap({ className }: { className?: string }) {
  return (
    <div className={className} style={{ containerType: "inline-size" }}>
      {/* `--u` is declared on the child, never on the container itself:
          container-query units resolve against the nearest *ancestor*
          container, so a `cqw` written on the container element would size
          itself against something further up the tree. */}
      <div
        className="relative"
        style={
          {
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            // One design pixel = 100cqw / 800 canvas units.
            "--u": `${100 / CANVAS_W}cqw`,
          } as React.CSSProperties
        }
      >
        {/* Connectors sit behind the cards. */}
        <svg
          aria-hidden
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {/* Inbound lane: card to card. */}
          <Connector d="M 189 119 L 217 119" pulse duration={11} delay={0} />
          <Connector d="M 391 119 L 422 119" pulse duration={11} delay={0.35} />
          <Connector d="M 596 119 L 624 119" pulse duration={11} delay={0.7} />

          {/* Booking loops back into the platform node. */}
          <Connector
            d="M 790 128 C 812 146 810 240 770 256 L 536 268"
            pulse
            duration={11}
            delay={1.1}
          />

          {/* The new enquiry entering the platform. */}
          <Connector d="M 102 199 L 102 232 C 102 252 118 262 142 265 L 271 272" dotted />

          {/* Platform out to the outbound lane. The descent finishes at x=4
              before it reaches the lane label at y=324 — routed inside that,
              it cut straight through the pill's corner. */}
          <Connector
            d="M 271 284 C 212 300 142 304 76 304 C 32 304 4 310 4 328 L 4 424 C 4 442 6 452 18 452"
            pulse
            duration={11}
            delay={2.2}
          />

          {/* Outbound lane: card to card. */}
          <Connector d="M 189 452 L 217 452" pulse duration={11} delay={3} />
          <Connector d="M 391 452 L 422 452" pulse duration={11} delay={3.35} />
          <Connector d="M 596 452 L 624 452" pulse duration={11} delay={3.7} />

          {/* The sourced opportunity returning as a lead. */}
          <Connector d="M 536 281 L 754 283 C 772 283 776 292 776 306 L 776 366" dotted />

          <Junction cx={203} cy={119} />
          <Junction cx={406} cy={119} />
          <Junction cx={610} cy={119} />
          <Junction cx={203} cy={452} />
          <Junction cx={406} cy={452} />
          <Junction cx={610} cy={452} />
          <Junction cx={NODE_L} cy={NODE_MID} />
          <Junction cx={NODE_R} cy={NODE_MID} />
          <Junction cx={NODE_X + NODE_W / 2} cy={NODE_Y} />
        </svg>

        {/* ------------------------------------------------ inbound lane --- */}
        <LanePill label="Inbound leads" x={15} y={0} />

        <NodeCard
          icon={User}
          title="Lead"
          subtitle="New enquiry"
          x={COL_X[0]}
          y={INBOUND_Y}
          width={CARD_W}
        >
          <p className="font-medium text-[var(--pub-text)]" style={{ fontSize: u(11) }}>
            James Taylor
          </p>
          <div className="flex items-center justify-between" style={{ marginTop: u(4) }}>
            <span className="text-[var(--pub-text-muted)]" style={{ fontSize: u(10) }}>
              james@acme.co
            </span>
            <span className="pub-node-dot" style={{ width: u(6), height: u(6) }} />
          </div>
          <p className="text-[var(--pub-text-secondary)]" style={{ fontSize: u(10), marginTop: u(6) }}>
            Roof replacement
          </p>
        </NodeCard>

        <NodeCard
          icon={MessageSquareText}
          title="Reply"
          subtitle="Instant response"
          x={COL_X[1]}
          y={INBOUND_Y}
          width={CARD_W}
        >
          <p
            className="text-[var(--pub-text-secondary)]"
            style={{ fontSize: u(10.5), lineHeight: 1.5 }}
          >
            Hi James! Thanks for your enquiry&hellip; How can we help?
          </p>
        </NodeCard>

        <NodeCard
          icon={SquareCheckBig}
          title="Qualify"
          subtitle="Guided qualification"
          solid
          x={COL_X[2]}
          y={INBOUND_Y}
          width={CARD_W}
        >
          <CheckRow label="Budget" />
          <CheckRow label="Authority" />
          <CheckRow label="Need" />
          <CheckRow label="Timeline" last />
        </NodeCard>

        <NodeCard
          icon={CalendarDays}
          title="Book"
          subtitle="Appointment scheduled"
          x={COL_X[3]}
          y={INBOUND_Y}
          width={CARD_W}
        >
          <div className="flex items-center" style={{ gap: u(8) }}>
            <CalendarDays
              aria-hidden
              className="text-[var(--pub-lime)]"
              style={{ width: u(16), height: u(16) }}
            />
            <span className="flex-1">
              <span
                className="block font-medium text-[var(--pub-text)]"
                style={{ fontSize: u(10.5) }}
              >
                Mon, 18 Nov
              </span>
              <span className="block text-[var(--pub-text-muted)]" style={{ fontSize: u(10) }}>
                10:00 AM
              </span>
            </span>
            <span
              className="pub-tile"
              data-solid="true"
              style={{ width: u(16), height: u(16), borderRadius: u(8) }}
            >
              <Check style={{ width: u(10), height: u(10) }} strokeWidth={3.2} />
            </span>
          </div>
        </NodeCard>

        {/* -------------------------------------------------- centre node --- */}
        {/* The platform node. Measured from the approved comp: a 265x86 box
            centred on the canvas at x=271. The lockup asset carries about 40%
            vertical padding of its own, so the box height here is larger than
            the mark it renders — the negative offset on the caption takes that
            padding back out so the two sit optically centred. */}
        <div
          className="pub-card absolute flex flex-col items-center justify-center"
          style={{
            left: u(NODE_X),
            top: u(NODE_Y),
            width: u(NODE_W),
            height: u(NODE_H),
            borderRadius: u(16),
            borderColor: "var(--pub-lime-border)",
            boxShadow:
              "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 60px -14px rgb(183 243 74 / 0.55)",
          }}
        >
          <Lockup inkHeight={u(34)} priority />
          <p
            className="pub-eyebrow"
            style={{ fontSize: u(8), letterSpacing: u(1.7), marginTop: u(9) }}
          >
            Automate&nbsp;&middot;&nbsp;Qualify&nbsp;&middot;&nbsp;Convert
          </p>
        </div>

        {/* ----------------------------------------------- outbound lane --- */}
        <LanePill label="Outbound prospecting" x={15} y={324} />

        <NodeCard
          icon={Search}
          title="Find"
          subtitle="Discover prospects"
          x={COL_X[0]}
          y={OUTBOUND_Y}
          width={CARD_W}
        >
          <CompanyRow name="Smith Construction" />
          <CompanyRow name="Riverside Homes" />
          <CompanyRow name="Oakwood Developments" />
        </NodeCard>

        <NodeCard
          icon={ShieldCheck}
          title="Verify"
          subtitle="Validate contact data"
          x={COL_X[1]}
          y={OUTBOUND_Y}
          width={CARD_W}
        >
          <CheckRow label="Email" />
          <CheckRow label="Phone" />
          <CheckRow label="Company" />
          <CheckRow label="Decision maker" last />
        </NodeCard>

        <NodeCard
          icon={Send}
          title="Outreach"
          subtitle="Assisted messaging"
          x={COL_X[2]}
          y={OUTBOUND_Y}
          width={CARD_W}
        >
          <p
            className="text-[var(--pub-text-secondary)]"
            style={{ fontSize: u(10.5), lineHeight: 1.5 }}
          >
            Hi there, We help contractors win more high-value projects&hellip;
          </p>
        </NodeCard>

        <NodeCard
          icon={User}
          title="Lead"
          subtitle="New opportunity"
          x={COL_X[3]}
          y={OUTBOUND_Y}
          width={CARD_W}
        >
          <div className="flex items-center" style={{ gap: u(8) }}>
            <span className="pub-node-dot" style={{ width: u(8), height: u(8) }} />
            <span>
              <span
                className="block font-medium text-[var(--pub-text)]"
                style={{ fontSize: u(10.5) }}
              >
                Interested
              </span>
              <span className="block text-[var(--pub-text-muted)]" style={{ fontSize: u(10) }}>
                Added to pipeline
              </span>
            </span>
          </div>
        </NodeCard>
      </div>
    </div>
  );
}

/* ==================================================================== */

/**
 * The narrow-column composition. Not the desktop map shrunk: two short
 * vertical routes that still say what the product does at a glance.
 */
export function HeroFlowStack({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="grid gap-5 sm:grid-cols-2">
        <StackLane
          label="Inbound leads"
          steps={[
            { icon: User, title: "Lead", detail: "New enquiry" },
            { icon: MessageSquareText, title: "Reply", detail: "Instant response" },
            { icon: SquareCheckBig, title: "Qualify", detail: "Budget, need, timeline" },
            { icon: CalendarDays, title: "Book", detail: "Appointment scheduled", solid: true },
          ]}
        />
        <StackLane
          label="Outbound prospecting"
          steps={[
            { icon: Search, title: "Find", detail: "Discover prospects" },
            { icon: ShieldCheck, title: "Verify", detail: "Validate contact data" },
            { icon: Send, title: "Outreach", detail: "Assisted messaging" },
            { icon: User, title: "Lead", detail: "New opportunity", solid: true },
          ]}
        />
      </div>
    </div>
  );
}

function StackLane({
  label,
  steps,
}: {
  label: string;
  steps: {
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    title: string;
    detail: string;
    solid?: boolean;
  }[];
}) {
  return (
    <div className="pub-card p-5">
      <p className="pub-eyebrow" style={{ fontSize: "0.65rem" }}>
        {label}
      </p>
      <ol className="relative mt-4 space-y-3">
        {/* The lime run behind the steps. Decorative. */}
        <span
          aria-hidden
          className="absolute bottom-5 left-[19px] top-5 w-px bg-[linear-gradient(180deg,rgb(183_243_74/0.5),rgb(183_243_74/0.12))]"
        />
        {steps.map((step) => (
          <li key={step.title} className="relative flex items-center gap-3">
            <span
              className="pub-tile"
              data-solid={step.solid ? "true" : undefined}
              style={{ width: 38, height: 38, borderRadius: 10 }}
            >
              <step.icon className="size-4.5" strokeWidth={2.1} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-[var(--pub-text)]">
                {step.title}
              </span>
              <span className="block text-xs text-[var(--pub-text-muted)]">{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
