import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { MotionValue } from "motion/react";
import { CAMERA_FRAMES } from "../constants/cameraFrames";
import { smoothRange } from "../constants/stages";

export function SceneCamera({ progress, reducedMotion, mobile }: { progress: MotionValue<number>; reducedMotion: boolean; mobile: boolean }) {
  const vectors = useMemo(() => ({ position: new Vector3(), target: new Vector3(), a: new Vector3(), b: new Vector3() }), []);
  useFrame(({ camera, size }) => {
    const p = reducedMotion ? 0 : progress.get();
    const index = Math.max(0, CAMERA_FRAMES.findIndex((frame) => frame.at >= p) - 1);
    const a = CAMERA_FRAMES[index];
    const b = CAMERA_FRAMES[Math.min(index + 1, CAMERA_FRAMES.length - 1)];
    const t = smoothRange(p, a.at, b.at || 1);
    vectors.position.fromArray(a.position).lerp(vectors.a.fromArray(b.position), t);
    vectors.target.fromArray(a.target).lerp(vectors.b.fromArray(b.target), t);
    if (mobile) {
      vectors.position.setX(vectors.target.x + 1.1);
      vectors.position.setY(vectors.target.y + 1.5);
      vectors.position.setZ(vectors.position.z * (p < 0.16 ? 1 : 0.92));
    }
    if (!mobile) {
      const offset = 2 * Math.tan(17 * Math.PI / 180) * vectors.position.z * size.width / size.height * 0.225;
      vectors.position.setX(vectors.position.x - offset);
      vectors.target.setX(vectors.target.x - offset);
    }
    camera.position.copy(vectors.position);
    camera.lookAt(vectors.target);
  });
  return null;
}
