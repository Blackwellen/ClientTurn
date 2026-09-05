/* eslint-disable react-hooks/immutability -- Three.js GPU uniforms are intentionally mutated inside the render loop. */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, CatmullRomCurve3, Color, Mesh, PointLight, ShaderMaterial, TubeGeometry, Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { MASTER_POINTS, PORTS, ZONES, clamp } from "./timeline";
import { useMaterials } from "../hero/scene/materials";
import { TIERS, type Tier } from "./quality";

/**
 * The rail is five layers, not a line: a dark conduit sleeve, an emissive lime core that is only
 * revealed as far as the story has travelled, a travelling pulse, a light that illuminates whatever
 * the pulse is passing, and the bloom halo contributed by the post stack.
 */
const CORE_VERTEX = `varying vec2 railUv; varying vec3 railNormal; varying vec3 railView; varying float railDepth;
void main(){ railUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); railNormal = normalMatrix * normal; railView = -mv.xyz; railDepth = -mv.z; gl_Position = projectionMatrix * mv; }`;

/**
 * Aerial perspective for the rail alone. The strand is one continuous tube across the whole world,
 * so without this a transit segment belonging to another chapter can slice into frame as a bright
 * edge band. Fading to the background colour removes it with no hard cut and no transparency sort.
 */
const RAIL_FADE = "float railFade = 1.0 - smoothstep(15.0, 27.0, railDepth);";

/** Base stays inside display range so the core reads brand lime; only the pulse core is allowed to clip to white. */
const CORE_FRAGMENT = `varying vec2 railUv; varying vec3 railNormal; varying vec3 railView; varying float railDepth;
uniform float reveal; uniform float pulse; uniform float pulseWidth; uniform vec3 lime; uniform vec3 hot;
void main(){
  if (railUv.x > reveal) discard;
  ${RAIL_FADE}
  float facing = abs(dot(normalize(railNormal), normalize(railView)));
  float rim = 0.42 + 0.58 * pow(facing, 0.6);
  float travel = exp(-pow((railUv.x - pulse) / pulseWidth, 2.0));
  float trail = exp(-pow((railUv.x - pulse + pulseWidth * 2.4) / (pulseWidth * 5.0), 2.0)) * 0.32;
  float tip = smoothstep(reveal - 0.0016, reveal, railUv.x) * 0.5;
  vec3 colour = mix(lime * rim, hot, clamp(travel + tip, 0.0, 1.0));
  gl_FragColor = vec4((colour + lime * trail) * railFade, 1.0);
  #include <colorspace_fragment>
}`;

/** Wide soft falloff around the conduit, so the cable sits in its own light rather than beside it. */
const HALO_FRAGMENT = `varying vec2 railUv; varying vec3 railNormal; varying vec3 railView; varying float railDepth;
uniform float reveal; uniform float pulse; uniform vec3 lime;
void main(){
  if (railUv.x > reveal) discard;
  ${RAIL_FADE}
  float facing = abs(dot(normalize(railNormal), normalize(railView)));
  float falloff = pow(1.0 - facing, 2.6);
  float travel = exp(-pow((railUv.x - pulse) / 0.006, 2.0));
  gl_FragColor = vec4(lime, falloff * (0.14 + travel * 0.5) * railFade);
}`;

const HERO_OPENING_REVEAL = 0.115;

