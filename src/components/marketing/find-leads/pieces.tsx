import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Presentational pieces shared by every section of /product/find-leads.
 *
 * All server components. The page is mostly static markup by design — a
 * marketing page whose content only exists after hydration is a page that is
 * invisible to a crawler and to a visitor on a slow connection, so the
 * interactive parts are deliberately small and local.
 */

export function FlSection({
  id,
  className,
  glow,
  grid = true,
  children,
}: {
  id?: string;
  className?: string;
  /** Where the radial lime illumination sits, if anywhere. */
  glow?: "left" | "right" | "centre";
  grid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("fl-section", className)}>
      {grid && <div aria-hidden className="fl-grid-bg" />}
      {glow && (
        <div
          aria-hidden
          className="fl-glow"
          style={
            glow === "left"
              ? { left: "-16%", top: "50%", translate: "0 -50%" }
              : glow === "right"
                ? { right: "-16%", top: "50%", translate: "0 -50%" }
                : { left: "50%", top: "50%", translate: "-50% -50%" }
          }
        />
      )}
      <div className="fl-wrap">{children}</div>
    </section>
  );
}

/**
 * A chapter's opening block: eyebrow, split headline and a right-hand aside
 * carrying one supporting sentence and one link out.
 */
export function ChapterHead({
  eyebrow,
  title,
  accent,
  aside,
  action,
}: {
  eyebrow: string;
  title: string;
  /** The clause rendered in lime after the title. */
  accent: string;
  aside: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="fl-chapter-head">
      <div>
        <p className="fl-eyebrow">{eyebrow}</p>
        <h2 className="fl-h2">
          {title} <em>{accent}</em>
        </h2>
      </div>
      <div className="fl-chapter-aside">
        <p>{aside}</p>
        {action}
      </div>
    </div>
  );
}

export function ChapterCard({
  index,
  eyebrow,
  title,
  body,
  children,
}: {
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <article className="fl-card">
      <div className="fl-card-head">
        <span aria-hidden className="fl-card-num">
          {index}
        </span>
        <div>
          <p className="fl-eyebrow">{eyebrow}</p>
          <h3 className="fl-h3">{title}</h3>
          <p className="fl-body">{body}</p>
        </div>
      </div>
      {children}
    </article>
  );
}

/** The frame that makes an embedded block read as a real application surface. */
export function AppSurface({
  title,
  subtitle,
  actions,
  footer,
  className,
  children,
}: {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("fl-app", className)}>
      {title && (
        <div className="fl-app-head">
          <div>
            <h4>{title}</h4>
            {subtitle && <small>{subtitle}</small>}
          </div>
          {actions}
        </div>
      )}
      <div className="fl-app-body">{children}</div>
      {footer}
    </div>
  );
}

export type BadgeTone = "neutral" | "lime" | "green" | "amber" | "red" | "blue";

/**
 * Status is never colour alone: every badge carries its own word, so the
 * meaning survives a monochrome display and a screen reader alike.
 */
export function Badge({
  tone = "neutral",
  dot,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="fl-badge" data-tone={tone}>
      {dot && <span aria-hidden className="fl-badge-dot" />}
      {children}
    </span>
  );
}

