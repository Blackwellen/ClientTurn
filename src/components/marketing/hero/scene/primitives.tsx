import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { PrecisionBox as RoundedBox } from "./PrecisionBox";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, Color, Group, MeshBasicMaterial, SRGBColorSpace, Vector2 } from "three";
import type { MotionValue } from "motion/react";
import { activationAt, PALETTE, STAGES, type Point3 } from "../constants/stages";
import { useMaterials } from "./materials";

export type NodeProps = { progress: MotionValue<number>; reducedMotion: boolean; animate: boolean };

/**
 * The hero has to arrive already running. Scroll activation is zero at the top of the page, so
 * without this the first stages sit inert until the visitor scrolls. This ramps the opening beats
 * in on mount and is then overtaken by the real scroll value via max().
 */
const INTRO_DELAY = 0.35;
const INTRO_RUN = 1.15;
export function introFloor(elapsed: number, order: number) {
  const t = (elapsed - INTRO_DELAY - order * 0.42) / INTRO_RUN;
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function NodeFrame({ index, progress, reducedMotion, animate, children }: NodeProps & { index: number; children: ReactNode }) {
  const ref = useRef<Group>(null);
  const time = useRef(0);
  const intro = useRef(0);
  const position = STAGES[index].position;
  useFrame((_, delta) => {
    if (!ref.current) return;
    const step = Math.min(delta, 0.05);
    if (animate) time.current += step;
    intro.current += step;
    /* The opening two stages wake on their own so the hero is alive before the first scroll. */
    const opening = index <= 1 && !reducedMotion ? introFloor(intro.current, index) : 0;
    const activation = reducedMotion ? 0 : Math.max(activationAt(progress.get(), index), opening);
    const float = reducedMotion ? 0 : Math.sin(time.current * 0.65 + index) * 0.025;
    ref.current.position.y = position[1] + activation * 0.24 + float;
    ref.current.position.z = position[2] + activation * 0.22;
    ref.current.rotation.x = -0.035 + activation * 0.09;
    ref.current.rotation.y = -0.22 + activation * 0.36 + (reducedMotion ? 0 : Math.sin(time.current * 0.4 + index) * 0.014);
  });
  return <group ref={ref} position={position} scale={[1.05, 1.15, 1.3, 1.35, 1.45][index]}>{children}</group>;
}

export function Shell({ width, height, depth = 0.25, radius = 0.12, position = [0, 0, 0], inset = false }: { width: number; height: number; depth?: number; radius?: number; position?: Point3; inset?: boolean }) {
  const materials = useMaterials();
  return <RoundedBox args={[width, height, depth]} radius={radius} smoothness={4} position={position} material={inset ? materials.inset : materials.shell} castShadow receiveShadow />;
}

/** Procedural face lettering, not a screenshot or imported scene asset. */
export function Lettering({ text, position, width = 1, height = 0.25, color = PALETTE.white, align = "left", size = 44 }: { text: string; position: Point3; width?: number; height?: number; color?: string; align?: CanvasTextAlign; size?: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = `500 ${size * 3}px Arial, sans-serif`;
      canvas.width = Math.ceil(context.measureText(text).width) + 16;
      canvas.height = Math.ceil(size * 4.5);
      context.font = `500 ${size * 3}px Arial, sans-serif`;
      context.fillStyle = color;
      context.textAlign = align;
      context.textBaseline = "middle";
      context.fillText(text, align === "center" ? canvas.width / 2 : 8, canvas.height / 2);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [text, color, align, size]);
  useEffect(() => () => texture.dispose(), [texture]);
  const fittedWidth = Math.min(width, height * texture.image.width / texture.image.height);
  const fittedHeight = fittedWidth * texture.image.height / texture.image.width;
  return <mesh position={[position[0] + (align === "left" ? (fittedWidth - width) / 2 : 0), position[1], position[2]]}><planeGeometry args={[fittedWidth, fittedHeight]} /><meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} /></mesh>;
}

export function CheckMark({ position = [0, 0, 0], scale = 1, dark = false }: { position?: Point3; scale?: number; dark?: boolean }) {
  const materials = useMaterials();
  return <group position={position} scale={scale}>
    <mesh position={[-0.045, -0.005, 0]} rotation-z={0.75} material={dark ? materials.inset : materials.light}><boxGeometry args={[0.045, 0.13, 0.025]} /></mesh>
    <mesh position={[0.042, 0.03, 0]} rotation-z={-0.7} material={dark ? materials.inset : materials.light}><boxGeometry args={[0.045, 0.22, 0.025]} /></mesh>
  </group>;
}

