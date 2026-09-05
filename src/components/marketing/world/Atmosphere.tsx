/* eslint-disable react-hooks/immutability -- Three.js buffers and uniforms are intentionally mutated inside the render loop. */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, Vector3 } from "three";
import { TIERS, type Tier } from "./quality";
import { seeded } from "./noise";

/**
 * Restrained depth cues only: a sparse drift of dust that keeps pace with the camera focus,
 * so travelling through black space still reads as travelling. No stars, smoke or sci-fi fog.
 */
export function Atmosphere({ focus, tier, animate }: { focus: RefObject<Vector3>; tier: Tier; animate: boolean }) {
  const points = useRef<Points>(null);
  const clock = useRef(0);
  const count = TIERS[tier].particles;
  const { geometry, seeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const values = new Float32Array(count * 4);
    const random = seeded(count * 7919);
    for (let i = 0; i < count; i++) {
      values[i * 4] = (random() - 0.5) * 26;
      values[i * 4 + 1] = (random() - 0.5) * 18;
      values[i * 4 + 2] = (random() - 0.5) * 16 - 2;
      values[i * 4 + 3] = random() * Math.PI * 2;
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new BufferAttribute(positions, 3));
    return { geometry: result, seeds: values };
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, delta) => {
    if (!points.current) return;
    if (animate) clock.current += Math.min(delta, 0.05);
    const array = geometry.attributes.position.array as Float32Array;
    const f = focus.current;
    for (let i = 0; i < count; i++) {
      const phase = seeds[i * 4 + 3];
      array[i * 3] = f.x + seeds[i * 4] + Math.sin(clock.current * 0.11 + phase) * 0.9;
      array[i * 3 + 1] = f.y + seeds[i * 4 + 1] + Math.cos(clock.current * 0.08 + phase) * 0.7;
      array[i * 3 + 2] = f.z + seeds[i * 4 + 2];
    }
    geometry.attributes.position.needsUpdate = true;
  });
  return <points ref={points} geometry={geometry} frustumCulled={false}>
    <pointsMaterial size={0.035} sizeAttenuation color="#8ea3c0" transparent opacity={0.4} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
  </points>;
}
