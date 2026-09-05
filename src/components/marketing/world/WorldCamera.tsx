import { useMemo, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { CAMERA_POSES, MOBILE_POSES, ZONES, clamp } from "./timeline";

type Frame = { at: number; position: Vector3; target: Vector3; focus: Vector3 };

/** Time-aware cubic interpolation keeps velocity continuous through chapter joins. */
function interpolate(frames: Frame[], p: number, key: "position" | "target" | "focus", output: Vector3, tangentA: Vector3, tangentB: Vector3) {
  let i = frames.findIndex(frame => frame.at > p) - 1;
  if (i < 0) i = p >= 1 ? frames.length - 2 : 0;
  const a = frames[i], b = frames[i + 1];
  const previous = frames[Math.max(0, i - 1)], next = frames[Math.min(frames.length - 1, i + 2)];
  const interval = b.at - a.at;
  const t = clamp((p - a.at) / interval), t2 = t * t, t3 = t2 * t;
  tangentA.copy(b[key]).sub(previous[key]).multiplyScalar(interval / (b.at - previous.at));
  tangentB.copy(next[key]).sub(a[key]).multiplyScalar(interval / (next.at - a.at));
  output.copy(a[key]).multiplyScalar(2 * t3 - 3 * t2 + 1).addScaledVector(tangentA, t3 - 2 * t2 + t).addScaledVector(b[key], -2 * t3 + 3 * t2).addScaledVector(tangentB, t3 - t2);
}

const HALF_ANGLE = Math.tan(19 * Math.PI / 180);

export function WorldCamera({ progress, mobile, staticZone, focus, pointer }: { progress: MotionValue<number>; mobile: boolean; staticZone?: number; focus: RefObject<Vector3>; pointer?: RefObject<{ x: number; y: number }> }) {
  const size = useThree(state => state.size);
  const frames = useMemo<Frame[]>(() => {
    const aspect = size.width / size.height;
    if (mobile) {
      /* Portrait: the subject is framed low so the copy above it stays clear, and the camera pans to it. */
      return MOBILE_POSES.map(pose => {
        const centre = new Vector3(...ZONES[pose.zone].center).add(new Vector3(pose.x, pose.y, 0));
        const halfHeight = pose.distance * HALF_ANGLE;
        const lift = halfHeight * pose.lift;
        return { at: pose.at, focus: centre.clone(), target: centre.clone().add(new Vector3(0, lift, 0)), position: centre.clone().add(new Vector3(0, lift + halfHeight * 0.16, pose.distance)) };
      });
    }
    return CAMERA_POSES.map(pose => {
      const zone = ZONES[pose.zone];
      /* Narrower desktops leave less room beside the copy column, so the camera earns it back with
         distance. Capped: an unclamped 1.95/aspect sends a portrait tablet (0.75) to 2.6x, which
         shrinks the whole story to a third of the frame. */
      const distance = pose.distance * Math.min(1.3, Math.max(1, 1.95 / aspect));
      const halfHeight = distance * HALF_ANGLE;
      const offset = halfHeight * 2 * aspect * pose.side;
      const lift = pose.zone === 6 ? halfHeight * 0.24 : 0;
      const centre = new Vector3(...zone.center).add(new Vector3(pose.x, pose.y, 0));
      return { at: pose.at, focus: centre, target: centre.clone().add(new Vector3(offset, lift, 0)), position: centre.clone().add(new Vector3(offset + pose.azimuth, pose.aimY * 1.35 + lift, distance)) };
    });
  }, [size.width, size.height, mobile]);
  const vectors = useMemo(() => ({ position: new Vector3(), target: new Vector3(), a: new Vector3(), b: new Vector3() }), []);
  useFrame(({ camera }) => {
    const p = staticZone === undefined ? progress.get() : staticZone === 0 ? 0 : ZONES[staticZone].at + (ZONES[staticZone].end - ZONES[staticZone].at) * 0.55;
    interpolate(frames, p, "position", vectors.position, vectors.a, vectors.b);
    interpolate(frames, p, "target", vectors.target, vectors.a, vectors.b);
    interpolate(frames, p, "focus", focus.current, vectors.a, vectors.b);
    if (!mobile && staticZone === undefined && pointer) {
      vectors.position.setX(vectors.position.x + pointer.current.x * 0.10);
      vectors.target.setY(vectors.target.y - pointer.current.y * 0.04);
    }
    camera.position.copy(vectors.position);
    camera.lookAt(vectors.target);
  });
  return null;
}
