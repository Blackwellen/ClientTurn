"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useInView, useMotionValueEvent, useScroll, useSpring, useTransform } from "motion/react";
import { activeStageAt } from "../constants/stages";

const subscribeHydrated = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const subscribeVisibility = (callback: () => void) => {
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
};
const visibleSnapshot = () => !document.hidden;

export function useMediaQuery(query: string) {
  const subscribe = useCallback((callback: () => void) => {
    const media = window.matchMedia(query);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  }, [query]);
  const snapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

export function useHeroScroll() {
  const heroRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(subscribeHydrated, clientSnapshot, serverSnapshot);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mobile = useMediaQuery("(max-width: 899px)");
  const pageVisible = useSyncExternalStore(subscribeVisibility, visibleSnapshot, clientSnapshot);
  const inView = useInView(viewportRef, { amount: 0.05 });
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start 72px", "end end"], trackContentSize: true });
  const smoothed = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const progress = useTransform(smoothed, (value) => reducedMotion ? 0 : value);
  const [activeStage, setActiveStage] = useState(-1);
  const currentStage = useRef(-1);
  useMotionValueEvent(progress, "change", (value) => {
    const next = activeStageAt(value);
    if (next !== currentStage.current) {
      currentStage.current = next;
      setActiveStage(next);
    }
  });
  return { heroRef, viewportRef, progress, activeStage: reducedMotion ? -1 : activeStage, hydrated, reducedMotion, mobile, visible: inView && pageVisible };
}
