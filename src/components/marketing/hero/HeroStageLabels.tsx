import { Html } from "@react-three/drei";
import { motion, useTransform, type MotionValue } from "motion/react";
import { STAGES } from "./constants/stages";

export function HeroStageLabel({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const stage = STAGES[index];
  const opacity = useTransform(progress, (p) => p < 0.14 || Math.abs(p - (stage.start + 0.06)) < 0.15 ? 1 : 0.45);
  return <Html position={stage.label} zIndexRange={[5, 0]} style={{ pointerEvents: "none" }}>
    <motion.div className="conversion-spatial-label" style={{ opacity }} aria-hidden="true"><span>{index + 1}</span><div>{stage.title}{index === 4 && <small>£8,420 Pipeline</small>}</div></motion.div>
  </Html>;
}
