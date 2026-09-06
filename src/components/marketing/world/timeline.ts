import type { Point3 } from "../hero/constants/stages";

export const WORLD_BLACK = "#020409";
export const ZONES = [
  { at: 0, end: 0.19, center: [0, 0, 0] as Point3, rotation: -0.08, scale: 1, side: -1 },
  { at: 0.19, end: 0.30, center: [2, -17, -3] as Point3, rotation: 0.18, scale: 1.5, side: -1 },
  { at: 0.30, end: 0.445, center: [-3, -32, -8] as Point3, rotation: -0.25, scale: 1.6, side: 1 },
  { at: 0.445, end: 0.585, center: [3, -48, -1] as Point3, rotation: 0.16, scale: 1.65, side: -1 },
  { at: 0.585, end: 0.715, center: [-2, -64, 4] as Point3, rotation: -0.18, scale: 1.7, side: 1 },
  { at: 0.715, end: 0.865, center: [2, -81, -5] as Point3, rotation: 0.22, scale: 1.7, side: -1 },
  { at: 0.865, end: 1, center: [0, -101, -1] as Point3, rotation: 0, scale: 1.85, side: 0 },
] as const;

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const zoneProgress = (value: number, index: number) => clamp((value - ZONES[index].at) / (ZONES[index].end - ZONES[index].at));

/**
 * The master rail, authored as one strand through every zone. Each control point is either a
 * component port (the exact edge anchor a cable plugs into) or a routing tangent that carries the
 * cable behind, under or around geometry. Nothing here is decorative: a segment exists because the
 * product moves a lead along it.
 */
const routes: Point3[][] = [
  /* 00 · Hero — the conversion spiral, descending past each stage pedestal. */
  [[-2.15, 3.2, -1.8], [-1.1, 2.8, -1.1], [1, 2.15, -0.9], [3.2, 1.4, -0.4], [2.2, 0.6, 0.1], [-2.7, 0.15, 0.1], [-3.2, -1.4, 1.1], [-0.3, -2.35, 1.2], [1.15, -3.15, 1.6], [3.3, -4.05, 2.2], [1.5, -5.2, 2.3], [-1.1, -5.6, 1.7], [-2.8, -8, 0.3]],
  /* 01 · Speed to lead — enquiry in, straight through the response, waiting branch stays unpowered. */
  [[-4.6, 2.8, -2.2], [-4.2, 1, -1.1], [-3.61, 0, 0], [-1.39, 0, 0], [-0.75, -0.35, 0.15], [0.25, -0.9, 0.3], [2.95, -0.9, 0.3], [3.9, -1.9, 0.6], [2.6, -4.4, 1.4]],
  /* 02 · Follow-up — descends the left edge of the timeline, touching only messages already sent. */
  [[-3.2, 3.8, -1.7], [-2.5, 2.4, -1.05], [-1.96, 1.6, -0.6], [-2.38, 1.15, -0.33], [-1.72, 0.7, -0.05], [-2.12, 0.25, 0.22], [-1.61, -0.2, 0.5], [-1.95, -0.8, 0.4], [-1.7, -1.8, -0.5], [-0.4, -2.9, -1.9], [1.3, -4.1, -1.7], [2.4, -5.6, -0.9]],
  /* 03 · Qualification — into the enquiry, behind the rule machine, out through the qualified route. */
  [[-4.9, 3.5, -1.9], [-4, 1.6, -1.25], [-3, 0.15, -0.9], [-2.35, 0, -0.72], [-0.47, 0, -0.7], [0.4, 0.2, -0.55], [1.3, 0.75, -0.3], [1.82, 1.05, 0.3], [3.68, 1.05, 0.3], [4.5, 0.4, 0.6], [3.3, -3.6, 0.2]],
  /* 04 · Booking — qualified lead, behind the calendar shell, out into the confirmation. */
  [[-5, 3.5, -1.7], [-4.1, 1.7, -0.95], [-2.86, 0, 0], [-1.04, 0, 0], [-0.9, 0.35, 0.05], [-0.53, 0.65, 0.15], [0.6, 0.95, -0.4], [1.74, 0.72, 0.05], [1.22, 0.1, 0.05], [3.39, 0.1, 0.05], [4.3, -1.1, 0.4], [3.5, -3.8, 0.4]],
  /* 05 · Reactivation — runs under the archive, never through it, then lifts into the live reply. */
  [[-4.5, 3.3, -2.1], [-4, 1.3, -1.25], [-3.65, -0.6, -0.2], [-3.3, -1.16, 0.6], [-1.6, -1.22, 0.75], [0.2, -1.24, 0.75], [1.0, -1.12, 0.72], [1.08, -0.66, 0.5], [1.03, -0.16, 0.35], [2.87, -0.16, 0.35], [3.7, -1.4, 0.5], [2.6, -4.8, 0.1]],
  /* 06 · Control — sweeps behind the module arc and terminates in the hub. Spokes are drawn locally. */
  [[-5.3, 4.6, -2.3], [-5.5, 2.3, -1.7], [-5.1, 0.2, -1.25], [-4.3, -1.5, -0.6], [-2.8, -2.15, 0.1], [-1.2, -2.05, 0.45], [0, -1.35, 0.5]],
];

