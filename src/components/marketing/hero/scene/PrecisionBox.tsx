import { useEffect, useMemo } from "react";
import type { ThreeElements } from "@react-three/fiber";
import { ExtrudeGeometry, Shape } from "three";
import { toCreasedNormals } from "three-stdlib";

/** Rounded face corners and shallow edge bevels are independent dimensions. */
export function PrecisionBox({ args, radius = 0.12, smoothness = 12, children, ...props }: Omit<ThreeElements["mesh"], "args"> & { args: [number, number, number]; radius?: number; smoothness?: number }) {
  const [width, height, depth] = args;
  const geometry = useMemo(() => {
    const bevel = Math.min(0.048, depth * 0.19);
    const w = width / 2 - bevel, h = height / 2 - bevel;
    const r = Math.min(radius, w, h);
    const shape = new Shape();
    shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h);
    shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h);
    shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r);
    shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const result = new ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: smoothness });
    result.center();
    return toCreasedNormals(result, 0.7);
  }, [width, height, depth, radius, smoothness]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh {...props} geometry={geometry}>{children}</mesh>;
}
