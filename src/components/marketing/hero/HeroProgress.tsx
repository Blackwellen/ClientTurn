"use client";

import { motion, type MotionValue } from "motion/react";
import { STAGES } from "./constants/stages";

export function HeroProgress({ progress, activeStage }: { progress: MotionValue<number>; activeStage: number }) {
  return (
    <nav className="conversion-progress" aria-label="Conversion journey stages">
      <div className="conversion-progress-track" aria-hidden="true"><motion.span style={{ scaleY: progress }} /></div>
      <ol>{STAGES.map((stage, index) => (
        <li key={stage.title} aria-current={index === activeStage ? "step" : undefined} data-active={index === activeStage}>
          <span className="conversion-progress-dot" aria-hidden="true" />
          <span className="conversion-progress-number">0{index + 1}</span>
          <span>{stage.title}</span>
        </li>
      ))}</ol>
    </nav>
  );
}
