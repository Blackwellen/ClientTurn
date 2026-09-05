"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { motion, useTransform } from "motion/react";
import { ArrowDown, Pause, Play } from "lucide-react";
import { HeroCopy } from "./HeroCopy";
import { HeroProgress } from "./HeroProgress";
import { HeroFallback } from "./HeroFallback";
import { useHeroScroll } from "./hooks/useHeroScroll";
import "./hero.css";

const ConversionScene = dynamic(() => import("./scene/ConversionScene"), { ssr: false, loading: () => <HeroFallback /> });

export function ClientTurnHero() {
  const { heroRef, viewportRef, progress, activeStage, hydrated, reducedMotion, mobile, visible } = useHeroScroll();
  const [paused, setPaused] = useState(false);
  const cueOpacity = useTransform(progress, [0, 0.12, 0.18], [1, 1, 0]);
  return <section ref={heroRef} className="conversion-hero" data-enhanced={hydrated && !reducedMotion} data-stage={activeStage} aria-label="From lead to paying client">
    <div ref={viewportRef} className="conversion-viewport">
      <div className="conversion-atmosphere" aria-hidden="true" />
      <div className="conversion-inner">
        <HeroCopy progress={progress} activeStage={activeStage} reducedMotion={reducedMotion} />
        <div className="conversion-visual" aria-hidden="true">
          <ConversionScene progress={progress} reducedMotion={reducedMotion} mobile={mobile} visible={visible} paused={paused} />
        </div>
        <HeroProgress progress={progress} activeStage={activeStage} />
      </div>
      <div className="conversion-toolbar">
        <motion.a href="#how-it-works" className="conversion-scroll" style={{ opacity: reducedMotion ? 1 : cueOpacity }}><ArrowDown size={16} aria-hidden /> Scroll through the journey</motion.a>
        <p>Illustrative journey. £8,420 is example pipeline value.</p>
        {!reducedMotion && <button type="button" className="conversion-pause" aria-pressed={paused} aria-label={paused ? "Play ambient motion" : "Pause ambient motion"} onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
      </div>
    </div>
  </section>;
}
