import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CatmullRomCurve3, Mesh, TubeGeometry, Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { PALETTE, type Point3 } from "../constants/stages";

export const HERO_RAIL_POINTS: Point3[] = [
  [-0.95,3.4,0], [-0.5,3.0,0.1], [0.8,2.75,-0.1], [1.3,2.05,-0.15],
  [2.35,1.7,0], [2.45,1.1,0], [1.2,0.65,0.1], [-1.45,0.3,0],
  [-1.65,-0.45,0.15], [-1.1,-1,0.5], [0.3,-1.35,0.2], [0.55,-2.1,-0.1],
  [1.7,-2.55,0], [1.9,-3.15,0.1], [0.9,-3.7,0.2], [-0.45,-4.15,0.4],
];

/** Indexed tube draw ranges reveal existing GPU geometry, without rebuilding it. */
export function ConversionRail({ progress, reducedMotion, points = HERO_RAIL_POINTS, segments = 240 }: { progress: MotionValue<number>; reducedMotion: boolean; points?: Point3[]; segments?: number }) {
  const energy = useRef<Mesh>(null);
  const { curve, base, active, glow } = useMemo(() => {
    const curve = new CatmullRomCurve3(points.map((point) => new Vector3(...point)));
    return { curve, base: new TubeGeometry(curve, segments, 0.021, 12, false), active: new TubeGeometry(curve, segments, 0.028, 12, false), glow: new TubeGeometry(curve, segments, 0.065, 12, false) };
  }, [points, segments]);
  useEffect(() => () => { base.dispose(); active.dispose(); glow.dispose(); }, [base, active, glow]);
  useFrame(() => {
    const reveal = reducedMotion ? 0.9 : Math.min(1, 0.10 + progress.get() * 0.90);
    const count = Math.floor(segments * reveal) * 12 * 6;
    active.setDrawRange(0, count);
    glow.setDrawRange(0, count);
    if (energy.current) curve.getPointAt(reveal, energy.current.position);
  });
  return <group>
    <mesh geometry={base}><meshStandardMaterial color="#273125" roughness={0.38} metalness={0.35} emissive={PALETTE.lime} emissiveIntensity={0.025} /></mesh>
    <mesh geometry={active}><meshBasicMaterial color={[1.5, 2, 0.43]} toneMapped={false} /></mesh>
    <mesh geometry={glow}><meshBasicMaterial color={PALETTE.lime} transparent opacity={0.11} depthWrite={false} toneMapped={false} /></mesh>
    <mesh ref={energy}><sphereGeometry args={[0.062, 12, 8]} /><meshBasicMaterial color={[1.8, 2.3, 0.6]} toneMapped={false} /></mesh>
  </group>;
}
