"use client";

import { Component, Suspense, useEffect, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { MotionValue } from "motion/react";
import { HeroFallback } from "../HeroFallback";
import { HeroStageLabel } from "../HeroStageLabels";
import { STAGES } from "../constants/stages";
import { SceneMaterials } from "./materials";
import { SceneCamera } from "./SceneCamera";
import { SceneLights } from "./SceneLights";
import { SceneParticles } from "./SceneParticles";
import { ConversionRail } from "./ConversionRail";
import { LeadNode } from "./LeadNode";
import { MessageNode } from "./MessageNode";
import { QualificationNode } from "./QualificationNode";
import { BookingNode } from "./BookingNode";
import { ClientWonNode } from "./ClientWonNode";

export type ConversionSceneProps = { progress: MotionValue<number>; reducedMotion: boolean; mobile: boolean; visible: boolean; paused: boolean };

export class SceneBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? (this.props.fallback ?? <HeroFallback />) : this.props.children; }
}

export function DemandUpdates({ progress }: { progress: MotionValue<number> }) {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => progress.on("change", () => invalidate()), [progress, invalidate]);
  return null;
}

function World(props: ConversionSceneProps) {
  const animate = props.visible && !props.paused && !props.reducedMotion;
  const nodeProps = { progress: props.progress, reducedMotion: props.reducedMotion, animate };
  return <SceneMaterials>
    <DemandUpdates progress={props.progress} />
    <SceneCamera {...props} />
    <SceneLights progress={props.progress} />
    <LeadNode {...nodeProps} /><MessageNode {...nodeProps} /><QualificationNode {...nodeProps} /><BookingNode {...nodeProps} /><ClientWonNode {...nodeProps} />
    <ConversionRail progress={props.progress} reducedMotion={props.reducedMotion} />
    <SceneParticles mobile={props.mobile} animate={animate} />
    {!props.mobile && STAGES.map((stage, index) => <HeroStageLabel key={stage.title} index={index} progress={props.progress} />)}
    {!props.mobile && <EffectComposer multisampling={4} resolutionScale={1}><Bloom luminanceThreshold={1.25} intensity={0.22} mipmapBlur /></EffectComposer>}
  </SceneMaterials>;
}

export default function ConversionScene(props: ConversionSceneProps) {
  const [lost, setLost] = useState(false);
  return <SceneBoundary>
    <div className="conversion-webgl" data-context-lost={lost}>
      {lost && <HeroFallback />}
      <Canvas dpr={props.mobile ? 1.25 : 1.5} camera={{ position: [3.4, 3, 20.5], fov: 34, near: 0.1, far: 70 }} frameloop={props.visible && !props.paused && !props.reducedMotion && !lost ? "always" : "demand"} gl={{ alpha: true, antialias: true, powerPreference: "high-performance", outputColorSpace: SRGBColorSpace, toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1 }} fallback={<HeroFallback />}>
        <CanvasLifecycle onLost={setLost} />
        <Suspense fallback={null}><World {...props} /></Suspense>
      </Canvas>
    </div>
  </SceneBoundary>;
}

function CanvasLifecycle({ onLost }: { onLost: (lost: boolean) => void }) {
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const canvas = gl.domElement;
    const lost = (event: Event) => { event.preventDefault(); onLost(true); };
    const restored = () => onLost(false);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    canvas.setAttribute("data-conversion-canvas", "true");
    return () => { canvas.removeEventListener("webglcontextlost", lost); canvas.removeEventListener("webglcontextrestored", restored); };
  }, [gl, onLost]);
  return null;
}
