import * as React from "react";
import Image from "next/image";
import { Lockup } from "../ui";
import {
  CalendarDays,
  Globe,
  Grid2x2,
  Mail,
  Megaphone,
  RefreshCw,
  UserPlus,
} from "lucide-react";

/**
 * The integration flow: sources on the left, ClientTurn in the middle,
 * destinations on the right.
 *
 * It describes the *shape* of the flow, not the state of any one connection —
 * so no node here carries a "connected" dot. Per-provider availability is
 * stated underneath, in the supported-providers strip, where it is computed
 * from the deployment rather than drawn.
 *
 * Authored on a 940x300 design canvas and scaled as one unit, like the hero.
 */

const CANVAS_W = 940;
const CANVAS_H = 300;

function u(value: number): string {
  return `calc(${value} * var(--u))`;
}

type FlowNode = {
  title: string;
  detail: string;
  icon?: React.ComponentType<{ style?: React.CSSProperties; strokeWidth?: number }>;
  logo?: string;
  x: number;
  y: number;
  width: number;
};

const SOURCES: FlowNode[] = [
  { title: "Meta Lead Ads", detail: "New leads", logo: "/brands/meta.svg", x: 0, y: 0, width: 169 },
  { title: "Google Ads", detail: "Lead forms", logo: "/brands/google.svg", x: 18, y: 77, width: 169 },
  { title: "Website", detail: "Form submissions", icon: Globe, x: 32, y: 150, width: 169 },
  { title: "Manual entry", detail: "Add any lead", icon: UserPlus, x: 44, y: 223, width: 169 },
];

const DESTINATIONS: FlowNode[] = [
  { title: "Calendar", detail: "Book appointments", icon: CalendarDays, x: 626, y: 1, width: 218 },
  { title: "CRM", detail: "Send contacts on", icon: RefreshCw, x: 626, y: 74, width: 218 },
  { title: "Email / SMS / WhatsApp", detail: "Follow up automatically", icon: Mail, x: 626, y: 147, width: 218 },
  { title: "Your tools", detail: "And more…", icon: Grid2x2, x: 626, y: 220, width: 218 },
];

function Node({ node }: { node: FlowNode }) {
  return (
    <div
      className="pub-card absolute flex items-center"
      style={{
        left: u(node.x),
        top: u(node.y),
        width: u(node.width),
        borderRadius: u(11),
        padding: u(10),
        gap: u(9),
      }}
    >
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-[6px] bg-[rgb(255_255_255/0.05)]"
        style={{ width: u(28), height: u(28) }}
      >
        {node.logo ? (
          <Image
            src={node.logo}
            alt=""
            width={18}
            height={18}
            style={{ width: u(17), height: u(17), objectFit: "contain" }}
          />
        ) : node.icon ? (
          <node.icon
            style={{ width: u(15), height: u(15), color: "var(--pub-lime)" }}
            strokeWidth={2.1}
          />
        ) : null}
      </span>
      <span className="min-w-0">
        <span
          className="block truncate font-semibold text-[var(--pub-text)]"
          style={{ fontSize: u(12), lineHeight: 1.25 }}
        >
          {node.title}
        </span>
        <span
          className="block truncate text-[var(--pub-text-muted)]"
          style={{ fontSize: u(10), lineHeight: 1.3 }}
        >
          {node.detail}
        </span>
      </span>
    </div>
  );
}

function Dotted({ d, delay }: { d: string; delay: number }) {
  return (
    <>
      <path
        d={d}
        pathLength={1}
        data-draw
        className="pub-path-dotted"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        pathLength={1}
        className="pub-path-pulse"
        vectorEffect="non-scaling-stroke"
        style={
          {
            "--pub-pulse-delay": `${delay}s`,
            "--pub-pulse-duration": "9s",
          } as React.CSSProperties
        }
      />
    </>
  );
}

/* The platform node, measured from the approved comp. Keeping it here rather
   than inline is what lets the two fans below be derived from its edges. */
const NODE = { x: 321, y: 65, w: 192, h: 174 };
const NODE_R = NODE.x + NODE.w;
const NODE_MID = NODE.y + NODE.h / 2;

/* Both fans are single cubics with a horizontal tangent at each end, and the
   four entry points are ordered the same way as the four cards they serve.
   Two monotonic sequences cannot produce a crossing, which is what keeps the
   diagram readable — an earlier version curved back on itself and the top two
   destination wires crossed. */
