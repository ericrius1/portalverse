import type { Mapping, Projector, ProjectionRig, V3 } from '@portalverse/core/rooms/projection/rig';
import { PALACE, ROTUNDA } from './layout';

/**
 * The drone show on the Palace: twelve projectors and where each one works (the choreography follows Neon's notes in
 * packages/core/src/rooms/projection/PROGRAMS.md).
 *
 *   the dome (4)        one under the crown throwing the golden phyllotaxis up into the coffers like a living
 *                       skylight, three round it throwing caustics, venation and pollen up the dome's lower rings
 *   the rotunda (4)     outside, round it: mapped to its cylinder (the image aligned with the piers and columns, as
 *                       a calibrated show is), Maybeck's vines, ferns, mycelium and venation climbing the stone
 *   the colonnade (4)   over the lawns, throwing caustics, komorebi and pollen along the curving wings
 *
 * Programs (programs.wgsl): 0 caustics, 1 komorebi, 2 vines, 3 venation, 4 phyllotaxis, 5 ferns, 6 mycelium, 7 pollen.
 * Each drone dwells ~55 s on a program and crosses to the next over 6 s, staggered so one or two change at a time;
 * now and then each drifts to a neighbouring station (its depth map redrawn as it goes). The show is lit as the
 * dark comes (the renderer scales it by the view's dusk); the drones hover there from the start.
 */

const [CX, CZ] = PALACE.at;
const DWELL = 55;
const FADE = 6;
const DRIFT_EVERY = 140;
const DRIFT_TIME = 12;

interface Station { at: V3; aim: V3 }
interface Role {
  stations: [Station, Station];
  fovY: number;
  /** the light wanted on the stone it aims at (the lamp's power is worked out from the throw's length) */
  level: number;
  tint: V3;
  haze: number;
  programs: number[];
  mapping: Mapping;
}

const DEG = Math.PI / 180;
const ring = (r: number, deg: number, y: number): V3 => [CX + r * Math.cos(deg * DEG), y, CZ + r * Math.sin(deg * DEG)];
const rotunda: Mapping = { kind: 'cylinder', axis: [CX, CZ], repeats: 8, foot: 0, height: 24 };
const dome: Mapping = { kind: 'throw' };
const warm: V3 = [1, 0.94, 0.86];

/** high around the rotunda's upper arch ring (clear of the ascending celestial spiral), framing the piers and cornice */
const DOME_Y = 20.5;
const domeAim = (deg: number): V3 => ring(16.5, deg, ROTUNDA.archCrown + 2.5);
const domeRole = (deg: number, programs: number[]): Role => ({
  stations: [{ at: ring(15.2, deg, DOME_Y), aim: domeAim(deg + 25) }, { at: ring(15.5, deg + 12, DOME_Y + 1.0), aim: domeAim(deg + 37) }],
  fovY: 58 * DEG, level: 0.85, tint: warm, haze: 0.18, programs, mapping: dome,
});

/** outside the rotunda, aimed at it from 40-50 m, a little above the arches' springing */
const outRole = (r: number, deg: number, y: number, programs: number[]): Role => ({
  stations: [
    { at: ring(r, deg, y), aim: [CX, 15, CZ] },
    { at: ring(r + 3, deg + 9, y + 2), aim: [CX, 14, CZ] },
  ],
  fovY: 44 * DEG, level: 1.1, tint: warm, haze: 1, programs, mapping: rotunda,
});

/** over the lawns, aimed along the colonnade's wings (u, |v| in the Palace's frame of the wing point it aims at) */
const wingRole = (at: V3, aimU: number, aimV: number, programs: number[]): Role => ({
  stations: [
    { at, aim: [CX + aimU, 6, CZ + aimV] },
    { at: [at[0] + 4, at[1] + 1.5, at[2] + 3 * Math.sign(aimV)], aim: [CX + aimU + 5, 6, CZ + aimV + 3 * Math.sign(aimV)] },
  ],
  fovY: 50 * DEG, level: 0.9, tint: warm, haze: 0.8, programs, mapping: { kind: 'throw' },
});

const ROLES: Role[] = [
  // inside the rotunda's upper ring: four drones clear of the spiral walkway, washing the piers, arch soffits & cornice
  domeRole(-30, [4, 0, 3, 4, 7]),
  domeRole(60, [0, 3, 7, 0]),
  domeRole(150, [3, 7, 0, 6]),
  domeRole(240, [7, 0, 3, 4]),
  // the rotunda from outside: the approach (north, +z), the lagoon (east), behind (west), the far side (south)
  outRole(44, 62, 15, [2, 6, 5, 3]),
  outRole(46, -8, 17, [6, 3, 2, 5]),
  outRole(44, 188, 15, [5, 2, 6, 3]),
  outRole(44, 250, 15, [3, 5, 6, 2]),
  // the colonnade's wings: two on each side, from over the lawns between them and the rotunda
  wingRole([CX + 18, 12, CZ + 46], -14, 58, [1, 0, 7, 1]),
  wingRole([CX + 30, 12, CZ + 58], 8, 76, [0, 7, 1, 0]),
  wingRole([CX + 18, 12, CZ - 46], -14, -58, [7, 1, 0, 7]),
  wingRole([CX + 30, 12, CZ - 58], 8, -76, [0, 1, 7, 0]),
];

export const SHOW_DRONES = ROLES.length;

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Set every drone of the show for this moment (once a frame, before rig.update). */
export function stageShow(rig: ProjectionRig, time: number): void {
  for (let i = 0; i < ROLES.length && i < rig.capacity; i++) {
    const role = ROLES[i];
    const P: Projector = rig.projectors[i];
    // ---- the program: staggered dwell and crossfade
    const offset = i * 13.7;
    const t = time + offset;
    const slot = Math.floor(t / DWELL);
    const into = t - slot * DWELL;
    const n = role.programs.length;
    P.program = role.programs[((slot % n) + n) % n];
    P.nextProgram = role.programs[(((slot + 1) % n) + n) % n];
    P.blend = smooth((into - (DWELL - FADE)) / FADE);
    if (P.blend >= 1) { P.program = P.nextProgram; P.blend = 0; }
    P.seed = (i * 0.618034) % 1;
    // ---- where it is: one station, now and then drifting to the other and back
    const dt = time + i * 23.1;
    const leg = Math.floor(dt / DRIFT_EVERY);
    const k = smooth((dt - leg * DRIFT_EVERY) / DRIFT_TIME);
    const from = role.stations[leg % 2], to = role.stations[(leg + 1) % 2];
    // (the move happens at the start of each leg: from the last station to this leg's)
    P.position = lerp3(from.at, to.at, k);
    P.target = lerp3(from.aim, to.aim, k);
    P.fovY = role.fovY;
    // ---- its lamp: enough for `level` on the stone where it aims
    const dist = Math.hypot(P.target[0] - P.position[0], P.target[1] - P.position[1], P.target[2] - P.position[2]);
    P.power = role.level * (dist * dist + 4) / 100;
    P.tint = role.tint;
    P.haze = role.haze;
    P.occlude = true;
    P.body = true;
    P.mapping = role.mapping;
  }
}