/** Where the rail is considered to have arrived in each zone. The reveal stops on a connector, never mid-air. */
const arrivals: Point3[] = [
  [-1.1, -5.6, 1.7], [2.95, -0.9, 0.3], [-1.61, -0.2, 0.5], [1.82, 1.05, 0.3], [1.22, 0.1, 0.05], [1.03, -0.16, 0.35], [0, -1.35, 0.5],
];

export function toWorld(point: Point3, index: number): Point3 {
  const zone = ZONES[index];
  const [x, y, z] = point;
  return [zone.center[0] + (x * Math.cos(zone.rotation) + z * Math.sin(zone.rotation)) * zone.scale, zone.center[1] + y * zone.scale, zone.center[2] + (-x * Math.sin(zone.rotation) + z * Math.cos(zone.rotation)) * zone.scale];
}
export const MASTER_POINTS: Point3[] = routes.flatMap((points, index) => points.map(point => toWorld(point, index)));
export const PORTS = arrivals.map((point, index) => ({ arrive: toWorld(point, index), local: point }));

/** `azimuth` is the authored lateral stand-off of the camera from its subject, in world units. */
export type CameraPose = { at: number; zone: number; y: number; x: number; distance: number; aimY: number; side: number; azimuth: number };
export const CAMERA_POSES: CameraPose[] = [
  { at: 0, zone: 0, y: -1.45, x: 0, distance: 16.6, aimY: 2.5, side: -0.20 , azimuth: -1.55 },
  { at: 0.035, zone: 0, y: -1.5, x: 0.2, distance: 16, aimY: 2.9, side: -0.20 , azimuth: -1.3 },
  { at: 0.085, zone: 0, y: -1, x: 0.5, distance: 13.7, aimY: 2.8, side: -0.20 , azimuth: -0.75 },
  { at: 0.15, zone: 0, y: -4.6, x: -0.1, distance: 12, aimY: 2, side: -0.18 , azimuth: -0.1 },
  { at: 0.225, zone: 1, y: -0.15, x: -0.4, distance: 12.6, aimY: 2.5, side: -0.15 , azimuth: 0.65 },
  { at: 0.265, zone: 1, y: -0.85, x: 0.7, distance: 11.2, aimY: 2.1, side: -0.13 , azimuth: 1.15 },
  { at: 0.34, zone: 2, y: 0.85, x: 0.35, distance: 13.4, aimY: 2.7, side: 0.15 , azimuth: 1.35 },
  { at: 0.395, zone: 2, y: -1.15, x: 0.75, distance: 12.4, aimY: 2.1, side: 0.15 , azimuth: 1.05 },
  { at: 0.485, zone: 3, y: 0.1, x: 0.7, distance: 13.4, aimY: 2.9, side: -0.14 , azimuth: 0.35 },
  { at: 0.54, zone: 3, y: -0.45, x: 1.4, distance: 12, aimY: 2.3, side: -0.13 , azimuth: -0.35 },
  { at: 0.62, zone: 4, y: 0.35, x: -0.25, distance: 14.6, aimY: 3, side: 0.14 , azimuth: -1.05 },
  { at: 0.67, zone: 4, y: -0.55, x: 0.15, distance: 13.5, aimY: 2.4, side: 0.14 , azimuth: -1.35 },
  { at: 0.755, zone: 5, y: 0.05, x: -0.2, distance: 14.3, aimY: 3.4, side: -0.13 , azimuth: -1.1 },
  { at: 0.815, zone: 5, y: -0.6, x: 0.7, distance: 12.4, aimY: 2.6, side: -0.12 , azimuth: -0.5 },
  { at: 0.9, zone: 6, y: -0.1, x: 0.5, distance: 15.2, aimY: 3.4, side: 0 , azimuth: 0.15 },
  { at: 0.96, zone: 6, y: -0.15, x: 0, distance: 21.2, aimY: 3.3, side: 0 , azimuth: 0.45 },
  { at: 1, zone: 6, y: -0.15, x: 0, distance: 21.8, aimY: 3.3, side: 0 , azimuth: 0.5 },
];

