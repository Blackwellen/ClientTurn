"use client";

import * as React from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useInView,
  useReducedMotion,
  type Transition,
  type Variants,
} from "motion/react";

/**
 * The motion vocabulary for /product/find-leads.
 *
 * One module, for two reasons. First, an enterprise page has to move as a
 * single system: nine different easing curves invented in nine components read
 * as nine different products. Second, reduced motion has to be honoured in
 * exactly one place — every helper here resolves to the *final* state
 * immediately when the visitor has asked for less movement, so the page is
 * never a set of half-visible panels waiting for an animation that will not
 * run.
 *
 * The named states are the ones the design calls for:
 *
 *   chatMessageEnter · planExpand · runStageAdvance · prospectTableReveal
 *   scoreFactorExpand · intentPulse · wizardStepSlide · entityPromotion
 *   funnelReveal
 *
 * Everything animates `transform` and `opacity` (plus SVG stroke and grid
 * rows, which are cheap), never blur, shadow or layout width.
 */

/* ------------------------------------------------------------ transitions */

/** The page's one easing curve: quick out, long settle. */
export const EASE = [0.22, 1, 0.36, 1] as const;

export const T = {
  /** Micro-interaction — a chip, a toggle, a chevron. */
  fast: { duration: 0.22, ease: EASE } as Transition,
  /** The default: a panel or a row arriving. */
  base: { duration: 0.45, ease: EASE } as Transition,
  /** A whole section settling into place. */
  slow: { duration: 0.7, ease: EASE } as Transition,
  /** The promotion morph, which the eye needs to follow. */
  morph: { duration: 0.55, ease: EASE } as Transition,
  /** Collapse and expand of a disclosure. */
  collapse: { duration: 0.3, ease: EASE } as Transition,
} as const;

/* --------------------------------------------------------------- variants */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: T.base },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: T.base },
};

/** A panel arriving: lifts and settles, with a whisper of scale. */
export const panelEnter: Variants = {
  hidden: { opacity: 0, y: 26, scale: 0.985 },
  shown: { opacity: 1, y: 0, scale: 1, transition: T.slow },
};

/** Staggers children. `staggerChildren` is the rhythm of the whole page. */
export function stagger(step = 0.07, delay = 0): Variants {
  return {
    hidden: {},
    shown: {
      transition: { staggerChildren: step, delayChildren: delay },
    },
  };
}

/** A chat bubble: enters from its own side of the conversation. */
export function chatMessageEnter(outbound: boolean): Variants {
  return {
    hidden: { opacity: 0, y: 10, x: outbound ? 12 : -12 },
    shown: { opacity: 1, y: 0, x: 0, transition: T.base },
  };
}

/** The structured plan unfolding under the assistant's reply. */
export const planExpand: Variants = {
  hidden: { opacity: 0, height: 0 },
  shown: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.5, ease: EASE },
  },
  exit: { opacity: 0, height: 0, transition: T.collapse },
};

/** One plan field appearing. */
export const planField: Variants = {
  hidden: { opacity: 0, x: -8 },
  shown: { opacity: 1, x: 0, transition: T.fast },
};

/** A sourcing stage changing state. */
export const runStageAdvance: Variants = {
  hidden: { opacity: 0, x: -10 },
  shown: { opacity: 1, x: 0, transition: T.fast },
};

/** A prospect row arriving in the inbox. */
export const prospectTableReveal: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: T.fast },
};

/** A score factor's evidence opening. */
export const scoreFactorExpand: Variants = {
  hidden: { opacity: 0, height: 0 },
  shown: { opacity: 1, height: "auto", transition: T.collapse },
  exit: { opacity: 0, height: 0, transition: T.collapse },
};

/** A wizard step's panel sliding in from the direction of travel. */
export function wizardStepSlide(direction: 1 | -1): Variants {
  return {
    hidden: { opacity: 0, x: 22 * direction },
    shown: { opacity: 1, x: 0, transition: T.base },
    exit: { opacity: 0, x: -22 * direction, transition: T.fast },
  };
}

/** Prospect becoming Lead: the chip morphs, the conversation does not move. */
export const entityPromotion: Variants = {
  hidden: { opacity: 0, scale: 0.86, filter: "none" },
  shown: { opacity: 1, scale: 1, transition: T.morph },
  exit: { opacity: 0, scale: 0.86, transition: T.fast },
};

/** A funnel bar growing to its share. */
export const funnelReveal: Variants = {
  hidden: { scaleX: 0 },
  shown: { scaleX: 1, transition: { duration: 0.8, ease: EASE } },
};

/* ------------------------------------------------------------------ hooks */

/**
 * True once the element has been on screen, and true immediately when the
 * visitor prefers reduced motion.
 *
 * `once` is deliberate: a marketing page that re-animates every time you
 * scroll back up is a page that will not let you re-read it.
 */
