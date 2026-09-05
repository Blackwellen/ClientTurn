"use client";

import { useEffect } from "react";

export function LandingMotion() {
  useEffect(() => {
    let cancelled = false;
    let revert = () => {};
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        document.querySelectorAll<HTMLElement>(".ct-landing > section:not(.ct-hero):not(.conversion-hero):not(.clientturn-story):not(.clientturn-experience)").forEach((section) => {
          gsap.from(section.children, { y: 35, duration: 0.85, ease: "power2.out", scrollTrigger: { trigger: section, start: "top 90%", once: true } });
        });
      });
      revert = () => media.revert();
    }).catch(() => {});
    return () => { cancelled = true; revert(); };
  }, []);
  return null;
}
