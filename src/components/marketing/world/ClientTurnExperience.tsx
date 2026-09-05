"use client";

import dynamic from "next/dynamic";
import { useRef } from "react";
import { motion, useInView, useScroll, useSpring, useTransform, type MotionValue } from "motion/react";
import { ArrowRight } from "lucide-react";
import { CtaLink } from "../cta";
import { useMediaQuery } from "../hero/hooks/useHeroScroll";
import { STORY_STAGES } from "../clientturn-story/stages";
import { STAGES } from "../hero/constants/stages";
import { ZONES, zoneProgress } from "./timeline";
import "./world.css";

const ClientTurnWorld = dynamic(() => import("./ClientTurnWorld"), { ssr: false });

function WorldCopy({ progress, index, staticMode = false, mobile = false }: { progress: MotionValue<number>; index: number; staticMode?: boolean; mobile?: boolean }) {
  const zone = ZONES[index];
  const opacity = useTransform(progress, p => {
    if (index === 0) return Math.max(0, 1 - Math.max(0, p - (mobile ? 0.055 : 0.115)) / (mobile ? 0.04 : 0.065));
    const local = zoneProgress(p, index);
    if (p < zone.at || p > zone.end) return 0;
    return Math.max(0, Math.min(1, local / 0.2, index === 6 ? 1 : (1 - local) / 0.22));
  });
  const y = useTransform(progress, p => (zoneProgress(p, index) - 0.5) * -45);
  const interactive = useTransform(opacity, value => value > 0.2 ? "auto" : "none");
  const inert = useTransform(opacity, value => value < 0.01 ? "hidden" : "visible");
  if (index === 0) return <motion.div className="world-hero-copy" style={staticMode ? undefined : { opacity, y, pointerEvents: interactive, visibility: inert }}>
    <h1>Turn leads<br />into booked<br /><span>paying clients.</span></h1>
    <p>Instant replies. Smart qualification.<br />More bookings. More revenue.</p>
    <CtaLink placement="hero_primary" size="lg">Start Converting <ArrowRight size={19} aria-hidden /></CtaLink>
    <small>14-day free trial <span>·</span> No card required</small>
  </motion.div>;
  const stage = STORY_STAGES[index - 1];
  return <motion.div className="world-copy" data-zone={index} data-side={index === 6 ? "center" : stage.side} style={staticMode ? undefined : { opacity, y, visibility: inert }}>
    <p className="world-eyebrow">{stage.title}</p>
    <h2>{stage.headline.split("\n").map(line => <span key={line}>{line}</span>)}</h2>
    <p className="world-sentence">{stage.description}</p>
  </motion.div>;
}

function StaticZone({ index, progress, mobile }: { index: number; progress: MotionValue<number>; mobile: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useInView(ref, { margin: "150px" });
  return <div ref={ref} className="world-static-zone" data-zone={index}>
    <WorldCopy index={index} progress={progress} staticMode mobile={mobile} />
    <div className="world-canvas" aria-hidden="true">{visible && <ClientTurnWorld progress={progress} mobile={mobile} visible={visible} staticZone={index} />}</div>
  </div>;
}

export function ClientTurnExperience() {
  const ref = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const mobile = useMediaQuery("(max-width: 899px), (max-aspect-ratio: 1/1)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const visible = useInView(viewport, { amount: 0.01 });
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 72px", "end end"], trackContentSize: true });
  /* Heavier and more overdamped than the default: the sweep should feel weighted, never springy. */
  const progress = useSpring(scrollYProgress, { stiffness: 55, damping: 25, mass: 0.95 });
  return <section ref={ref} className="clientturn-experience" data-reduced={reduced} aria-label="The ClientTurn conversion system" onPointerMove={event => {
    if (!mobile) { pointer.current.x = event.clientX / window.innerWidth * 2 - 1; pointer.current.y = event.clientY / window.innerHeight * 2 - 1; }
  }} onPointerLeave={() => { pointer.current.x = 0; pointer.current.y = 0; }}>
    {reduced ? ZONES.map((_, index) => <StaticZone key={index} index={index} progress={progress} mobile={mobile} />) : <div className="world-viewport" ref={viewport}>
      <div className="world-canvas" aria-hidden="true"><ClientTurnWorld progress={progress} mobile={mobile} visible={visible} pointer={pointer} /></div>
      {ZONES.map((_, index) => <WorldCopy key={index} index={index} progress={progress} mobile={mobile} />)}
    </div>}
    <span id="how-it-works" className="world-anchor" style={{ top: "21%" }} />
    <span id="results" className="world-anchor" style={{ top: "92%" }} />
    <div className="sr-only"><p>{STAGES.map(stage => stage.title).join(". ")}. Pipeline values shown are illustrative.</p>{STORY_STAGES.map(stage => <div key={stage.title}><h3>{stage.title}</h3><p>{stage.details.join(". ")}.</p></div>)}</div>
  </section>;
}
