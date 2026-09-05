import { PrecisionBox as RoundedBox } from "./PrecisionBox";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { MeshStandardMaterial } from "three";
import { activationAt, PALETTE } from "../constants/stages";
import { CheckMark, Halo, Lettering, NodeFrame, Pedestal, Profile, Shell, type NodeProps } from "./primitives";
import { useMaterials } from "./materials";

export function ClientWonNode(props: NodeProps) {
  const materials = useMaterials();
  const edge = useRef<MeshStandardMaterial>(null);
  useFrame(() => { if (edge.current) edge.current.emissiveIntensity = 0.22 + (props.reducedMotion ? 0.2 : activationAt(props.progress.get(), 4)) * 0.5; });
  return <NodeFrame index={4} {...props}>
    <Pedestal position={[0.28, -1.025, 0.05]} radius={1.65} scale={[1.32, 1, 0.7]} />
    <Halo position={[0, 0, -0.3]} scale={2} />
    <group rotation={[0.035, 0, -0.045]}>
      <RoundedBox args={[2.86, 1.68, 0.24]} radius={0.2} smoothness={4}>
        <meshStandardMaterial ref={edge} color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0.22} roughness={0.35} toneMapped={false} />
      </RoundedBox>
      <Shell width={2.78} height={1.6} depth={0.25} radius={0.17} position={[0, 0, 0.045]} />

      <mesh position={[-0.91, 0.12, 0.23]} scale={[0.8, 1.15, 0.4]} material={materials.inset}><sphereGeometry args={[0.43, 28, 20]} /></mesh>
      <Profile position={[-0.91, 0.17, 0.36]} scale={0.8} />
      <Lettering text="New Client" position={[0.23, 0.44, 0.23]} width={1.05} height={0.3} color={PALETTE.soft} size={46} />
      <Lettering text="£8,420" position={[0.15, 0.07, 0.23]} width={1.3} height={0.4} color={PALETTE.soft} size={70} />
      <Lettering text="Example pipeline" position={[0.18, -0.3, 0.23]} width={1.3} height={0.2} color={PALETTE.soft} size={43} />
      <mesh position={[1.08, 0.5, 0.24]} material={materials.light}><circleGeometry args={[0.15, 32]} /></mesh>
      <CheckMark position={[1.08, 0.5, 0.26]} scale={0.85} dark />
      {[0.18, 0.3, 0.43, 0.58].map((height, index) => <RoundedBox key={height} args={[0.075, height, 0.095]} radius={0.03} smoothness={2} position={[0.77 + index * 0.14, -0.59 + height / 2, 0.24]} material={materials.lime} />)}
    </group>
    <group position={[1.57, -0.59, 0.75]} rotation={[-0.5, 0, 0.2]}>
      <mesh rotation-x={Math.PI / 2}><cylinderGeometry args={[0.4, 0.4, 0.1, 64]} /><meshStandardMaterial color="#799b36" roughness={0.3} metalness={0.55} /></mesh>
      <mesh position-z={0.06} material={materials.light}><torusGeometry args={[0.35, 0.013, 8, 48]} /></mesh>
      <Lettering text="£" position={[0, 0, 0.061]} width={0.75} height={0.48} color={PALETTE.inset} align="center" size={88} />
    </group>
  </NodeFrame>;
}
