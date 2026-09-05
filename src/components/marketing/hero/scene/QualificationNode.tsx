import { PrecisionBox as RoundedBox } from "./PrecisionBox";
import { Lettering, NodeFrame, Pedestal, Shell, StatusLight, type NodeProps } from "./primitives";
import { useMaterials } from "./materials";

export function QualificationNode(props: NodeProps) {
  const materials = useMaterials();
  return <NodeFrame index={2} {...props}>
    <Pedestal position={[0, -1.175, -0.05]} radius={1.55} scale={[1.23, 1, 0.64]} />
    <group rotation={[0.025, -0.06, -0.035]}>
      <RoundedBox args={[2.26, 2.03, 0.32]} radius={0.17} smoothness={4} material={materials.edge} position={[0, 0, -0.09]} />
      <Shell width={2.23} height={2} depth={0.32} radius={0.16} />
      {["Budget", "Authority", "Need", "Timeline"].map((text, index) => {
        const y = 0.69 - index * 0.46;
        return <group key={text} position={[0, y, 0.2]}>
          <Shell width={2.03} height={0.41} depth={0.16} radius={0.095} />
          <Lettering text={text} position={[-0.2, 0, 0.095]} width={1.33} height={0.33} size={48} />
          <StatusLight position={[0.76, 0, 0.13]} progress={props.progress} start={0.49 + index * 0.019} reducedMotion={props.reducedMotion} size={0.11} />
        </group>;
      })}
    </group>
  </NodeFrame>;
}
