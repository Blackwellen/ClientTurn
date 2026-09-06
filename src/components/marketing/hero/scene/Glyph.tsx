import { useEffect, useMemo } from "react";
import { ExtrudeGeometry, Shape } from "three";
import { useMaterials } from "./materials";
import type { Point3 } from "../constants/stages";

/**
 * Product glyphs, built as real extruded geometry rather than icon textures, so they hold up when
 * the camera comes close and pick up the same key light and env reflections as everything else.
 * Each shape is authored in a 1x1 box centred on the origin and scaled by the caller.
 */
export type GlyphName =
  | "envelope" | "send" | "clock" | "message" | "reply"
  | "globe" | "wallet" | "list" | "person" | "cross" | "calendar";

function rounded(shape: Shape, x: number, y: number, w: number, h: number, r: number) {
  shape.moveTo(x - w / 2 + r, y - h / 2);
  shape.lineTo(x + w / 2 - r, y - h / 2);
  shape.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h / 2 + r);
  shape.lineTo(x + w / 2, y + h / 2 - r);
  shape.quadraticCurveTo(x + w / 2, y + h / 2, x + w / 2 - r, y + h / 2);
  shape.lineTo(x - w / 2 + r, y + h / 2);
  shape.quadraticCurveTo(x - w / 2, y + h / 2, x - w / 2, y + h / 2 - r);
  shape.lineTo(x - w / 2, y - h / 2 + r);
  shape.quadraticCurveTo(x - w / 2, y - h / 2, x - w / 2 + r, y - h / 2);
  return shape;
}

function buildShapes(name: GlyphName): Shape[] {
  switch (name) {
    case "send": {
      const s = new Shape();
      s.moveTo(-0.46, 0.44); s.lineTo(0.48, 0); s.lineTo(-0.46, -0.44);
      s.lineTo(-0.32, -0.06); s.lineTo(0.14, 0); s.lineTo(-0.32, 0.06);
      return [s];
    }
    case "cross": {
      const bar = (angle: number) => {
        const s = new Shape();
        const c = Math.cos(angle), n = Math.sin(angle);
        const hw = 0.085, hl = 0.44;
        const pts: [number, number][] = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]];
        pts.forEach(([px, py], i) => {
          const x = px * c - py * n, y = px * n + py * c;
          if (i === 0) s.moveTo(x, y);
          else s.lineTo(x, y);
        });
        return s;
      };
      return [bar(Math.PI / 4), bar(-Math.PI / 4)];
    }
    case "list": {
      const rows = [0.28, 0, -0.28].flatMap((y) => [
        rounded(new Shape(), -0.34, y, 0.16, 0.16, 0.05),
        rounded(new Shape(), 0.12, y, 0.56, 0.13, 0.065),
      ]);
      return rows;
    }
    case "wallet": {
      const body = rounded(new Shape(), 0, 0, 0.92, 0.66, 0.14);
      const clasp = new Shape();
      clasp.absarc(0.24, -0.02, 0.11, 0, Math.PI * 2, false);
      body.holes.push(clasp);
      return [body];
    }
    case "globe": {
      const outer = new Shape();
      outer.absarc(0, 0, 0.47, 0, Math.PI * 2, false);
      const inner = new Shape();
      inner.absarc(0, 0, 0.37, 0, Math.PI * 2, true);
      outer.holes.push(inner);
      const meridian = new Shape();
      meridian.absellipse(0, 0, 0.2, 0.44, 0, Math.PI * 2, false);
      const meridianHole = new Shape();
      meridianHole.absellipse(0, 0, 0.12, 0.36, 0, Math.PI * 2, true);
      meridian.holes.push(meridianHole);
      const equator = rounded(new Shape(), 0, 0, 0.9, 0.08, 0.04);
      return [outer, meridian, equator];
    }
    case "envelope": {
      const body = rounded(new Shape(), 0, 0, 0.94, 0.66, 0.12);
      const inner = rounded(new Shape(), 0, 0, 0.74, 0.46, 0.07);
      body.holes.push(inner);
      const flap = new Shape();
      flap.moveTo(-0.37, 0.19); flap.lineTo(0, -0.08); flap.lineTo(0.37, 0.19);
      flap.lineTo(0.37, 0.05); flap.lineTo(0, -0.22); flap.lineTo(-0.37, 0.05);
      return [body, flap];
    }
    case "reply": {
      const head = new Shape();
      head.moveTo(-0.48, 0.06); head.lineTo(-0.12, 0.34); head.lineTo(-0.12, -0.22);
      const tail = new Shape();
      tail.moveTo(-0.16, -0.06); tail.lineTo(0.16, -0.06);
      tail.quadraticCurveTo(0.42, -0.06, 0.42, -0.34);
      tail.lineTo(0.42, -0.44); tail.lineTo(0.26, -0.44); tail.lineTo(0.26, -0.32);
      tail.quadraticCurveTo(0.26, -0.2, 0.14, -0.2);
      tail.lineTo(-0.16, -0.2);
      return [head, tail];
    }
    case "calendar": {
      const body = rounded(new Shape(), 0, -0.04, 0.9, 0.78, 0.11);
      const inner = rounded(new Shape(), 0, -0.12, 0.7, 0.5, 0.05);
      body.holes.push(inner);
      return [body, rounded(new Shape(), -0.24, 0.42, 0.1, 0.24, 0.05), rounded(new Shape(), 0.24, 0.42, 0.1, 0.24, 0.05)];
    }
    case "message": {
      const body = rounded(new Shape(), 0, 0.06, 0.92, 0.62, 0.16);
      const tail = new Shape();
      tail.moveTo(-0.26, -0.2); tail.lineTo(-0.06, -0.2); tail.lineTo(-0.2, -0.46);
      return [body, tail];
    }
    case "person": {
      const head = new Shape();
      head.absarc(0, 0.22, 0.21, 0, Math.PI * 2, false);
      const shoulders = new Shape();
      shoulders.absellipse(0, -0.34, 0.38, 0.26, 0, Math.PI, false);
      return [head, shoulders];
    }
    case "clock":
    default: {
      const outer = new Shape();
      outer.absarc(0, 0, 0.47, 0, Math.PI * 2, false);
      const inner = new Shape();
      inner.absarc(0, 0, 0.37, 0, Math.PI * 2, true);
      outer.holes.push(inner);
      return [outer, rounded(new Shape(), 0, 0.11, 0.09, 0.32, 0.04), rounded(new Shape(), 0.11, 0, 0.28, 0.09, 0.04)];
    }
  }
}

export function Glyph({
  name, position = [0, 0, 0], scale = 1, tone = "white",
}: { name: GlyphName; position?: Point3; scale?: number; tone?: "white" | "lime" | "muted" | "amber" | "danger" }) {
  const materials = useMaterials();
  const geometry = useMemo(() => {
    const g = new ExtrudeGeometry(buildShapes(name), { depth: 0.09, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.016, bevelSegments: 2, curveSegments: 14 });
    g.center();
    return g;
  }, [name]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const material = tone === "lime" ? materials.lime : tone === "muted" ? materials.muted
    : tone === "amber" ? materials.amber : tone === "danger" ? materials.danger : materials.white;
  return <mesh geometry={geometry} position={position} scale={scale} material={material} castShadow />;
}
