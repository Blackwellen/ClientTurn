"use client";

import { AnimatePresence, motion, useTransform, type MotionValue } from "motion/react";
import { ArrowRight } from "lucide-react";
import { CtaLink } from "../cta";
import { STAGES } from "./constants/stages";

export function HeroCopy({ progress, activeStage, reducedMotion }: { progress: MotionValue<number>; activeStage: number; reducedMotion: boolean }) {
  const y = useTransform(progress, [0, 0.16, 0.4, 1], [0, 0, -12, -12]);
  const opacity = useTransform(progress, [0, 0.16, 0.4, 1], [1, 1, 0.82, 0.82]);
  return (
    <div className="conversion-copy">
      <motion.div style={{ y: reducedMotion ? 0 : y }}>
        <motion.h1 style={{ opacity: reducedMotion ? 1 : opacity }}>Turn leads<br />into booked<br /><span>paying clients.</span></motion.h1>
        <p className="conversion-description">Instant replies. Smart qualification.<br />More bookings. More revenue.</p>
        <motion.div className="conversion-cta" whileHover={reducedMotion ? undefined : { y: -2 }} whileTap={reducedMotion ? undefined : { scale: 0.98 }}>
          <CtaLink placement="hero_primary" size="lg">Start Converting <ArrowRight size={19} aria-hidden /></CtaLink>
        </motion.div>
        <p className="conversion-trial">14-day free trial <span>·</span> No card required</p>
      </motion.div>
      <div className="conversion-narrative" aria-live="polite" aria-atomic="true">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={activeStage} initial={reducedMotion ? false : { opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: reducedMotion ? 0 : 0.2 }}>
            <span>{activeStage < 0 ? "EVERY ENQUIRY HAS POTENTIAL" : `0${activeStage + 1} / ${STAGES[activeStage].title.toUpperCase()}`}</span>
            <p>{activeStage < 0 ? "From the first reply to the won job. One connected journey, built around your business." : STAGES[activeStage].description}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
