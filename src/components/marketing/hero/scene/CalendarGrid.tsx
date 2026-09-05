import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, Group, SRGBColorSpace } from "three";
import type { MotionValue } from "motion/react";
import { PrecisionBox } from "./PrecisionBox";
import { Lettering } from "./primitives";
import { useMaterials } from "./materials";
import type { Point3 } from "../constants/stages";

/** High-resolution vector-drawn type, with a genuinely raised selected date. */
export function CalendarGrid({ position = [0, 0, 0], width = 1.65, height = 1.3, progress, start = 0.4, staticMode = false }: { position?: Point3; width?: number; height?: number; progress?: MotionValue<number>; start?: number; staticMode?: boolean }) {
  const materials = useMaterials();
  const selected = useRef<Group>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas"); canvas.width = 1400; canvas.height = 1000;
    const ctx = canvas.getContext("2d")!;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "500 46px Arial, sans-serif"; ctx.fillStyle = "#8895a8";
    ["M", "T", "W", "T", "F", "S", "S"].forEach((day, i) => ctx.fillText(day, 100 + i * 200, 90));
    ctx.font = "500 58px Arial, sans-serif";
    for (let i = 0; i < 28; i++) {
      if (i === 17) continue;
      ctx.fillStyle = i % 7 > 4 ? "#737e8e" : "#c4ccd8";
      ctx.fillText(String(i + 1).padStart(2, "0"), 100 + i % 7 * 200, 290 + Math.floor(i / 7) * 200);
    }
    const map = new CanvasTexture(canvas); map.colorSpace = SRGBColorSpace; map.anisotropy = 4;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame(() => {
    if (!selected.current) return;
    const p = staticMode || !progress ? 1 : Math.max(0, Math.min(1, (progress.get() - start) * 7));
    selected.current.position.z = 0.015 + p * 0.065;
  });
  return <group position={position}>
    <mesh><planeGeometry args={[width, height]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} /></mesh>
    <group ref={selected} position={[0, -height * 0.19, 0.015]}>
      <PrecisionBox args={[width * 0.115, height * 0.15, 0.055]} radius={0.035} material={materials.lime} castShadow />
      <Lettering text="18" position={[0, 0, 0.03]} width={width * 0.09} height={height * 0.13} color="#0b1020" align="center" />
    </group>
  </group>;
}
