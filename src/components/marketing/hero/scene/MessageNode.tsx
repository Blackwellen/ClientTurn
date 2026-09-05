import { PrecisionBox as RoundedBox } from "./PrecisionBox";
import { NodeFrame, Shell, StatusLight, Lettering, type NodeProps } from "./primitives";
import { useMaterials } from "./materials";

export function MessageNode(props: NodeProps) {
  const materials = useMaterials();
  return <NodeFrame index={1} {...props}>
    <group rotation={[0.03, 0, -0.07]}>
      <RoundedBox args={[2.24, 1.19, 0.29]} radius={0.16} smoothness={4} material={materials.edge} position-z={-0.028} />
      <Shell width={2.2} height={1.15} depth={0.3} radius={0.15} />
      <Lettering text="First reply sent" position={[0.05,0.44,0.19]} width={1.7} height={0.17} />
      <Shell width={1.27} height={0.61} depth={0.07} position={[0.29, 0.06, 0.19]} inset />
      <RoundedBox args={[0.46, 0.43, 0.15]} radius={0.1} smoothness={4} material={materials.white} position={[-0.68, 0.13, 0.24]} />
      <mesh position={[-0.74, -0.1, 0.25]} rotation-z={-0.4} material={materials.white}><coneGeometry args={[0.09, 0.2, 3]} /></mesh>
      {[-0.79, -0.68, -0.57].map((x) => <mesh key={x} position={[x, 0.14, 0.325]} material={materials.inset}><sphereGeometry args={[0.028, 8, 8]} /></mesh>)}
      {[0.16, -0.04].map((y, index) => <RoundedBox key={y} args={[index ? 0.61 : 0.93, 0.055, 0.03]} radius={0.02} smoothness={2} position={[index ? 0.12 : 0.28, y, 0.25]} material={materials.muted} />)}
      <StatusLight position={[0.83, -0.35, 0.2]} progress={props.progress} start={0.34} reducedMotion={props.reducedMotion} />
    </group>
  </NodeFrame>;
}
