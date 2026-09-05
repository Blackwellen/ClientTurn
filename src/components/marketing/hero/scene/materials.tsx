import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { AdditiveBlending, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Material } from "three";
import { PALETTE } from "../constants/stages";

/** Grazing-angle edge lift. Physical-render polish without a second pass. */
function fresnel(material: MeshPhysicalMaterial | MeshStandardMaterial, strength: number, tint = "#7d93b4") {
  const color = new Color(tint);
  material.onBeforeCompile = shader => {
    shader.uniforms.ctRimStrength = { value: strength };
    shader.uniforms.ctRimColor = { value: color };
    shader.vertexShader = `varying vec3 ctViewDir; varying vec3 ctNormal;\n${shader.vertexShader}`
      .replace("#include <fog_vertex>", "#include <fog_vertex>\n  ctViewDir = normalize(-mvPosition.xyz);\n  ctNormal = normalize(normalMatrix * objectNormal);");
    shader.fragmentShader = `uniform float ctRimStrength; uniform vec3 ctRimColor; varying vec3 ctViewDir; varying vec3 ctNormal;\n${shader.fragmentShader}`
      .replace("#include <dithering_fragment>", "  float ctRim = pow(1.0 - clamp(dot(normalize(ctNormal), normalize(ctViewDir)), 0.0, 1.0), 3.4);\n  gl_FragColor.rgb += ctRimColor * ctRim * ctRimStrength;\n#include <dithering_fragment>");
  };
  material.customProgramCacheKey = () => `ct-rim-${strength}-${tint}`;
  return material;
}

/** Physically based token set. One vocabulary for every object in the world. */
function createMaterials() {
  return {
    shell: fresnel(new MeshPhysicalMaterial({ color: "#0B1220", roughness: 0.27, metalness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.2, envMapIntensity: 1.5 }), 0.62),
    inset: new MeshStandardMaterial({ color: "#0E1624", roughness: 0.46, metalness: 0.12, envMapIntensity: 0.7 }),
    edge: fresnel(new MeshStandardMaterial({ color: "#192435", roughness: 0.22, metalness: 0.42, envMapIntensity: 1.6 }), 0.34, "#9fb4d4"),
    metal: new MeshStandardMaterial({ color: "#5d6d80", roughness: 0.19, metalness: 0.85, envMapIntensity: 2 }),
    lime: new MeshStandardMaterial({ color: PALETTE.lime, roughness: 0.34, metalness: 0.16, emissive: "#9FE839", emissiveIntensity: 0.28, envMapIntensity: 0.8 }),
    white: new MeshStandardMaterial({ color: "#e6ecf4", roughness: 0.3, metalness: 0.14, envMapIntensity: 1.1 }),
    light: new MeshBasicMaterial({ color: PALETTE.soft, toneMapped: false }),
    muted: new MeshStandardMaterial({ color: "#66748a", roughness: 0.5, metalness: 0.25, envMapIntensity: 0.9 }),
    glass: new MeshPhysicalMaterial({ color: "#9fb2ad", transparent: true, opacity: 0.24, transmission: 0.2, thickness: 0.22, ior: 1.32, roughness: 0.1, metalness: 0.04, clearcoat: 1, side: DoubleSide, depthWrite: false, envMapIntensity: 1.4 }),
    conduit: fresnel(new MeshPhysicalMaterial({ color: "#080D14", roughness: 0.34, metalness: 0.42, clearcoat: 0.4, clearcoatRoughness: 0.28, envMapIntensity: 1.25 }), 0.42, "#6f8bb0"),
    amber: new MeshStandardMaterial({ color: "#E9B44C", roughness: 0.36, metalness: 0.16, emissive: "#C98F2E", emissiveIntensity: 0.3, envMapIntensity: 0.8 }),
    danger: new MeshStandardMaterial({ color: "#D9636A", roughness: 0.36, metalness: 0.16, emissive: "#B34049", emissiveIntensity: 0.28, envMapIntensity: 0.8 }),
    glow: new MeshBasicMaterial({ color: PALETTE.lime, transparent: true, opacity: 0.07, depthWrite: false, blending: AdditiveBlending, toneMapped: false }),
  };
}
const MaterialContext = createContext<ReturnType<typeof createMaterials> | null>(null);
export function SceneMaterials({ children }: { children: ReactNode }) {
  const materials = useMemo(() => createMaterials(), []);
  useEffect(() => () => Object.values(materials).forEach((material: Material) => material.dispose()), [materials]);
  return <MaterialContext.Provider value={materials}>{children}</MaterialContext.Provider>;
}
export function useMaterials() {
  const materials = useContext(MaterialContext);
  if (!materials) throw new Error("SceneMaterials provider is required");
  return materials;
}
