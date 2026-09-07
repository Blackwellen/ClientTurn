import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { Tone } from "./data";

/** The one status-badge mapping for this page. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="lcp-pill" data-tone={tone}>
      {children}
    </span>
  );
}

export function Avatar({
  initials,
  colours,
  className,
}: {
  initials: string;
  colours: [string, string];
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("lcp-avatar", className)}
      style={{ background: colours[0], color: colours[1] }}
    >
      {initials}
    </span>
  );
}

/** The dark product panel used for every component demo below the hero. */
export function Panel({
  title,
  actions,
  children,
  className,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("lcp-panel", className)}>
      <div className="lcp-panel-head">
        <h4>{title}</h4>
        {actions && <div className="lcp-panel-head-actions">{actions}</div>}
      </div>
      <div className="lcp-panel-body">{children}</div>
    </div>
  );
}

export function BenefitStrip({
  items,
}: {
  items: readonly { icon: ReactNode; label: ReactNode }[];
}) {
  return (
    <ul className="lcp-benefits">
      {items.map((item, i) => (
        <li key={i} className="lcp-benefit">
          <span className="lcp-benefit-icon" aria-hidden>
            {item.icon}
          </span>
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
