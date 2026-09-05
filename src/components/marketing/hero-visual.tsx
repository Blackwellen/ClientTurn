"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, Check, MessageSquare, CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CtaLink } from "./cta";
import type { createHeroScene } from "./hero-scene";

export function HeroVisual() {
  const root = useRef<HTMLElement>(null);
  const mount = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createHeroScene> | null>(null);
  const progress = useRef(0);
  const [paused, setPaused] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revert = () => {};
    const element = mount.current;
    const section = root.current;
    if (!element || !section) return;
    import("./hero-scene").then(({ createHeroScene }) => {
      if (cancelled) return;
      scene.current = createHeroScene(element);
      scene.current.setProgress(progress.current);
      setAvailable(true);
    }).catch(() => { /* Keep the static composition when WebGL is unavailable. */ });
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([{ gsap }, { ScrollTrigger }]) => {
      if (cancelled) return;
      gsap.registerPlugin(ScrollTrigger);
      const media = gsap.matchMedia();
      media.add("(min-width: 900px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)", () => {
        section.dataset.enhanced = "true";
        const driver = { value: 0 };
        const tween = gsap.to(driver, {
          value: 1, ease: "none",
          scrollTrigger: { trigger: section, start: "top top+=72", end: "bottom bottom", scrub: 0.65, invalidateOnRefresh: true },
          onUpdate: () => {
            progress.current = driver.value;
            scene.current?.setProgress(driver.value);
            section.dataset.chapter = String(driver.value < 0.32 ? 0 : driver.value < 0.7 ? 1 : 2);
            section.style.setProperty("--journey-progress", String(driver.value));
          },
        });
        return () => {
          tween.scrollTrigger?.kill();
          tween.kill();
          delete section.dataset.enhanced;
          section.dataset.chapter = "0";
          progress.current = 0;
          scene.current?.setProgress(0);
        };
      });
      revert = () => media.revert();
    }).catch(() => { /* Native scrolling and subsequent sections still work. */ });
    return () => { cancelled = true; revert(); scene.current?.dispose(); scene.current = null; };
  }, []);

  return (
    <section ref={root} className="ct-hero" data-chapter="0" aria-label="Turn leads into clients">
      <div className="ct-hero-pin">
        <div className="ct-hero-grid" aria-hidden="true" />
        <div className="ct-hero-inner">
          <div className="ct-hero-copy">
            <div className="ct-chapter ct-chapter-0">
              <p className="ct-eyebrow"><span /> THE FOLLOW-UP ADVANTAGE</p>
              <h1>Good leads.<br />Great clients.<br /><span>Your turn.</span></h1>
              <p className="ct-hero-description">Turn Facebook &amp; Instagram enquiries into booked jobs. Fast follow-up, thoughtful qualification, and a clear path to your calendar.</p>
              <div className="ct-hero-actions">
                <CtaLink placement="hero_primary" size="lg">Start your free trial <ArrowUpRight size={17} aria-hidden /></CtaLink>
                <Link href="#how-it-works" className="ct-text-link">See how it works <ArrowDown size={15} aria-hidden /></Link>
              </div>
              <p className="ct-trial-note">14 days free <span>·</span> No card required <span>·</span> Built for UK trades</p>
            </div>
            <div className="ct-chapter ct-chapter-1">
              <p className="ct-eyebrow">01 / START THE CONVERSATION</p>
              <h2>Be there.<br />Before they<br /><span>move on.</span></h2>
              <p className="ct-hero-description">Every new enquiry gets your configured first message. Follow-up continues on your schedule, inside your quiet hours, until they reply or opt out.</p>
              <p className="ct-chapter-footnote">Your number. Your words. Consistently delivered.</p>
            </div>
            <div className="ct-chapter ct-chapter-2">
              <p className="ct-eyebrow">02 / MAKE THE RIGHT CONNECTION</p>
              <h2>Less chasing.<br />More<br /><span>possibility.</span></h2>
              <p className="ct-hero-description">Ask the questions that matter. Match answers to your rules. Send qualified enquiries to your booking calendar or straight to your team.</p>
              <CtaLink placement="hero_primary" size="lg">Make your next move <ArrowUpRight size={17} aria-hidden /></CtaLink>
            </div>
          </div>
          <div className="ct-artwork">
            <div className="ct-orbit ct-orbit-outer" aria-hidden="true" />
            <div className="ct-orbit ct-orbit-inner" aria-hidden="true" />
            <span className="ct-art-label" aria-hidden="true">THE CLIENTTURN EFFECT</span>
            <div ref={mount} className="ct-canvas" aria-hidden="true"><div className="ct-sculpture-fallback">C</div></div>
            <div className="ct-floating-card ct-card-incoming">
              <span className="ct-card-icon"><MessageSquare size={17} aria-hidden /></span>
              <div><small>NEW OPPORTUNITY</small><strong>Enquiry received</strong></div><span className="ct-card-dot" />
            </div>
            <div className="ct-floating-card ct-card-booking">
              <span className="ct-card-icon"><CalendarDays size={17} aria-hidden /></span>
              <div><small>NEXT CHAPTER</small><strong>Quote booked</strong></div><Check size={15} className="text-brand-lime" aria-hidden />
            </div>
            <div className="ct-art-footer"><span>ENQUIRY</span><span className="ct-art-line" /><span>OUTCOME</span></div>
            <p className="ct-demo-label">Illustrative workflow</p>
          </div>
        </div>
        <div className="ct-hero-bottom">
          <a href="#how-it-works" className="ct-scroll-cue"><ArrowDown size={15} aria-hidden /> SCROLL TO SEE THE TURN</a>
          <div className="ct-chapter-markers" aria-hidden="true"><span>01 — CONNECT</span><span>02 — QUALIFY</span><span>03 — BOOK</span></div>
          {available && <button type="button" aria-pressed={paused} onClick={() => { scene.current?.setPaused(!paused); setPaused(!paused); }} className="ct-pause motion-reduce:hidden">{paused ? "Play motion" : "Pause motion"}</button>}
        </div>
        <div className="ct-scroll-progress" aria-hidden="true" />
      </div>
    </section>
  );
}