export function MasterRail({ progress, staticMode = false, tier }: { progress: MotionValue<number>; staticMode?: boolean; tier: Tier }) {
  const materials = useMaterials();
  const head = useRef<Mesh>(null);
  const tail = useRef<Mesh>(null);
  const headLight = useRef<PointLight>(null);
  const clock = useRef(0);
  const segments = TIERS[tier].railSegments;
  const steps = TIERS[tier].curveSteps;
  const resources = useMemo(() => {
    const curve = new CatmullRomCurve3(MASTER_POINTS.map(point => new Vector3(...point)), false, "centripetal", 0.5);
    /* The dark conduit is the resting state and stays thinner than the energised core, so a powered
       run reads as a fat lime cable swallowing the sleeve rather than a thread hidden inside it. */
    const sleeve = new TubeGeometry(curve, steps, 0.055, segments, false);
    const core = new TubeGeometry(curve, steps, 0.079, Math.max(6, segments - 4), false);
    const halo = new TubeGeometry(curve, Math.round(steps * 0.6), 0.27, Math.max(6, segments - 6), false);
    const material = new ShaderMaterial({
      toneMapped: false,
      uniforms: {
        reveal: { value: 0.015 }, pulse: { value: 0 }, pulseWidth: { value: 0.0026 },
        lime: { value: new Color("#B7F34A").multiplyScalar(0.98) },
        hot: { value: new Color("#EEFFC4").multiplyScalar(2.4) },
      },
      vertexShader: CORE_VERTEX, fragmentShader: CORE_FRAGMENT,
    });
    /* Rail arc-length position of each zone's arrival port, so the reveal lands on connectors, not mid-air. */
    const sample = new Vector3();
    const markers = [{ at: 0, rail: 0.01 }];
    ZONES.forEach((zone, index) => {
      const target = new Vector3(...PORTS[index].arrive);
      let best = Infinity, rail = 0;
      for (let i = 0; i <= 2400; i++) { curve.getPointAt(i / 2400, sample); const distance = sample.distanceToSquared(target); if (distance < best) { best = distance; rail = i / 2400; } }
      markers.push({ at: zone.at + (zone.end - zone.at) * (index === 0 ? 0.72 : 0.5), rail: Math.max(markers[markers.length - 1].rail + 0.004, rail) });
    });
    markers.push({ at: 1, rail: 1 });
    const haloMaterial = new ShaderMaterial({
      toneMapped: false, transparent: true, depthWrite: false, blending: AdditiveBlending,
      uniforms: { reveal: material.uniforms.reveal, pulse: material.uniforms.pulse, lime: { value: new Color("#B7F34A") } },
      vertexShader: CORE_VERTEX, fragmentShader: HALO_FRAGMENT,
    });
    return { curve, sleeve, core, halo, material, haloMaterial, markers };
  }, [segments, steps]);
  useEffect(() => () => { resources.sleeve.dispose(); resources.core.dispose(); resources.halo.dispose(); resources.material.dispose(); resources.haloMaterial.dispose(); }, [resources]);
  useFrame((_, delta) => {
    if (!staticMode) clock.current += Math.min(delta, 0.05);

    const p = progress.get();
    const i = Math.max(0, resources.markers.findIndex(marker => marker.at >= p) - 1);
    const a = resources.markers[i], b = resources.markers[Math.min(i + 1, resources.markers.length - 1)];
    const t = clamp((p - a.at) / Math.max(0.001, b.at - a.at));
    const scrolled = a.rail + (b.rail - a.rail) * (t * t * (3 - 2 * t));
    /* On load the rail energises through the opening stages by itself, so the hero shows a system
       already running. Scroll overtakes it as soon as it passes this point. */
    const opening = Math.min(HERO_OPENING_REVEAL, Math.max(0, (clock.current - 0.5) * 0.075));
    const reveal = staticMode ? 1 : Math.max(scrolled, opening);
    resources.material.uniforms.reveal.value = reveal;
    const pulse = Math.max(0, reveal - 0.004 - (1 - Math.abs(Math.sin(clock.current * 0.55))) * 0.006);
    resources.material.uniforms.pulse.value = pulse;
    if (head.current) {
      resources.curve.getPointAt(clamp(reveal - 0.0008), head.current.position);
      head.current.visible = !staticMode && reveal > 0.02 && reveal < 0.995;
      head.current.scale.setScalar(0.85 + Math.sin(clock.current * 2.1) * 0.12);
    }
    if (tail.current) resources.curve.getPointAt(0, tail.current.position);
    if (headLight.current) {
      resources.curve.getPointAt(clamp(pulse), headLight.current.position);
      headLight.current.intensity = staticMode ? 0 : 5.5;
    }
  });
  return <group>
    <mesh geometry={resources.sleeve} material={materials.conduit} castShadow={false} receiveShadow />
    <mesh geometry={resources.core} material={resources.material} />
    <mesh geometry={resources.halo} material={resources.haloMaterial} renderOrder={2} />
    <mesh ref={head}><sphereGeometry args={[0.088, 24, 16]} /><meshBasicMaterial color={[1.4, 2.1, 0.55]} toneMapped={false} /></mesh>
    <mesh ref={tail} material={materials.conduit}><sphereGeometry args={[0.058, 16, 12]} /></mesh>
    <pointLight ref={headLight} color="#B7F34A" intensity={0} distance={3.4} decay={2} />
  </group>;
}