export function StatusLight({ position, progress, start, reducedMotion, size = 0.13 }: { position: Point3; progress: MotionValue<number>; start: number; reducedMotion: boolean; size?: number }) {
  const ref = useRef<MeshBasicMaterial>(null);
  const intro = useRef(0);
  const dark = useMemo(() => new Color("#42602d"), []);
  const bright = useMemo(() => new Color(PALETTE.lime).multiplyScalar(1.7), []);
  useFrame((_, delta) => {
    intro.current += Math.min(delta, 0.05);
    /* Lights belonging to the opening beats confirm on load rather than waiting for scroll. */
    const opening = start < 0.35 && !reducedMotion ? introFloor(intro.current, 1) : 0;
    const scrolled = Math.max(0, Math.min(1, (progress.get() - start) / 0.025));
    const activation = reducedMotion ? 0.7 : Math.max(scrolled, opening);
    ref.current?.color.copy(dark).lerp(bright, activation);
  });
  return <group position={position}>
    <mesh><torusGeometry args={[size, 0.019, 8, 32]} /><meshBasicMaterial ref={ref} color={PALETTE.lime} toneMapped={false} /></mesh>
    <CheckMark scale={size * 4.5} />
  </group>;
}

export function Pedestal({ position = [0, -0.8, 0], radius = 1.1, scale = [1, 1, 1] }: { position?: Point3; radius?: number; scale?: Point3 }) {
  const materials = useMaterials();
  const profile = useMemo(() => [new Vector2(0, -0.12), new Vector2(radius - 0.055, -0.12), new Vector2(radius - 0.018, -0.1), new Vector2(radius, -0.06), new Vector2(radius, 0.06), new Vector2(radius - 0.018, 0.1), new Vector2(radius - 0.055, 0.12), new Vector2(0, 0.12)], [radius]);
  return <group position={position} scale={scale} rotation-x={0.22}>
    <mesh material={materials.shell} castShadow receiveShadow><latheGeometry args={[profile, 96]} /></mesh>
    <mesh position-y={0.122} rotation-x={-Math.PI / 2} material={materials.edge}><ringGeometry args={[radius - 0.016, radius, 64]} /></mesh>
  </group>;
}

export function Profile({ position = [0, 0, 0], scale = 1 }: { position?: Point3; scale?: number }) {
  const materials = useMaterials();
  return <group position={position} scale={scale}>
    <mesh position={[0, 0.2, 0.02]} material={materials.lime}><sphereGeometry args={[0.18, 24, 16]} /></mesh>
    <mesh position={[0, -0.22, 0]} scale={[1, 0.85, 0.55]} material={materials.lime}><sphereGeometry args={[0.3, 24, 16]} /></mesh>
  </group>;
}

export function Halo({ position = [0, 0, 0], scale = 1 }: { position?: Point3; scale?: number }) {
  return <mesh position={position} scale={scale}>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial transparent depthWrite={false} uniforms={{ color: { value: new Color(PALETTE.lime) } }} vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}" fragmentShader="varying vec2 vUv; uniform vec3 color; void main(){float d=length(vUv-.5)*2.;float a=pow(max(0.,1.-d),3.)*.12;gl_FragColor=vec4(color,a);}" />
  </mesh>;
}

/** The control platform reads as a pool of contained light, not a lit surface, so the key light cannot blow it out. */
export function HubFloor({ position = [0, 0, 0], radius = 4.5 }: { position?: Point3; radius?: number }) {
  return <mesh position={position} rotation-x={-Math.PI / 2}>
    <circleGeometry args={[radius, 96]} />
    <shaderMaterial transparent depthWrite={false} toneMapped={false}
      uniforms={{ lime: { value: new Color(PALETTE.lime) }, ground: { value: new Color("#0A1220") } }}
      vertexShader="varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}"
      fragmentShader="varying vec2 vUv; uniform vec3 lime; uniform vec3 ground; void main(){float d=clamp(length(vUv-.5)*2.,0.,1.);float base=pow(1.-d,2.2)*.5;float pool=pow(max(0.,1.-d*1.9),3.5)*.16;gl_FragColor=vec4(ground*base+lime*pool,(base*.9+pool));}" />
  </mesh>;
}