export function useReveal<T extends Element = HTMLDivElement>(amount = 0.18) {
  const ref = React.useRef<T>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, amount });
  return { ref, shown: reduced ? true : inView, reduced: !!reduced };
}

/**
 * Advances a counter from 0 to `count` on an interval, once on screen.
 *
 * Used for the sourcing run and the hero conversation. Under reduced motion it
 * resolves to `count` on the first render, so the final state is what the
 * visitor sees — never an animation they did not ask for, and never a page
 * missing content because the animation was skipped.
 */
export function useSequence<T extends Element = HTMLDivElement>(
  count: number,
  intervalMs = 900,
) {
  const ref = React.useRef<T>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reduced-motion is a browser query, so the final state can only be applied after mount.
      setStep(count);
      return;
    }
    if (!inView) return;

    let current = 0;
    setStep(1);
    const timer = setInterval(() => {
      current += 1;
      if (current >= count) {
        clearInterval(timer);
        setStep(count);
        return;
      }
      setStep(current + 1);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [count, intervalMs, inView, reduced]);

  return { ref, step, reduced: !!reduced };
}

/* ------------------------------------------------------------ components */

/**
 * A block that fades and lifts into place the first time it is seen.
 *
 * `as` keeps the semantics right: a revealed list has to stay a `ul`, and a
 * revealed section has to stay a `section`.
 */
export function Reveal({
  as = "div",
  amount = 0.18,
  delay = 0,
  variants = fadeUp,
  className,
  style,
  children,
  ...rest
}: {
  as?: "div" | "section" | "ul" | "ol" | "li" | "article" | "p" | "span";
  amount?: number;
  delay?: number;
  variants?: Variants;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & Record<string, unknown>) {
  const reduced = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag
      className={className}
      style={style}
      initial={reduced ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount }}
      variants={variants}
      transition={delay ? { delay } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A container that reveals its children one after another.
 *
 * Children must be `motion` elements using the `hidden`/`shown` names above;
 * `StaggerItem` is the convenience wrapper for that.
 */
export function StaggerReveal({
  as = "div",
  step = 0.07,
  delay = 0,
  amount = 0.15,
  className,
  style,
  children,
  ...rest
}: {
  as?: "div" | "ul" | "ol" | "dl" | "section";
  step?: number;
  delay?: number;
  amount?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & Record<string, unknown>) {
  const reduced = useReducedMotion();
  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag
      className={className}
      style={style}
      initial={reduced ? "shown" : "hidden"}
      whileInView="shown"
      viewport={{ once: true, amount }}
      variants={stagger(reduced ? 0 : step, reduced ? 0 : delay)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function StaggerItem({
  as = "div",
  variants = fadeUp,
  className,
  style,
  children,
  ...rest
}: {
  as?: "div" | "li" | "span" | "p" | "article";
  variants?: Variants;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
} & Record<string, unknown>) {
  const Tag = motion[as] as typeof motion.div;
  return (
    <Tag className={className} style={style} variants={variants} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * A height-animated disclosure that is correct with JavaScript disabled.
 *
 * `AnimatePresence` unmounts the panel when closed, so a collapsed section is
 * genuinely absent from the accessibility tree rather than merely clipped.
 */
export function Collapse({
  open,
  id,
  variants = scoreFactorExpand,
  children,
}: {
  open: boolean;
  id?: string;
  variants?: Variants;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={id}
          key="panel"
          initial={reduced ? "shown" : "hidden"}
          animate="shown"
          exit={reduced ? "shown" : "exit"}
          variants={variants}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** An SVG-free progress bar whose fill animates to its percentage. */
export function AnimatedBar({
  percent,
  className,
  fillClassName,
  label,
}: {
  percent: number;
  className?: string;
  fillClassName?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <div
      className={className}
      role={label ? "progressbar" : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(percent) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? 100 : undefined}
    >
      <motion.span
        className={fillClassName}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={reduced ? { duration: 0 } : T.slow}
      />
    </div>
  );
}

/** A number that counts up to its value once on screen. */
export function CountUp({
  value,
  format = (n: number) => n.toLocaleString("en-GB"),
  durationMs = 900,
}: {
  value: number;
  format?: (n: number) => string;
  durationMs?: number;
}) {
  const reduced = useReducedMotion();
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [shown, setShown] = React.useState(reduced ? value : 0);

  React.useEffect(() => {
    if (reduced || !inView) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the final value must be present whenever the animation will not run.
      if (reduced) setShown(value);
      return;
    }

    const start = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1);
      // Same curve as the rest of the page, evaluated as an ease-out.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, durationMs, inView, reduced]);

  return (
    <span ref={ref} className="tabular-nums">
      {format(shown)}
    </span>
  );
}

export { AnimatePresence, LayoutGroup, motion, useReducedMotion };
