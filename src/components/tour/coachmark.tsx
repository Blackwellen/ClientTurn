"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  connectorLine,
  connectorPath,
  cutoutPath,
  floatingCaptionRect,
  floatingEdge,
  isFullyInView,
  isNarrow,
  placeCaption,
  spotlightRect,
  type Placement,
  type Rect,
  type Size,
} from "@/lib/tour/geometry";
import { isLastStep, stepCounter, tourSelector, type TourStep } from "@/lib/tour/model";

/**
 * A reusable coachmark / spotlight (Phase 8.4).
 *
 * Dims the page with an SVG backdrop that has a rounded hole cut around the
 * target, and anchors a branded caption beside it, joined to the target by a
 * lime leader line that ends in a dot on the spotlight. Behaviour:
 *
 *   - Targets are `data-tour="…"` keys; the first visible candidate wins, and
 *     a step with none visible still shows as a floating caption.
 *   - Re-measures on resize, on any scroll (captured, so scrolling panes
 *     count too) and when the target's own size changes.
 *   - Below 640px, or when there is no room beside the target, the caption is
 *     a bottom sheet (or top sheet, if the target is low on the screen). The
 *     line still runs from the sheet to the target whenever the target is
 *     visible and clear of the sheet.
 *   - Keyboard: → next, ← back, Esc skips. Tab is trapped in the caption and
 *     focus returns to where it was when the tour ends.
 *   - `prefers-reduced-motion`: no transitions, no smooth scrolling, and the
 *     line appears whole instead of drawing itself in.
 *
 * The backdrop swallows clicks, so nothing on the page can be triggered by
 * accident mid-tour. No positioning library: `@/lib/tour/geometry` is ~150
 * lines of tested maths, which is less than any dependency would weigh.
 */

