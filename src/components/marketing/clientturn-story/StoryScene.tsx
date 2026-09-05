"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Group, Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { SceneMaterials } from "../hero/scene/materials";
import { SceneLights } from "../hero/scene/SceneLights";
import { ConversionRail } from "../hero/scene/ConversionRail";
import { DemandUpdates, SceneBoundary } from "../hero/scene/ConversionScene";
import { SpeedToLead, FollowUp, Qualification, Booking, Reactivation, Control } from "./Chapters";
import { STORY_STAGES, clamp } from "./stages";
import type { Point3 } from "../hero/constants/stages";

const CHAPTERS = [SpeedToLead, FollowUp, Qualification, Booking, Reactivation, Control];
const ROUTES: Point3[][] = [
  [[-3.8, 5, -0.7], [-3.8, 1.1, -0.7], [-2.5, 0, -0.5], [-0.5, -0.1, -0.5], [1.6, -0.9, -0.5], [3.3, -2, -0.6], [1.7, -5, -0.7]],
  [[-1.8, 3.5, -0.7], [-2.3, 1.6, -0.5], [-2, 0.8, -0.5], [-2.25, 0, -0.5], [0.5, 0, -0.5], [2.1, 0.35, -0.5], [3.5, -1.5, -0.6], [1.5, -5, -0.8]],
  [[-3, 3, -0.7], [-3.5, 1, -0.6], [-2.8, 0, -0.6], [0, 0, -0.6], [1.5, 0.5, -0.6], [2.75, 1.05, -0.5], [4, -1, -0.7], [2.4, -5, -0.8]],
  [[-2.5, 3, -0.7], [-2.2, 0, -0.6], [-0.7, 0.4, -0.6], [0.6, 0.65, -0.6], [2.8, 0.5, -0.5], [4, -1.5, -0.7], [1, -5, -0.8]],
  [[-3.5, 3, -0.7], [-3.5, -0.8, -0.6], [-1, -1, -0.6], [1.4, -0.5, -0.6], [3, -0.2, -0.6], [3.9, -1.5, -0.7], [0.5, -5, -0.8]],
  [[-3, 3.5, -0.7], [-4, 0, -0.5], [-3, -1.9, 0.2], [0, -2.4, 0.4], [3.5, -1.6, 0], [4, 0, -0.5], [1, 1.7, -0.7], [0, -0.85, 0.3]],
];
const POINTS: Point3[] = ROUTES.flatMap((route, index) => route.map(([x, y, z]) => [x, y - index * 12, z] as Point3));
type Props = { progress: MotionValue<number>; mobile: boolean; visible: boolean; staticIndex?: number };

function World({ progress, mobile, staticIndex }: Props) {
  const chapters = useRef<Group>(null);
  const vectors = useMemo(() => ({ target: new Vector3(), position: new Vector3() }), []);
  useFrame(({ camera, size }) => {
    const raw = staticIndex ?? Math.min(5, progress.get() * 6);
    const chapter = Math.floor(raw);
    const transition = staticIndex !== undefined ? 0 : clamp((raw - chapter - 0.76) / 0.24);
    const eased = transition * transition * (3 - 2 * transition);
    const next = Math.min(chapter + 1, 5);
    const targetY = -(chapter + (next - chapter) * eased) * 12;
    const width = size.width / size.height;
    const distance = mobile ? Math.max(18, 9 / (width * 0.62)) : Math.max(18, 15 / (width * 0.62));
    const side = STORY_STAGES[chapter].side === "right" ? 1 : -1;
    const nextSide = STORY_STAGES[next].side === "right" ? 1 : -1;
    const offset = mobile ? 0 : (side + (nextSide - side) * eased) * distance * 0.62 * width * 0.2;
    vectors.target.set(offset, targetY - 0.1, 0);
    vectors.position.set(offset + 1.4, targetY + 3.5, distance);
    camera.position.copy(vectors.position);
    camera.lookAt(vectors.target);
    chapters.current?.children.forEach((group, i) => { group.visible = staticIndex !== undefined ? i === staticIndex : Math.abs(i - chapter) <= 1; });
  });
  return <SceneMaterials>
    <DemandUpdates progress={progress} />
    <SceneLights progress={progress} />
    <group ref={chapters}>{CHAPTERS.map((Chapter, index) => <group key={index} position={[0, -index * 12, 0]} rotation={[0, -0.12, 0]}><pointLight position={[1, 0, 3]} intensity={2} distance={7} color="#b7f34a" /><Chapter index={index} progress={progress} staticMode={staticIndex !== undefined} /></group>)}</group>
    <ConversionRail points={POINTS} progress={progress} reducedMotion={staticIndex !== undefined} segments={800} />
  </SceneMaterials>;
}

export default function StoryScene(props: Props) {
  const fallback = <div className="story-unavailable">Follow every enquiry, from first reply to next step.</div>;
  return <SceneBoundary fallback={fallback}><Canvas dpr={props.mobile ? 1.25 : 1.5} camera={{ position: [0, 2, 20], fov: 34, near: 0.1, far: 100 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }} frameloop={props.visible && props.staticIndex === undefined ? "always" : "demand"} fallback={fallback}>
    <Suspense fallback={null}><World {...props} />{!props.mobile && <EffectComposer multisampling={4}><Bloom luminanceThreshold={1.35} intensity={0.2} mipmapBlur /></EffectComposer>}</Suspense>
  </Canvas></SceneBoundary>;
}
