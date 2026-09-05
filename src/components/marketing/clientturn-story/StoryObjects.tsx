/* eslint-disable react-hooks/immutability -- Three.js buffers are intentionally mutated inside the render loop. */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, CatmullRomCurve3, Group, MeshStandardMaterial, Points, TubeGeometry, Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { CalendarGrid } from "../hero/scene/CalendarGrid";
import { PrecisionBox } from "../hero/scene/PrecisionBox";
import { Lettering, CheckMark, Profile, Shell } from "../hero/scene/primitives";
import { useMaterials } from "../hero/scene/materials";
import { PALETTE, type Point3 } from "../hero/constants/stages";
import { localProgress, clamp } from "./stages";
import { seeded } from "../world/noise";

export type ChapterProps = { progress: MotionValue<number>; index: number; staticMode?: boolean };

export function Card({ title, position = [0, 0, 0], width = 2.1, height = 0.9, active = false, icon = "message", children, subtitle, color = PALETTE.lime, edge }: { title: string; position?: Point3; width?: number; height?: number; active?: boolean; icon?: "message" | "profile" | "clock" | "none"; children?: ReactNode; subtitle?: string; color?: string; edge?: string }) {
  const materials = useMaterials();
  return <group position={position}>
    <PrecisionBox args={[width, height, 0.46]} radius={0.14} material={materials.shell} castShadow receiveShadow />
    <PrecisionBox args={[width - 0.06, height - 0.06, 0.13]} radius={0.12} position-z={-0.28} material={materials.inset} castShadow />
    <PrecisionBox args={[width - 0.03, height - 0.03, 0.055]} radius={0.135} position-z={0.225}>
      <meshStandardMaterial color={active ? color : edge ?? "#3d4857"} emissive={active ? color : edge ?? "#000000"} emissiveIntensity={active ? 0.55 : edge ? 0.22 : 0} roughness={0.33} metalness={0.35} />
    </PrecisionBox>
    <PrecisionBox args={[width - 0.08, height - 0.08, 0.06]} radius={0.11} position-z={0.25} material={materials.inset} receiveShadow />
    {icon === "profile" && <Profile position={[-width / 2 + 0.3, 0, 0.35]} scale={0.42} />}
    {icon === "clock" && <group position={[-width / 2 + 0.3, 0, 0.35]}><mesh material={materials.white}><torusGeometry args={[0.13, 0.017, 12, 40]} /></mesh><mesh position-y={0.03} material={materials.white}><boxGeometry args={[0.015, 0.09, 0.025]} /></mesh><mesh position-x={0.03} material={materials.white}><boxGeometry args={[0.065, 0.015, 0.025]} /></mesh></group>}
    {icon === "message" && <group position={[-width / 2 + 0.3, 0, 0.34]}><PrecisionBox args={[0.3, 0.23, 0.07]} radius={0.07} material={materials.white} /><mesh position={[0.065, -0.105, 0]} rotation-z={0.4} material={materials.white}><boxGeometry args={[0.045, 0.085, 0.05]} /></mesh>{[-0.075,0,0.075].map(x => <mesh key={x} position={[x,0,0.04]} material={materials.shell}><sphereGeometry args={[0.018,12,8]} /></mesh>)}</group>}
    <Lettering text={title} position={[icon === "none" ? 0 : 0.2, (children || subtitle) ? height / 2 - 0.28 : 0.035, 0.31]} width={width - (icon === "none" ? 0.32 : 0.78)} height={0.24} color={active ? PALETTE.soft : PALETTE.white} />
    {subtitle && <Lettering text={subtitle} position={[icon === "none" ? 0 : 0.2, -height / 2 + 0.23, 0.31]} width={width - (icon === "none" ? 0.32 : 0.78)} height={0.15} color="#8f9aa9" />}
    {height > 0.7 && [-1, 1].map(side => <mesh key={side} position={[side * (width / 2 + 0.012), 0, -0.09]} rotation-y={Math.PI / 2} material={materials.edge}><torusGeometry args={[0.066, 0.018, 10, 24]} /></mesh>)}
    {height > 0.7 && <mesh position={[0, -height / 2 + 0.1, 0.29]} material={materials.edge}><boxGeometry args={[width * 0.72, 0.008, 0.012]} /></mesh>}
    <group position-z={0.18}>{children}</group>
  </group>;
}

/** A local connection between two ports. `dim` keeps a real product route visible without implying it carries the lead. */
export function Branch({ points, active = true, color = PALETTE.lime, dim = false, offset = -0.65 }: { points: Point3[]; active?: boolean; color?: string; dim?: boolean; offset?: number }) {
  const key = JSON.stringify(points);
  const geometry = useMemo(() => {
    const values: Point3[] = JSON.parse(key);
    return new TubeGeometry(new CatmullRomCurve3(values.map(p => new Vector3(...p))), 72, active ? 0.032 : 0.021, 10, false);
  }, [key, active]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const lit = active || dim;
  return <mesh geometry={geometry} position-z={offset}><meshStandardMaterial color={lit ? color : "#2b333d"} emissive={lit ? color : "#000000"} emissiveIntensity={active ? 1.15 : dim ? 0.3 : 0} roughness={0.38} metalness={0.3} /></mesh>;
}

export function Reveal({ children, position = [0, 0, 0], start = 0.2, end = 0.6, ...props }: ChapterProps & { children: ReactNode; position?: Point3; start?: number; end?: number }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    if (!ref.current) return;
    const t = props.staticMode ? 1 : clamp((localProgress(props.progress.get(), props.index) - start) / (end - start));
    const smooth = t * t * (3 - 2 * t);
    ref.current.position.set(position[0], position[1] - (1 - smooth) * 0.32, position[2] + (1 - smooth) * 1.3);
    ref.current.rotation.y = (1 - smooth) * -0.35;
    ref.current.rotation.x = (1 - smooth) * 0.16;
    ref.current.rotation.z = (1 - smooth) * position[0] * 0.025;
  });
  return <group ref={ref} position={position}>{children}</group>;
}

