import { Environment, Lightformer } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { PointLight } from "three";
import type { MotionValue } from "motion/react";
import { PALETTE } from "../constants/stages";

export function SceneLights({ progress }: { progress: MotionValue<number> }) {
  const accent = useRef<PointLight>(null);
  useFrame(() => { if (accent.current) accent.current.position.y = 3.5 - progress.get() * 7.8; });
  return <>
    <ambientLight intensity={0.3} />
    <directionalLight position={[-3, 6, 7]} intensity={2.4} color="#ecf1ff" />
    <directionalLight position={[4, 1, 3]} intensity={0.7} color="#c5cddb" />
    <pointLight ref={accent} position={[0, 3.5, 2]} intensity={3} distance={5} color={PALETTE.lime} decay={2} />
    <Environment resolution={128} frames={1}>
      <Lightformer intensity={2.5} position={[-4, 3, 5]} scale={[3, 10, 1]} />
      <Lightformer intensity={1.4} position={[4, 2, 1]} rotation-y={-Math.PI / 2} scale={[2, 8, 1]} />
      <Lightformer intensity={0.4} color={PALETTE.soft} position={[0, -5, 2]} scale={[8, 2, 1]} />
    </Environment>
  </>;
}