const FAN_Y = [NODE_MID - 24, NODE_MID - 8, NODE_MID + 8, NODE_MID + 24];

const SOURCE_PATHS = [
  `M 169 28 C 240 28 270 ${FAN_Y[0]} ${NODE.x} ${FAN_Y[0]}`,
  `M 187 105 C 250 105 280 ${FAN_Y[1]} ${NODE.x} ${FAN_Y[1]}`,
  `M 201 178 C 260 178 290 ${FAN_Y[2]} ${NODE.x} ${FAN_Y[2]}`,
  `M 215 251 C 270 251 300 ${FAN_Y[3]} ${NODE.x} ${FAN_Y[3]}`,
];

const DEST_PATHS = [
  `M ${NODE_R} ${FAN_Y[0]} C 556 ${FAN_Y[0]} 578 28 626 28`,
  `M ${NODE_R} ${FAN_Y[1]} C 556 ${FAN_Y[1]} 578 101 626 101`,
  `M ${NODE_R} ${FAN_Y[2]} C 556 ${FAN_Y[2]} 578 174 626 174`,
  `M ${NODE_R} ${FAN_Y[3]} C 556 ${FAN_Y[3]} 578 247 626 247`,
];

export function IntegrationFlow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{ containerType: "inline-size" }}
    >
      <div
        className="relative"
        style={
          {
            aspectRatio: `${CANVAS_W} / ${CANVAS_H}`,
            "--u": `${100 / CANVAS_W}cqw`,
          } as React.CSSProperties
        }
      >
        <svg
          viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {SOURCE_PATHS.map((d, index) => (
            <Dotted key={`s${index}`} d={d} delay={index * 0.4} />
          ))}
          {DEST_PATHS.map((d, index) => (
            <Dotted key={`d${index}`} d={d} delay={2.4 + index * 0.4} />
          ))}
          <circle data-draw-pop cx={NODE.x} cy={NODE_MID} r={7} fill="rgb(183 243 74 / 0.2)" />
          <circle data-draw-pop cx={NODE.x} cy={NODE_MID} r={3.4} fill="var(--pub-lime)" />
          <circle data-draw-pop cx={NODE_R} cy={NODE_MID} r={7} fill="rgb(183 243 74 / 0.2)" />
          <circle data-draw-pop cx={NODE_R} cy={NODE_MID} r={3.4} fill="var(--pub-lime)" />
        </svg>

        {SOURCES.map((node) => (
          <Node key={node.title} node={node} />
        ))}

        <div
          className="pub-card absolute flex flex-col items-center justify-center text-center"
          style={{
            left: u(NODE.x),
            top: u(NODE.y),
            width: u(NODE.w),
            height: u(NODE.h),
            borderRadius: u(18),
            borderColor: "var(--pub-lime-border)",
            boxShadow:
              "inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 70px -14px rgb(183 243 74 / 0.6)",
            padding: u(14),
          }}
        >
          <Lockup inkHeight={u(30)} />
          <p
            className="pub-eyebrow"
            style={{ fontSize: u(8.5), letterSpacing: u(1.4), marginTop: u(10), lineHeight: 1.7 }}
          >
            Capture &middot; Engage &middot; Qualify
            <br />
            Route &middot; Convert
          </p>
        </div>

        {DESTINATIONS.map((node) => (
          <Node key={node.title} node={node} />
        ))}
      </div>
    </div>
  );
}

/** The narrow-column stand-in: the same three stages, stacked. */
export function IntegrationFlowStack({ className }: { className?: string }) {
  const groups = [
    { heading: "Sources", icon: Megaphone, items: SOURCES },
    { heading: "Destinations", icon: Grid2x2, items: DESTINATIONS },
  ];
  return (
    <div aria-hidden className={className}>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group.heading} className="pub-card p-4">
            <p className="pub-eyebrow" style={{ fontSize: "0.65rem" }}>
              {group.heading}
            </p>
            <ul className="mt-3 space-y-2">
              {group.items.map((item) => (
                <li key={item.title} className="pub-fragment flex items-center gap-2.5 p-2.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[rgb(255_255_255/0.05)]">
                    {item.logo ? (
                      <Image src={item.logo} alt="" width={16} height={16} className="size-4 object-contain" />
                    ) : item.icon ? (
                      <item.icon
                        style={{ width: 15, height: 15, color: "var(--pub-lime)" }}
                        strokeWidth={2.1}
                      />
                    ) : null}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-[var(--pub-text)]">
                      {item.title}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--pub-text-muted)]">
                      {item.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
