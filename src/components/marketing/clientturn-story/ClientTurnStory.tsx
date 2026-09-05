"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { motion, useInView, useMotionValueEvent, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { useMediaQuery } from "../hero/hooks/useHeroScroll";
import { STORY_STAGES } from "./stages";
import "./story.css";

const StoryScene = dynamic(() => import("./StoryScene"), { ssr: false });

function ChapterCopy({ index, progress, staticMode = false }: { index: number; progress: MotionValue<number>; staticMode?: boolean }) {
  const stage = STORY_STAGES[index];
  const opacity = useTransform(progress, value => {
    const local = value * 6 - index;
    if (index === 0 && local < 0.15) return 1;
    if (index === 5 && local > 0.8) return 1;
    return Math.max(0, Math.min(1, (local + 0.05) / 0.2, (1.05 - local) / 0.2));
  });
  const y = useTransform(progress, value => Math.max(-18, Math.min(18, (index + 0.5 - value * 6) * 28)));
  return <motion.div className="story-copy" data-side={stage.side} style={staticMode ? undefined : { opacity, y }}>
    <p className="story-eyebrow"><span>{String(index + 1).padStart(2, "0")}</span>{stage.title}</p>
    <h2>{stage.headline.split("\n").map((line, i) => <span key={i}>{line}</span>)}</h2>
    <p className="story-description">{stage.description}</p>
  </motion.div>;
}

function StaticChapter({ index, progress, mobile }: { index: number; progress: MotionValue<number>; mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { margin: "200px" });
  return <div ref={ref} className="story-static-chapter">
    <ChapterCopy index={index} progress={progress} staticMode />
    <div className="story-world" aria-hidden="true">{visible && <StoryScene progress={progress} mobile={mobile} visible={visible} staticIndex={index} />}</div>
  </div>;
}

export function ClientTurnStory() {
  const ref = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const mobile = useMediaQuery("(max-width: 899px)");
  const visible = useInView(viewport, { amount: 0.01 });
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 72px", "end end"], trackContentSize: true });
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 30, mass: 0.35 });
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  useMotionValueEvent(progress, "change", value => {
    const next = Math.min(5, Math.floor(value * 6));
    if (activeRef.current !== next) { activeRef.current = next; setActive(next); }
  });
  return <section ref={ref} id="how-it-works" className="clientturn-story" data-reduced={reduced} aria-label="Inside ClientTurn">
    {reduced ? STORY_STAGES.map((_, index) => <StaticChapter key={index} index={index} progress={progress} mobile={mobile} />) : <div ref={viewport} className="story-viewport">
      <div className="story-world" aria-hidden="true"><StoryScene progress={progress} mobile={mobile} visible={visible} /></div>
      {STORY_STAGES.map((_, index) => <ChapterCopy key={index} index={index} progress={progress} />)}
      <div className="story-bottom"><span>THE CLIENTTURN SYSTEM</span><ol aria-label="Product chapters">{STORY_STAGES.map((stage, index) => <li key={stage.title} aria-current={active === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><span className="sr-only">{stage.title}</span></li>)}</ol></div>
    </div>}
    <div className="sr-only">{STORY_STAGES.map(stage => <div key={stage.title}><h3>{stage.title}</h3><p>{stage.details.join(". ")}.</p></div>)}</div>
    <span id="results" className="story-results-anchor" />
  </section>;
}
