"use client";

import * as React from "react";

/**
 * Hydration-safe `prefers-reduced-motion` for the public site.
 *
 * motion's own `useReducedMotion()` reads the media query on the client's
 * first render, while the server can only answer "no". A component that
 * branches on it during render (a `style`, a `data-state`, a starting number)
 * then renders different attributes on a reduced-motion client than the server
 * sent. React does not patch attributes after a hydration mismatch, so the
 * server's version sticks: surface QA 2026-09-30 found the home page's revenue
 * journey rail drawn empty, with no step marked done, for exactly the visitors
 * who asked for less movement (and a hydration error in the console).
 *
 * `useSyncExternalStore` answers with the server snapshot while hydrating and
 * re-renders with the real value straight after. The same pattern as
 * find-leads/motion.tsx, shared here for the rest of the marketing site.
 */
const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(REDUCED_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(REDUCED_QUERY).matches;
}

function serverSnapshot(): boolean {
  return false;
}

export function useReducedMotion(): boolean {
  return React.useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
