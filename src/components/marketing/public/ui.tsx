import * as React from "react";
import NextImage from "next/image";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Shared public-site primitives.
 *
 * Every V2 marketing surface composes from these so section spacing, content
 * width, heading scale and button hierarchy cannot drift between sections.
 * Presentation only — no client behaviour lives here, which keeps all of it
 * usable from Server Components.
 */

/* ------------------------------------------------------------- layout --- */

export function PublicContainer({
  narrow,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { narrow?: boolean }) {
  return (
    <div
      className={cn("pub-container", narrow && "pub-container-narrow", className)}
      {...props}
    />
  );
}

/**
 * A homepage section. `id` is the scroll anchor the header nav targets, so
 * every section that appears in navigation must pass one.
 */
export function PublicSection({
  id,
  labelledBy,
  tight,
  className,
  children,
  decoration,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  id?: string;
  labelledBy?: string;
  tight?: boolean;
  /** Decorative background layers. Rendered behind content, aria-hidden. */
  decoration?: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cn("pub-section", tight && "pub-section-tight", className)}
      {...props}
    >
      {decoration ? <div aria-hidden>{decoration}</div> : null}
      {children}
    </section>
  );
}

/** Decorative grid texture. Purely presentational. */
export function GridTexture({ className }: { className?: string }) {
  return <div aria-hidden className={cn("pub-grid-texture", className)} />;
}

/** Decorative radial illumination behind a section. */
export function Glow({
  x = "centre",
  y = "top",
  className,
  style,
}: {
  x?: "left" | "centre" | "right";
  y?: "top" | "middle" | "bottom";
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div aria-hidden data-x={x} data-y={y} className={cn("pub-glow", className)} style={style} />
  );
}

/** The wide lime arc sweeping a section corner. Decorative. */
export function Arc({ corner }: { corner: "tr" | "bl" }) {
  return <div aria-hidden data-corner={corner} className="pub-arc" />;
}

/* --------------------------------------------------------- typography --- */

export function SectionEyebrow({
  pill,
  className,
  children,
}: {
  pill?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("pub-eyebrow", pill && "pub-eyebrow-pill", className)}>{children}</p>
  );
}

/**
 * A section heading block. `title` takes a node so the approved lime
 * emphasis on the closing phrase can be expressed inline.
 */
export function SectionHeading({
  id,
  eyebrow,
  eyebrowPill,
  title,
  description,
  align = "left",
  className,
  children,
}: {
  id?: string;
  eyebrow?: React.ReactNode;
  eyebrowPill?: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "left" | "centre";
  className?: string;
  children?: React.ReactNode;
}) {
  const centred = align === "centre";
  return (
    <div className={cn(centred && "flex flex-col items-center text-center", className)}>
      {eyebrow ? (
        <SectionEyebrow pill={eyebrowPill} className="mb-5">
          {eyebrow}
        </SectionEyebrow>
      ) : null}
      <h2 id={id} className="pub-h2">
        {title}
      </h2>
      {description ? (
        <p className={cn("pub-lead mt-5 max-w-3xl", centred && "mx-auto")}>{description}</p>
      ) : null}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ surfaces --- */

export function PublicCard({
  as = "div",
  interactive,
  lit,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  interactive?: boolean;
  lit?: boolean;
}) {
  // Every caller passes plain HTML attributes, so the tag is narrowed to an
  // intrinsic element here — left as `React.ElementType`, JSX resolves the
  // shared props of every possible element, which is `never`.
  const Tag = as as "div";
  return (
    <Tag
      className={cn(
        "pub-card",
        interactive && "pub-card-interactive",
        lit && "pub-card-lit",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The lime glyph tile used on every node, step and capability header.
 * `solid` is the emphasis form — a filled lime square with a dark glyph.
 */
export function GlyphTile({
  icon: Icon,
  size = 40,
  glyph = 20,
  solid,
  className,
}: {
  icon: React.ComponentType<{
    className?: string;
    strokeWidth?: number;
    style?: React.CSSProperties;
  }>;
  size?: number;
  glyph?: number;
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-solid={solid ? "true" : undefined}
      className={cn("pub-tile", className)}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
    >
      <Icon className="shrink-0" strokeWidth={2} style={{ width: glyph, height: glyph }} />
    </span>
  );
}

/** Small outlined pill. Used for categories and filter chips. */
export function Chip({
  active,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { active?: boolean }) {
  return (
    <span
      className={cn(
        "pub-chip",
        active && "border-[var(--pub-lime-border)] bg-[var(--pub-lime-soft)] text-[var(--pub-lime)]",
        className,
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ controls --- */

export type ButtonSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "pub-btn-sm",
  md: "pub-btn-md",
  lg: "pub-btn-lg",
};

export function buttonClass(
  variant: "primary" | "secondary" | "quiet",
  size: ButtonSize = "md",
  className?: string,
) {
  return cn("pub-btn", `pub-btn-${variant}`, SIZE_CLASS[size], className);
}

/** Inline "Learn more →" affordance. */
export function ArrowLink({
  className,
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={cn("pub-link", className)} {...props}>
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </a>
  );
}

/* -------------------------------------------------------------- lockup --- */

/**
 * The ClientTurn wordmark, laid out by its ink rather than its file box.
 *
 * `dark_background_logo.png` is 2172x724 but the mark inside it only occupies
 * 1952x430 — roughly 20% of the file's height is transparent padding, top and
 * bottom. Laying the raw <img> out therefore centres the *file*, not the
 * mark, which reads as the logo sitting low inside anything that centres it.
 *
 * This sizes the element so its layout box equals the visible mark: the image
 * is rendered at the height that produces the requested ink height, and the
 * phantom padding is pulled back out with negative margins. Pass any CSS
 * length — including a canvas-unit `calc()` — as `inkHeight`.
 */
const LOCKUP_INK_RATIO = 430 / 724;
const LOCKUP_PAD_TOP = 144 / 724;
const LOCKUP_PAD_BOTTOM = 150 / 724;

export function Lockup({
  inkHeight,
  priority,
  className,
}: {
  /** The height the visible mark should occupy. */
  inkHeight: string;
  priority?: boolean;
  className?: string;
}) {
  const box = `calc(${inkHeight} / ${LOCKUP_INK_RATIO})`;
  return (
    <NextImage
      src="/dark_background_logo.png"
      alt=""
      width={2172}
      height={724}
      priority={priority}
      className={className}
      style={{
        height: box,
        width: "auto",
        marginTop: `calc(${box} * ${-LOCKUP_PAD_TOP})`,
        marginBottom: `calc(${box} * ${-LOCKUP_PAD_BOTTOM})`,
      }}
    />
  );
}