/**
 * Mobile is authored, not derived. A portrait viewport cannot hold a chapter's full horizontal
 * spread at a readable size, so the camera pans across each zone and frames one dominant object at
 * a time. Offsets are given in the zone's own local units and scaled with the zone below.
 */
type MobilePose = { at: number; zone: number; x: number; y: number; distance: number; lift: number };
const mobilePoses: MobilePose[] = [
  { at: 0, zone: 0, x: -1.3, y: 3.2, distance: 8.6, lift: 0.62 },
  { at: 0.055, zone: 0, x: -0.6, y: 2.9, distance: 8.2, lift: 0.62 },
  { at: 0.095, zone: 0, x: 0.7, y: 2.1, distance: 8.4, lift: 0.6 },
  { at: 0.135, zone: 0, x: -0.7, y: -0.1, distance: 9.4, lift: 0.58 },
  { at: 0.168, zone: 0, x: 1.1, y: -2.7, distance: 8.6, lift: 0.58 },
  { at: 0.19, zone: 0, x: -1, y: -5.2, distance: 9.2, lift: 0.56 },
  { at: 0.225, zone: 1, x: -2.4, y: 0.1, distance: 8.4, lift: 0.6 },
  { at: 0.275, zone: 1, x: 1.5, y: -0.8, distance: 9, lift: 0.58 },
  { at: 0.33, zone: 2, x: -0.8, y: 1.5, distance: 8.8, lift: 0.6 },
  { at: 0.375, zone: 2, x: -0.6, y: 0.2, distance: 9.4, lift: 0.58 },
  { at: 0.425, zone: 2, x: 0.9, y: -0.1, distance: 9.2, lift: 0.58 },
  { at: 0.48, zone: 3, x: -2.1, y: 0, distance: 8.4, lift: 0.6 },
  { at: 0.52, zone: 3, x: 0, y: 0.1, distance: 10.4, lift: 0.58 },
  { at: 0.565, zone: 3, x: 2.3, y: 0.5, distance: 8.8, lift: 0.58 },
  { at: 0.615, zone: 4, x: -2.1, y: 0, distance: 8.6, lift: 0.6 },
  { at: 0.66, zone: 4, x: 0.6, y: 0.6, distance: 10, lift: 0.58 },
  { at: 0.705, zone: 4, x: 2.6, y: 0.4, distance: 9, lift: 0.58 },
  { at: 0.75, zone: 5, x: -1.5, y: 0.1, distance: 10.2, lift: 0.6 },
  { at: 0.8, zone: 5, x: 0.4, y: -0.3, distance: 10.4, lift: 0.58 },
  { at: 0.85, zone: 5, x: 2.1, y: -0.2, distance: 8.8, lift: 0.58 },
  { at: 0.895, zone: 6, x: -2.6, y: 0.7, distance: 9.4, lift: 0.56 },
  { at: 0.93, zone: 6, x: 0.4, y: 0.6, distance: 10.4, lift: 0.54 },
  { at: 0.965, zone: 6, x: 0, y: -0.5, distance: 15.6, lift: 0.42 },
  { at: 1, zone: 6, x: 0, y: -0.6, distance: 16.4, lift: 0.4 },
];
export const MOBILE_POSES = mobilePoses.map(pose => ({ ...pose, x: pose.x * ZONES[pose.zone].scale, y: pose.y * ZONES[pose.zone].scale, distance: pose.distance * ZONES[pose.zone].scale }));
