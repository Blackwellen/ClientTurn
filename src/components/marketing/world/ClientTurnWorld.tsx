"use client";

import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, Noise, SMAA, Vignette } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { ACESFilmicToneMapping, BackSide, Group, Object3D, PointLight, SpotLight, Vector3 } from "three";
import { useTransform, type MotionValue } from "motion/react";
import { SceneMaterials } from "../hero/scene/materials";
import { LeadNode } from "../hero/scene/LeadNode";
import { MessageNode } from "../hero/scene/MessageNode";
import { QualificationNode } from "../hero/scene/QualificationNode";
import { BookingNode } from "../hero/scene/BookingNode";
import { ClientWonNode } from "../hero/scene/ClientWonNode";
import { SpeedToLead, FollowUp, Qualification, Booking, Reactivation, Control } from "../clientturn-story/Chapters";
import { WorldCamera } from "./WorldCamera";
import { MasterRail } from "./MasterRail";
import { Atmosphere } from "./Atmosphere";
import { ZONES, zoneProgress, WORLD_BLACK } from "./timeline";
import { detectTier, TIERS, type Tier } from "./quality";

const CHAPTERS = [SpeedToLead, FollowUp, Qualification, Booking, Reactivation, Control];
type Props = { progress: MotionValue<number>; visible: boolean; mobile: boolean; staticZone?: number; pointer?: RefObject<{ x: number; y: number }> };

function Fallback() { return <div className="world-fallback"><strong>From first enquiry to the next step.</strong><span>Reply. Follow up. Qualify. Book. Reconnect.</span></div>; }
class WorldBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <Fallback /> : this.props.children; }
}

function Zone({ index, ...props }: Props & { index: number }) {
  const ref = useRef<Group>(null);
  const zone = ZONES[index];
  const local = useTransform(props.progress, p => zoneProgress(p, index));
  const chapterValue = useTransform(local, p => ((index - 1) + p) / 6);
  const clock = useRef(0);
  useFrame((_, delta) => {
    if (!ref.current) return;
    const p = props.progress.get();
    ref.current.visible = props.staticZone === undefined ? p >= zone.at - 0.13 && p <= zone.end + 0.13 : props.staticZone === index;
    if (props.staticZone === undefined && props.visible) clock.current += Math.min(delta, 0.05);
    const breathing = props.staticZone === undefined ? Math.sin(clock.current * 0.35 + index) * 0.008 : 0;
    ref.current.rotation.y = zone.rotation + breathing;
  });
  const Chapter = CHAPTERS[index - 1];
  const nodeProps = { progress: local, reducedMotion: props.staticZone !== undefined, animate: props.visible && props.staticZone === undefined };
  return <group ref={ref} position={zone.center} rotation-y={zone.rotation} scale={zone.scale}>
    {index === 0 ? <><LeadNode {...nodeProps} /><MessageNode {...nodeProps} /><QualificationNode {...nodeProps} /><BookingNode {...nodeProps} /><ClientWonNode {...nodeProps} /></> : <Chapter progress={chapterValue} index={index - 1} staticMode={props.staticZone !== undefined} />}
  </group>;
}

/** Neutral dark studio: glossy edge response and controlled highlights, never a visible backdrop. */
function StudioEnvironment({ tier }: { tier: Tier }) {
  return <Environment frames={1} resolution={tier === "mobile" ? 256 : 512}>
    <mesh scale={100}><sphereGeometry args={[1, 24, 16]} /><meshBasicMaterial color="#05070d" side={BackSide} /></mesh>
    <Lightformer form="rect" intensity={3.6} position={[-6, 4, 6]} scale={[5, 14, 1]} target={[0, 0, 0]} />
    <Lightformer form="rect" intensity={1.5} position={[7, 2, 4]} rotation-y={-Math.PI / 3} scale={[2.4, 11, 1]} target={[0, 0, 0]} />
    <Lightformer form="rect" intensity={0.9} position={[0, 7, -6]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} />
    <Lightformer form="ring" intensity={1.2} position={[-3, -4, 5]} scale={4} target={[0, 0, 0]} />
    <Lightformer form="rect" intensity={0.3} color="#B7F34A" position={[1, -5, 3]} rotation-x={0.5} scale={[9, 1.5, 1]} />
  </Environment>;
}

