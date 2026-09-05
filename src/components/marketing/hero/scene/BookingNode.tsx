import { CalendarGrid } from "./CalendarGrid";
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, MeshBasicMaterial } from "three";
import { NodeFrame, Shell, type NodeProps } from "./primitives";
import { useMaterials } from "./materials";
import { PALETTE, smoothRange } from "../constants/stages";

export function BookingNode(props: NodeProps) {
  const materials = useMaterials();
  const ring = useRef<Mesh>(null);
  const ringMaterial = useRef<MeshBasicMaterial>(null);
  useFrame(() => {
    const t = props.reducedMotion ? 0 : smoothRange(props.progress.get(), 0.65, 0.76);
    ring.current?.scale.setScalar(0.8 + t * 0.6);
    if (ringMaterial.current) ringMaterial.current.opacity = Math.sin(t * Math.PI) * 0.2;
  });
  return <NodeFrame index={3} {...props}>
    <group rotation={[-0.12, -0.05, -0.13]}>
      <Shell width={1.68} height={1.75} depth={0.31} radius={0.17} />
      <Shell width={1.43} height={1.22} depth={0.075} radius={0.1} position={[0, -0.13, 0.18]} inset />
      {[-0.43, 0.43].map((x) => <mesh key={x} position={[x, 0.9, 0.09]} rotation-y={Math.PI / 2} material={materials.lime}><torusGeometry args={[0.19, 0.045, 16, 48, Math.PI * 1.7]} /></mesh>)}
      <CalendarGrid position={[0, -0.13, 0.235]} width={1.29} height={1.06} progress={props.progress} start={0.64} staticMode={props.reducedMotion} />
      <mesh ref={ring} position={[0, -0.1, 0.25]}><ringGeometry args={[0.94, 0.96, 64]} /><meshBasicMaterial ref={ringMaterial} color={PALETTE.lime} transparent opacity={0} depthWrite={false} /></mesh>
    </group>
  </NodeFrame>;
}
