import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshStandardMaterial } from "three";
import { activationAt, PALETTE } from "../constants/stages";
import { Halo, NodeFrame, Pedestal, Profile, type NodeProps } from "./primitives";
import { useMaterials } from "./materials";

export function LeadNode(props: NodeProps) {
  const materials = useMaterials();
  const ring = useRef<MeshStandardMaterial>(null);
  useFrame(() => { if (ring.current) ring.current.emissiveIntensity = 0.65 + (props.reducedMotion ? 0 : activationAt(props.progress.get(), 0)) * 1.2; });
  return <NodeFrame index={0} {...props}>
    <Pedestal position={[0, -0.68, -0.04]} radius={1.12} scale={[1.1, 1, 0.8]} />
    <Pedestal position={[0, -0.48, 0]} radius={0.58} />
    <Halo position={[0, 0.02, -0.25]} scale={1.25} />
    <mesh position={[0, 0.05, 0]} material={materials.glass}><sphereGeometry args={[0.56, 40, 28]} /></mesh>
    <mesh position={[0, 0.05, 0.04]} material={materials.light}><torusGeometry args={[0.56, 0.015, 8, 48]} /></mesh>
    <Profile position={[0, 0.06, 0.08]} />
    <mesh position={[0, -0.35, 0]} rotation-x={Math.PI / 2}>
      <torusGeometry args={[0.57, 0.026, 10, 48]} />
      <meshStandardMaterial ref={ring} color={PALETTE.lime} emissive={PALETTE.lime} emissiveIntensity={0.65} toneMapped={false} />
    </mesh>
  </NodeFrame>;
}
