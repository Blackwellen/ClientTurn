import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, Points } from "three";
import { PALETTE } from "../constants/stages";

export function SceneParticles({ mobile, animate }: { mobile: boolean; animate: boolean }) {
  const points = useRef<Points>(null);
  const time = useRef(0);
  const positions = useMemo(() => {
    const count = mobile ? 16 : 38;
    return new Float32Array(Array.from({ length: count * 3 }, (_, i) => {
      const value = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      return (value - Math.floor(value) - 0.5) * (i % 3 === 1 ? 11 : 7);
    }));
  }, [mobile]);
  useFrame((_, delta) => {
    if (!animate || !points.current) return;
    time.current += Math.min(delta, 0.05);
    points.current.rotation.y = Math.sin(time.current * 0.08) * 0.06;
    points.current.position.y = Math.sin(time.current * 0.2) * 0.06;
  });
  return <points ref={points}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial color={PALETTE.soft} size={0.025} transparent opacity={0.55} sizeAttenuation blending={AdditiveBlending} depthWrite={false} /></points>;
}
