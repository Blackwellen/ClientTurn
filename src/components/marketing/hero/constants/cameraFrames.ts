import type { Point3 } from "./stages";

export const CAMERA_FRAMES: { at: number; position: Point3; target: Point3 }[] = [
  { at: 0, position: [3.4, 3.0, 20.5], target: [0.4, -0.3, 0] },
  { at: 0.12, position: [3.4, 3.0, 20.5], target: [0.4, -0.3, 0] },
  { at: 0.25, position: [2.3, 4.9, 14.5], target: [-0.4, 2.7, 0] },
  { at: 0.41, position: [3.1, 3.5, 14.5], target: [0.5, 1.5, 0] },
  { at: 0.57, position: [2.8, 1.9, 14.2], target: [0.2, -0.1, 0] },
  { at: 0.73, position: [2.8, -0.2, 14.3], target: [0.4, -2.0, 0] },
  { at: 0.91, position: [2.6, -1.7, 14.7], target: [0.15, -3.3, 0] },
  { at: 1, position: [2.6, -1.7, 14.7], target: [0.15, -3.3, 0] },
];