const TARGET_WAIT_MS = 3500;
const POLL_MS = 120;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function toRect(rect: DOMRect): Rect {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function findTarget(keys: string[]): HTMLElement | null {
  for (const key of keys) {
    for (const node of document.querySelectorAll<HTMLElement>(tourSelector(key))) {
      // Any rendered size counts, even off screen: the caller scrolls it in.
      // A zero-size match is hidden (e.g. the desktop rail on a phone).
      const rect = node.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return node;
    }
  }
  return null;
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export function Coachmark({
  step,
  index,
  total,
  routeKey,
  heading = "ClientTurn tour",
  firstLabel = "Start tour",
  onNext,
  onBack,
  onSkip,
}: {
  step: TourStep;
  index: number;
  total: number;
  /** Changes when the page changes, so the target is looked for again. */
  routeKey?: string;
  /** The small branded label beside the favicon, e.g. "Leads tour". */
  heading?: string;
  /** The primary button on the first step. */
  firstLabel?: string;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const popRef = React.useRef<HTMLDivElement>(null);
  const nextRef = React.useRef<HTMLButtonElement>(null);
  const [viewport, setViewport] = React.useState<Size>({ width: 0, height: 0 });
  const [target, setTarget] = React.useState<Rect | null>(null);
  const [searching, setSearching] = React.useState(step.targets.length > 0);
  const [placement, setPlacement] = React.useState<Placement>({ mode: "floating" });
  const [popSize, setPopSize] = React.useState<Size>({ width: 0, height: 0 });

  const last = isLastStep(index, total);
  const titleId = `tour-title-${step.id}`;
  const bodyId = `tour-body-${step.id}`;

  /* --------------------------------------------- find and follow the target */
  React.useEffect(() => {
    let element: HTMLElement | null = null;
    let frame = 0;
    let scrolled = false;
    const started = Date.now();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => schedule());

    function measure() {
      frame = 0;
      const vp = { width: window.innerWidth, height: window.innerHeight };
      setViewport((current) => (current.width === vp.width && current.height === vp.height ? current : vp));

      if (step.targets.length === 0) {
        setTarget(null);
        setSearching(false);
        return;
      }
      if (!element || !element.isConnected) {
        element = findTarget(step.targets);
        if (element) observer?.observe(element);
      }
      if (!element) {
        setTarget(null);
        return;
      }
      const rect = toRect(element.getBoundingClientRect());
      if (rect.width === 0 || rect.height === 0) {
        // Hidden since we found it (a drawer closed, the viewport crossed a
        // breakpoint): look again from the top of the candidate list.
        observer?.unobserve(element);
        element = null;
        setTarget(null);
        return;
      }
      if (!scrolled && !isFullyInView(rect, vp, 16) && rect.height < vp.height) {
        scrolled = true;
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
      }
      setTarget(rect);
      setSearching(false);
    }

    function schedule() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }

    measure();
    const poll = window.setInterval(() => {
      if (element && element.isConnected) return;
      measure();
      if (Date.now() - started > TARGET_WAIT_MS) {
        // Give up waiting and show the caption on its own.
        setSearching(false);
        window.clearInterval(poll);
      }
    }, POLL_MS);

    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [step, routeKey, reduced]);

  /* ----------------------------------------------------- place the caption */
  // The caption's size is CSS-transitioned, so a measurement taken in the same
  // commit can be the old size (on the first step, the full-width sheet it
  // starts as). Re-measure whenever it actually resizes; otherwise the caption
  // stayed floating and the leader line pointed at where the sheet would have
  // been, missing the caption entirely (8.7).
  const [sizeTick, setSizeTick] = React.useState(0);
  React.useEffect(() => {
    const pop = popRef.current;
    if (!pop || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setSizeTick((tick) => tick + 1));
    observer.observe(pop);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop || viewport.width === 0) return;
    const size = { width: pop.offsetWidth, height: pop.offsetHeight };
    setPopSize((current) => (current.width === size.width && current.height === size.height ? current : size));
    setPlacement(
      placeCaption({
        target: target ? spotlightRect(target, viewport) : null,
        popover: size,
        viewport,
        preferred: step.placement,
      }),
    );
  }, [target, viewport, step, searching, sizeTick]);

  /* ------------------------------------------------------ keyboard + focus */
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => opener?.focus?.();
  }, []);

  React.useEffect(() => {
    nextRef.current?.focus({ preventScroll: true });
  }, [step.id]);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onSkip();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (index > 0) onBack();
        return;
      }
      if (event.key === "Tab" && popRef.current) {
        const items = Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (items.length === 0) return;
        const first = items[0];
        const lastItem = items[items.length - 1];
        const inside = popRef.current.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || !inside)) {
          event.preventDefault();
          lastItem.focus();
        } else if (!event.shiftKey && (document.activeElement === lastItem || !inside)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    // Capture, so the page's own shortcuts and Escape handlers (drawers, the
    // support popout) do not also fire while the tour is up.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [index, onBack, onNext, onSkip]);

  const hole = target && viewport.width > 0 ? spotlightRect(target, viewport) : null;
  const narrow = isNarrow(viewport);
  const anchored = placement.mode === "anchored" ? placement : null;
  const edge = floatingEdge(hole, viewport);
  const motion = reduced ? "" : "transition-[top,left,width,height,opacity,transform] duration-300 ease-out";
  const progress = ((index + 1) / total) * 100;

  // Where the caption actually is, for the leader line. Anchored: where it was
  // placed. Floating: where its CSS puts it (a sheet on phones, a centred card
  // otherwise). Not drawn while the caption is still looking for its target.
  const captionRect: Rect | null =
    popSize.width > 0 && viewport.width > 0
      ? anchored
        ? { top: anchored.top, left: anchored.left, width: popSize.width, height: popSize.height }
        : floatingCaptionRect(viewport, popSize, edge)
      : null;
  const line = hole && captionRect && !searching ? connectorLine(captionRect, hole) : null;

  return createPortal(
    <div className="fixed inset-0 z-[90]" data-product-tour="">
      {/* Backdrop with the cut-out. Clicks are swallowed, not passed through. */}
      <svg
        aria-hidden
        className="absolute inset-0 h-full w-full"
        width={viewport.width}
        height={viewport.height}
        onClick={(event) => event.stopPropagation()}
      >
        <path d={cutoutPath(viewport, hole)} fill="rgba(11, 16, 32, 0.66)" fillRule="evenodd" />
      </svg>

      {line ? (
        <svg
          aria-hidden
          data-tour-connector=""
          className="pointer-events-none absolute inset-0 h-full w-full"
          width={viewport.width}
          height={viewport.height}
        >
          {/* pathLength=1 lets the draw-in animate the dash offset 1 -> 0
              whatever the line's real length. */}
          <path
            d={connectorPath(line)}
            pathLength={1}
            strokeDasharray="1 1"
            fill="none"
            stroke="var(--ct-lime)"
            strokeWidth={2}
            strokeLinecap="round"
            className={reduced ? undefined : "ct-tour-draw"}
          />
          <circle
            cx={line.to.x}
            cy={line.to.y}
            r={8}
            fill="none"
            stroke="rgba(183,243,74,0.45)"
            strokeWidth={1.5}
            className={reduced ? undefined : "ct-tour-dot"}
          />
          <circle
            cx={line.to.x}
            cy={line.to.y}
            r={4}
            fill="var(--ct-lime)"
            className={reduced ? undefined : "ct-tour-dot"}
          />
        </svg>
      ) : null}

      {hole ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-[12px] ring-2 ring-[var(--ct-lime)]",
            "shadow-[0_0_0_6px_rgba(183,243,74,0.18),0_0_32px_rgba(183,243,74,0.25)]",
            motion,
          )}
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      ) : null}

      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className={cn(
          "absolute flex flex-col bg-[#0B1020] text-white shadow-[0_24px_60px_-12px_rgba(0,0,0,0.55)]",
          "border border-[rgba(183,243,74,0.35)]",
          motion,
          anchored
            ? "w-[min(360px,calc(100vw-24px))] rounded-2xl"
            : narrow
              ? cn(
                  "inset-x-0 w-full",
                  edge === "bottom"
                    ? "bottom-0 rounded-t-2xl border-b-0 pb-[max(16px,env(safe-area-inset-bottom))]"
                    : "top-0 rounded-b-2xl border-t-0 pt-[max(8px,env(safe-area-inset-top))]",
                )
              : cn(
                  "left-1/2 w-[min(400px,calc(100vw-24px))] -translate-x-1/2 rounded-2xl",
                  edge === "bottom" ? "bottom-6" : "top-6",
                ),
          searching && step.targets.length > 0 ? "opacity-0" : "opacity-100",
        )}
        style={anchored ? { top: anchored.top, left: anchored.left } : undefined}
      >
        {anchored ? <Arrow side={anchored.side} offset={anchored.arrow} /> : null}

        <div className="flex items-center gap-2.5 px-4 pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 20px static favicon; next/image adds nothing here. */}
          <img src="/favicon-192.png" alt="" width={20} height={20} className="size-5 rounded-[5px]" />
          <span className="truncate text-[12px] font-semibold tracking-wide text-[#E7FFC0]">{heading}</span>
          <span className="ml-auto text-[12px] tabular-nums text-[#9aa6b8]">{stepCounter(index, total)}</span>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Close tour"
            className="-mr-1.5 flex size-7 items-center justify-center rounded-md text-[#9aa6b8] hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ct-lime)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="px-4 pt-2.5">
          <h2 id={titleId} className="text-[16.5px] font-semibold leading-snug text-white">
            {step.title}
          </h2>
          <p id={bodyId} className="mt-1.5 text-[13.5px] leading-relaxed text-[#c7d0dc]">
            {step.body}
          </p>
        </div>

        <div
          className="mx-4 mt-4 h-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Tour progress"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={index + 1}
        >
          <div
            className={cn("h-full rounded-full bg-[var(--ct-lime)]", reduced ? "" : "transition-[width] duration-300")}
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="flex items-center gap-2 px-4 pb-4 pt-3.5">
          {!last ? (
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-1 text-[13px] font-medium text-[#9aa6b8] underline-offset-4 hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
            >
              Skip tour
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {index > 0 ? (
              <button
                type="button"
                onClick={onBack}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 px-3 text-[13px] font-medium text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ct-lime)]"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back
              </button>
            ) : null}
            <button
              ref={nextRef}
              type="button"
              onClick={onNext}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--ct-lime)] px-3.5 text-[13px] font-semibold text-[#0B1020] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {last ? "Finish" : index === 0 ? firstLabel : "Next"}
              {!last ? <ArrowRight className="size-3.5" aria-hidden /> : null}
            </button>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite">
        {`${stepCounter(index, total)}: ${step.title}`}
      </p>
    </div>,
    document.body,
  );
}

function Arrow({ side, offset }: { side: "top" | "bottom" | "left" | "right"; offset: number }) {
  // A rotated square half-hidden behind the caption; it points from the
  // caption's edge towards the target.
  const style: React.CSSProperties =
    side === "bottom"
      ? { top: -6, left: offset - 6 }
      : side === "top"
        ? { bottom: -6, left: offset - 6 }
        : side === "right"
          ? { left: -6, top: offset - 6 }
          : { right: -6, top: offset - 6 };
  const borders =
    side === "bottom"
      ? "border-l border-t"
      : side === "top"
        ? "border-b border-r"
        : side === "right"
          ? "border-b border-l"
          : "border-r border-t";
  return (
    <span
      aria-hidden
      className={cn("absolute size-3 rotate-45 border-[rgba(183,243,74,0.35)] bg-[#0B1020]", borders)}
      style={style}
    />
  );
}