export function Transfer({ children, path, start, end, ...props }: ChapterProps & { children: ReactNode; path: Point3[]; start: number; end: number }) {
  const ref = useRef<Group>(null);
  const pathKey = JSON.stringify(path);
  const curve = useMemo(() => new CatmullRomCurve3((JSON.parse(pathKey) as Point3[]).map(p => new Vector3(...p))), [pathKey]);
  useFrame(() => {
    if (!ref.current) return;
    const t = props.staticMode ? 1 : clamp((localProgress(props.progress.get(), props.index) - start) / (end - start));
    const eased = t * t * (3 - 2 * t);
    curve.getPoint(eased, ref.current.position);
    ref.current.rotation.y = -0.48 * (1 - eased);
    ref.current.rotation.z = 0.06 * Math.sin(eased * Math.PI);
  });
  return <group ref={ref}>{children}</group>;
}

export function Status({ position, start, ...props }: ChapterProps & { position: Point3; start: number }) {
  const ref = useRef<MeshStandardMaterial>(null);
  useFrame(() => { if (ref.current) ref.current.emissiveIntensity = props.staticMode ? 0.8 : clamp((localProgress(props.progress.get(), props.index) - start) * 12); });
  return <group position={[position[0], position[1], position[2] + 0.2]}><mesh><torusGeometry args={[0.105, 0.015, 8, 24]} /><meshStandardMaterial ref={ref} color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0} /></mesh><CheckMark scale={0.5} /></group>;
}

export function Calendar({ position = [0, 0, 0], ...props }: ChapterProps & { position?: Point3 }) {
  const materials = useMaterials();
  return <Reveal {...props} position={position}><Shell width={2.15} height={2.35} depth={0.46} /><Shell width={1.95} height={1.8} depth={0.08} position={[0, -0.14, 0.26]} inset />
    <Lettering text="BOOKING" position={[0.1, 0.85, 0.31]} width={1.4} height={0.23} />
    {[-0.55, 0.55].map(x => <mesh key={x} position={[x, 1.19, 0.12]} rotation-y={Math.PI / 2} material={materials.lime}><torusGeometry args={[0.18, 0.04, 16, 48]} /></mesh>)}
    <CalendarGrid position={[0, -0.1, 0.32]} width={1.76} height={1.54} progress={props.progress} start={(props.index + 0.4) / 6} staticMode={props.staticMode} />
    <Status {...props} position={[0.65, -0.72, 0.15]} start={0.45} />
  </Reveal>;
}

export function MiniRows({ count = 3 }: { count?: number }) {
  const materials = useMaterials();
  return <group>{Array.from({ length: count }, (_, i) => <group key={i} position={[0, 0.23 - i * 0.28, 0.15]}><mesh position-x={-0.58} material={materials.muted}><circleGeometry args={[0.05, 16]} /></mesh><mesh position-x={-0.06} material={materials.edge}><boxGeometry args={[0.65, 0.035, 0.01]} /></mesh><mesh position-x={0.55} material={materials.lime}><circleGeometry args={[0.025, 16]} /></mesh></group>)}</group>;
}

/**
 * Eligibility sweep. A band of drifting motes crosses the archive so the scan reads as work being
 * done across every stored enquiry, rather than a line sliding over static cards.
 */
export function ScanField({ width = 7, depth = 2.4, count = 220, ...props }: ChapterProps & { width?: number; depth?: number; count?: number }) {
  const points = useRef<Points>(null);
  const { geometry, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const values = new Float32Array(count * 3);
    const random = seeded(count * 104729);
    for (let i = 0; i < count; i++) {
      values[i * 3] = (random() - 0.5) * width;
      values[i * 3 + 1] = random();
      values[i * 3 + 2] = random() * Math.PI * 2;
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(positions, 3));
    return { geometry: result, seeds: values };
  }, [count, width]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame(({ clock }) => {
    if (!points.current) return;
    const p = props.staticMode ? 0.8 : localProgress(props.progress.get(), props.index);
    const head = -depth / 2 + p * depth * 1.35;
    const time = clock.elapsedTime;
    const array = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      const spread = seeds[i * 3 + 1];
      array[i * 3] = seeds[i * 3] + Math.sin(time * 0.6 + seeds[i * 3 + 2]) * 0.09;
      array[i * 3 + 1] = -0.86 + spread * spread * 0.55 + Math.sin(time * 1.1 + seeds[i * 3 + 2]) * 0.05;
      array[i * 3 + 2] = head - spread * 0.5;
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} frustumCulled={false}>
    <pointsMaterial size={0.05} sizeAttenuation color={PALETTE.lime} transparent opacity={0.85} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
  </points>;
}