/** Key, fill, rim and a lime practical, all travelling with the camera's focus point. */
function StudioLights({ focus, tier }: { focus: RefObject<Vector3>; tier: Tier }) {
  const key = useRef<SpotLight>(null);
  const target = useRef<Object3D>(null);
  const rim = useRef<SpotLight>(null);
  const fill = useRef<PointLight>(null);
  const practical = useRef<PointLight>(null);
  useFrame(() => {
    const f = focus.current;
    if (!key.current || !target.current) return;
    target.current.position.copy(f);
    key.current.position.set(f.x - 5.5, f.y + 8.5, f.z + 9.5);
    key.current.target = target.current;
    if (rim.current) { rim.current.position.set(f.x + 7.5, f.y + 3.5, f.z - 1.5); rim.current.target = target.current; }
    fill.current?.position.set(f.x + 3, f.y - 2.5, f.z + 7);
    practical.current?.position.set(f.x - 1, f.y - 1, f.z + 2.5);
  });
  return <>
    <ambientLight intensity={0.14} />
    <object3D ref={target} />
    <spotLight ref={key} color="#fff6ea" intensity={300} distance={58} angle={0.62} penumbra={1} castShadow={TIERS[tier].shadows} shadow-mapSize={tier === "high" ? 2048 : 1024} shadow-radius={4} shadow-bias={-0.0002} shadow-normalBias={0.03} />
    <spotLight ref={rim} color="#cfe0f2" intensity={190} distance={42} angle={0.8} penumbra={1} />
    <pointLight ref={fill} color="#8ea6c4" intensity={18} distance={26} decay={2} />
    <pointLight ref={practical} color="#b7f34a" intensity={7} distance={9} decay={2} />
  </>;
}

function Post({ tier, mobile }: { tier: Tier; mobile: boolean }) {
  const settings = TIERS[tier];
  return <EffectComposer multisampling={settings.multisampling} enableNormalPass={settings.ao}>
    {settings.ao ? <N8AO aoRadius={1.15} distanceFalloff={0.9} intensity={2.1} quality={tier === "high" ? "medium" : "low"} halfRes={tier !== "high"} color="#01030a" /> : <></>}
    <Bloom luminanceThreshold={1.02} luminanceSmoothing={0.28} intensity={mobile ? 0.5 : 0.72} radius={0.72} mipmapBlur />
    <Vignette offset={0.28} darkness={0.62} blendFunction={BlendFunction.NORMAL} />
    {settings.grain ? <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.035} /> : <></>}
    {tier === "high" ? <SMAA /> : <></>}
  </EffectComposer>;
}

function World({ tier, ...props }: Props & { tier: Tier }) {
  const focus = useRef(new Vector3());
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => props.progress.on("change", () => { if (props.visible) invalidate(); }), [props.progress, props.visible, invalidate]);
  return <SceneMaterials>
    <WorldCamera {...props} focus={focus} />
    <StudioEnvironment tier={tier} />
    <StudioLights focus={focus} tier={tier} />
    {ZONES.map((_, index) => <Zone key={index} {...props} index={index} />)}
    <MasterRail progress={props.progress} staticMode={props.staticZone !== undefined} tier={tier} />
    <Atmosphere focus={focus} tier={tier} animate={props.visible && props.staticZone === undefined} />
    <fogExp2 attach="fog" args={[WORLD_BLACK, 0.0085]} />
    <Post tier={tier} mobile={props.mobile} />
  </SceneMaterials>;
}

function ContextLifecycle({ onLost }: { onLost: (lost: boolean) => void }) {
  const gl = useThree(state => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); onLost(true); };
    const restored = () => onLost(false);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    return () => { canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored); };
  }, [gl, onLost]);
  return null;
}

export default function ClientTurnWorld(props: Props) {
  const [lost, setLost] = useState(false);
  const tier = useMemo(() => detectTier(props.mobile), [props.mobile]);
  const range = TIERS[tier].dpr;
  const [dpr, setDpr] = useState<number>(range[1]);
  return <WorldBoundary>{lost && <Fallback />}<Canvas dpr={dpr} shadows={TIERS[tier].shadows ? "percentage" : false} camera={{ fov: 38, near: 0.15, far: 150, position: [0, 4, 20] }} frameloop={props.visible && props.staticZone === undefined && !lost ? "always" : "demand"} gl={{ alpha: true, antialias: false, powerPreference: "high-performance", toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.08 }} fallback={<Fallback />}>
    <ContextLifecycle onLost={setLost} />
    <PerformanceMonitor bounds={() => [48, 58]} onDecline={() => setDpr(range[0])} onIncline={() => setDpr(range[1])} flipflops={3} onFallback={() => setDpr(range[0])} />
    <Suspense fallback={null}><World {...props} tier={tier} /></Suspense>
  </Canvas></WorldBoundary>;
}