/** The four/five-item value strip that closes each chapter. */
export function Ribbon({
  items,
  arrows,
}: {
  items: { icon: React.ReactNode; title: string; body: string }[];
  /** Renders the strip as a left-to-right flow rather than parallel points. */
  arrows?: boolean;
}) {
  return (
    <ul className="fl-ribbon">
      {items.map((item, index) => (
        <li key={item.title}>
          <span aria-hidden className="fl-ribbon-icon">
            {item.icon}
          </span>
          <div>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </div>
          {arrows && index < items.length - 1 && (
            <ChevronRight
              aria-hidden
              className="ml-auto shrink-0 text-[#2c384d]"
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/** The ClientTurn square mark, used wherever the app shows its own avatar. */
export function BrandMark({ size = 17 }: { size?: number }) {
  return (
    <Image
      src="/Favicon.png"
      alt=""
      width={size}
      height={size}
      aria-hidden
      unoptimized
    />
  );
}

/* --------------------------------------------------------------- icons */

/**
 * Inline icons rather than a library import, so the page ships exactly the
 * glyphs it draws. Every one is `aria-hidden` at the call site — the label is
 * always in the adjacent text.
 */

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 15, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);
export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Icon>
);
export const Shield = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z" />
    <path d="M9.2 12.2l2 2 3.6-3.9" />
  </Icon>
);
export const Search = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-3.6-3.6" />
  </Icon>
);
export const Play = (p: IconProps) => (
  <svg
    width={p.size ?? 9}
    height={p.size ?? 9}
    viewBox="0 0 10 12"
    fill="currentColor"
    aria-hidden
    focusable="false"
  >
    <path d="M1 1l8 5-8 5z" />
  </svg>
);
export const Users = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
    <circle cx="10" cy="8" r="3.2" />
    <path d="M18.5 19v-1.2a3.4 3.4 0 0 0-2.4-3.2M15.4 5.3a3.2 3.2 0 0 1 0 5.4" />
  </Icon>
);
export const Sparkle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z" />
    <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
  </Icon>
);
export const Pin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 21s6-5.4 6-10a6 6 0 1 0-12 0c0 4.6 6 10 6 10z" />
    <circle cx="12" cy="11" r="2.3" />
  </Icon>
);
export const Target = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" />
  </Icon>
);
export const Wrench = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.7 6.3a3.8 3.8 0 1 0 3 3L20 7l-1.5-1.5-2.3 2.3" />
    <path d="M13.4 10.6L5 19l1.5 1.5 8.4-8.4" />
  </Icon>
);
export const Globe = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M4 12h16M12 4c2.4 2.4 2.4 13.2 0 16-2.4-2.8-2.4-13.6 0-16z" />
  </Icon>
);
export const Doc = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z" />
    <path d="M14 3v4.5h4.5M8.5 13h7M8.5 16.5h4.5" />
  </Icon>
);
export const Database = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" />
  </Icon>
);
export const Layers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l8.5 4.5L12 12 3.5 7.5z" />
    <path d="M20.5 12L12 16.5 3.5 12M20.5 16.5L12 21l-8.5-4.5" />
  </Icon>
);
export const Eye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="12" cy="12" r="2.6" />
  </Icon>
);
export const Filter = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 5.5h17l-6.5 7.5V20l-4-2v-5z" />
  </Icon>
);
export const Sliders = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
);
export const Send = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 3L10.5 13.5M21 3l-6.5 18-4-8-8-4z" />
  </Icon>
);
export const Mail = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="5.5" width="18" height="13" rx="2" />
    <path d="M3.8 7l8.2 6 8.2-6" />
  </Icon>
);
export const Chat = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-8 8H8l-4 2.5V12a8 8 0 0 1 8-8h1a8 8 0 0 1 8 8z" />
  </Icon>
);
export const Chart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V9M10 20V4M16 20v-7M22 20H2" />
  </Icon>
);
export const Calendar = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);
export const Phone = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
  </Icon>
);
export const Building = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 21V6l7-3v18M11 21h9V10l-9-3" />
    <path d="M7 9h1M7 13h1M15 13h1M15 17h1" />
  </Icon>
);
export const Briefcase = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="7.5" width="18" height="12" rx="2" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5M3 12h18" />
  </Icon>
);
export const Bolt = (p: IconProps) => (
  <Icon {...p}>
    <path d="M13.5 3L5 13.5h5L9.5 21 19 10.5h-5.5z" />
  </Icon>
);
export const Clock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);
export const Trend = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 17l6-6 4 4 7-7" />
    <path d="M15 8h5.5v5.5" />
  </Icon>
);
export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const Minus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);
export const Close = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const Dots = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5.5" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.5" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
);
export const Pause = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5v14M15 5v14" />
  </Icon>
);
export const Clip = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11.5l-8.2 8.2a4.5 4.5 0 0 1-6.4-6.4l8.4-8.4a3 3 0 0 1 4.3 4.3l-8.4 8.4a1.5 1.5 0 0 1-2.1-2.1l7.7-7.7" />
  </Icon>
);
export const Spinner = (p: IconProps) => (
  <Icon {...p} className={cn("fl-spin", p.className)}>
    <path d="M12 4a8 8 0 1 0 8 8" />
  </Icon>
);
export const Settings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.6 7.8l1.9 1.1M17.5 15.1l1.9 1.1M19.4 7.8l-1.9 1.1M6.5 15.1l-1.9 1.1" />
  </Icon>
);
export const Bookmark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 4h12v17l-6-4-6 4z" />
  </Icon>
);
export const List = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Icon>
);
export const Pencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16.5 4.5l3 3L8 19l-4 1 1-4z" />
  </Icon>
);
export const External = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5h5" />
  </Icon>
);
