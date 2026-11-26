import * as THREE from 'three/webgpu';
import { createSkyDrakeMaterials } from './skyDrakeMaterials';
import { IDLE_MOTION_STATE, type AvatarMotionState, type CharacterRig } from './types';

/*
 * Zephyr — the Prism Sky Drake.
 *
 * Built natively in Portalverse space: +X is the drake's right, +Y up, -Z forward.
 * The root group sits at the soles of the feet (Y = 0).
 *
 *   group
 *   └─ rigRoot (centre of mass, flight pitch + bank, order ZYX)
 *      ├─ legRoot (pelvis height, never pitched on the ground so foot IK stays planted)
 *      │  └─ hipL/R → kneeL/R → ankleL/R → footL/R (3 toes + dew claw)
 *      └─ bodyPivot (pelvis: bob, sway, squash)
 *         ├─ tailSeg0 → tailSeg1 → tailSeg2 → tailSeg3 → tailVane
 *         └─ torso (forward lean, breathing)
 *            ├─ neckPivot → headPivot → jawPivot, eyes (+ eyelids), horns, crests
 *            ├─ armShoulderL/R → armElbowL/R → hand (3 claws)
 *            ├─ wingRootL/R → wingShoulder → wingElbow → wingWrist → finger pivots
 *            │  └─ (wing membrane: CPU-rebuilt each frame from the bone chain)
 *            └─ scarf collar + scarfTailL/R ribbons (CPU-simulated wind & gravity)
 */

// ---------------------------------------------------------------------------
// Proportions (metres)
// ---------------------------------------------------------------------------

/** Pivot height for whole-body flight pitch and bank (roughly the centre of mass). */
const COM_HEIGHT = 1.0;
/** Standing hip-joint height above the soles. */
const HIP_HEIGHT = 0.84;
const HIP_X = 0.115;
const THIGH = 0.34;
const SHIN = 0.38;
const META = 0.22;
/** Ball-of-foot joint height above the sole of the toes. */
const FOOT_PAD = 0.035;
/** Resting metatarsal angle (digitigrade hock, toes slightly ahead of the ankle). */
const META_REST = 0.12;

const TORSO_LEAN = -0.18;

const HUMERUS = 0.32;
const FOREARM = 0.4;
/** Wing finger lengths: F1 (leading edge to wingtip), F2, F3 (closest to the body). */
const FINGER_LEN = [0.52, 0.44, 0.36] as const;

const TAIL_LEN = [0.3, 0.27, 0.24, 0.21] as const;
const TAIL_RADIUS = [0.085, 0.068, 0.05, 0.034, 0.02] as const;
const TAIL_REST = [0.75, -0.1, -0.2, -0.25] as const;
const TAIL_FLY = [1.12, 0.02, 0.0, -0.04] as const;

/** Torso radius profile (radius, height above the pelvis pivot). */
const TORSO_PROFILE: ReadonlyArray<readonly [number, number]> = [
  [0.001, -0.2],
  [0.11, -0.19],
  [0.185, -0.14],
  [0.212, -0.05],
  [0.218, 0.05],
  [0.212, 0.15],
  [0.2, 0.25],
  [0.183, 0.33],
  [0.158, 0.4],
  [0.125, 0.46],
  [0.095, 0.505],
  [0.075, 0.53],
];
const TORSO_DEPTH = 0.86;

function torsoRadius(y: number): number {
  for (let i = 1; i < TORSO_PROFILE.length; i++) {
    const [r1, y1] = TORSO_PROFILE[i];
    if (y <= y1) {
      const [r0, y0] = TORSO_PROFILE[i - 1];
      return r0 + (r1 - r0) * THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
    }
  }
  return TORSO_PROFILE[TORSO_PROFILE.length - 1][0];
}

// ---------------------------------------------------------------------------
// Small maths helpers
// ---------------------------------------------------------------------------

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const TAU = Math.PI * 2;

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function smooth01(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------
// Procedural geometry builders (all with clean 0..1 UVs)
// ---------------------------------------------------------------------------

/** Tube along a Catmull-Rom curve whose radius tapers from `r0` at the root to `r1` at the tip. */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, tubular = 16, radial = 8): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.getAttribute('position');
  const center = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, center);
    const r = r0 + (r1 - r0) * Math.pow(u, 0.85);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r).add(center);
      pos.setXYZ(idx, p.x, p.y, p.z);
    }
  }
  pos.needsUpdate = true;
  return geo;
}

/** Tapered cylinder lying along +X from the origin (radius `r0` at root, `r1` at tip). */
function boneAlongX(length: number, r0: number, r1: number, radial = 8): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r1, r0, length, radial, 1);
  geo.rotateZ(-Math.PI / 2);
  geo.translate(length / 2, 0, 0);
  return geo;
}

/** Tapered cylinder lying along +Z from the origin. */
function boneAlongZ(length: number, r0: number, r1: number, radial = 10): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r1, r0, length, radial, 1);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, length / 2);
  return geo;
}

/** Tapered cylinder hanging along -Y from the origin. */
function boneAlongNegY(length: number, r0: number, r1: number, radial = 10): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r0, r1, length, radial, 1);
  geo.translate(0, -length / 2, 0);
  return geo;
}

/**
 * Scalloped feather fan in the local Y-Z plane, rooted at the origin and spreading toward +Z.
 * U runs root (0) → tip (1), V runs across the fan (0 → 1). `curl` cups the fan along X.
 */
function fanFin(length: number, halfAngle: number, rays: number, curl = 0): THREE.BufferGeometry {
  const angular = rays * 6;
  const radial = 5;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= radial; i++) {
    const f = i / radial;
    for (let j = 0; j <= angular; j++) {
      const t = j / angular;
      const theta = -halfAngle + 2 * halfAngle * t;
      const peak = 0.5 + 0.5 * Math.cos(TAU * rays * (t - 0.5 / rays));
      const r = length * (0.68 + 0.32 * Math.pow(peak, 1.6)) * (0.72 + 0.28 * Math.sin(Math.PI * t)) * f;
      positions.push(curl * length * f * f * (0.6 + 0.4 * Math.sin(Math.PI * t)), Math.sin(theta) * r, Math.cos(theta) * r);
      uvs.push(f, t);
    }
  }
  const stride = angular + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < angular; j++) {
      const a = i * stride + j;
      indices.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Pointed leaf / feather vane lying flat in the X-Z plane, pointing along +X. */
function leafVane(length: number, width: number, segments = 8): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const half = width * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.8) * (1 - 0.35 * u);
    for (let k = 0; k <= 2; k++) {
      const v = k / 2;
      positions.push(u * length, 0.012 * Math.sin(Math.PI * u) * (1 - Math.abs(2 * v - 1)), (v * 2 - 1) * half);
      uvs.push(u, v);
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let k = 0; k < 2; k++) {
      const a = i * 3 + k;
      indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Segmented ventral plates hugging the front (-Z) of the torso lathe. */
function bellyPlates(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const bands: Array<[number, number]> = [];
  const bottom = -0.13;
  const top = 0.44;
  const count = 7;
  const gap = 0.012;
  const bandH = (top - bottom - gap * (count - 1)) / count;
  for (let b = 0; b < count; b++) {
    const y0 = bottom + b * (bandH + gap);
    bands.push([y0, y0 + bandH]);
  }
  const rows = 4;
  const cols = 10;
  let base = 0;
  bands.forEach(([y0, y1], b) => {
    for (let r = 0; r <= rows; r++) {
      const tr = r / rows;
      const y = y0 + (y1 - y0) * tr;
      const tGlobal = (y - bottom) / (top - bottom);
      const halfAngle = 0.78 - 0.22 * Math.abs(tGlobal - 0.35) - 0.25 * Math.max(0, tGlobal - 0.75);
      const bulge = 0.007 + 0.009 * Math.sin(Math.PI * tr);
      for (let c = 0; c <= cols; c++) {
        const tc = c / cols;
        const phi = Math.PI + (tc * 2 - 1) * halfAngle;
        const radius = torsoRadius(y) + bulge * (0.6 + 0.4 * Math.sin(Math.PI * tc));
        positions.push(Math.sin(phi) * radius, y, Math.cos(phi) * radius * TORSO_DEPTH);
        uvs.push(tc, (b + tr) / count);
      }
    }
    const stride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * stride + c;
        indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
    base += (rows + 1) * stride;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Shallow spherical cap facing -Z with planar 0..1 UVs centred on the pole (for the iris map). */
function irisDome(radius: number, capAngle: number): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(radius, 22, 8, 0, TAU, 0, capAngle);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const span = radius * Math.sin(capAngle);
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, 0.5 + pos.getX(i) / (2 * span), 0.5 + pos.getY(i) / (2 * span));
  }
  uv.needsUpdate = true;
  return geo;
}

// ---------------------------------------------------------------------------
// Wing pose model
// ---------------------------------------------------------------------------

/**
 * Wing joint parameters for the RIGHT wing, in the wingRoot frame
 * (X = span outward, Y = dorsal membrane normal, Z = trailing chord direction).
 * The left wing mirrors these through the X = 0 plane.
 */
interface WingPose {
  /** Stroke rotation about the chord axis (tip toward dorsal side). */
  elev: number;
  /** In-plane sweep of the humerus toward the trailing edge. */
  sweep: number;
  /** Twist about the humerus (leading edge toward the dorsal side). */
  twist: number;
  /** In-plane elbow flex (forearm toward the leading edge). */
  flex: number;
  /** Out-of-plane elbow bend (outer wing toward the dorsal side). */
  bendE: number;
  /** Twist about the forearm. */
  twistE: number;
  /** In-plane wrist fold (hand toward the trailing edge). */
  wristBack: number;
  /** Out-of-plane wrist bend. */
  bendW: number;
  /** Extra trailing fan of finger 2 / finger 3 relative to finger 1. */
  fan2: number;
  fan3: number;
}

const POSE_KEYS: ReadonlyArray<keyof WingPose> = [
  'elev', 'sweep', 'twist', 'flex', 'bendE', 'twistE', 'wristBack', 'bendW', 'fan2', 'fan3',
];

/** Folded mantle: humerus down the back, forearm folded up to the shoulder, fingers draped down. */
const POSE_FOLD: Readonly<WingPose> = {
  elev: 0.82, sweep: 1.36, twist: 0.02, flex: 2.62, bendE: 0.11, twistE: 0,
  wristBack: 2.62, bendW: 0.09, fan2: 0.12, fan3: 0.23,
};
/** Majestic display spread while jumping (frontal plane, tips raised). */
const POSE_JUMP: Readonly<WingPose> = {
  elev: 0.3, sweep: -0.12, twist: 0.0, flex: 0.42, bendE: 0.06, twistE: 0,
  wristBack: 0.36, bendW: 0.06, fan2: 0.56, fan3: 1.06,
};
/** Neutral full-span flight spread. */
const POSE_FLY: Readonly<WingPose> = {
  elev: 0.08, sweep: 0.12, twist: 0.06, flex: 0.32, bendE: 0.0, twistE: 0.04,
  wristBack: 0.25, bendW: -0.03, fan2: 0.58, fan3: 1.12,
};
/** Swept falcon / jet-glider delta for Shift boost. */
const POSE_BOOST: Readonly<WingPose> = {
  elev: 0.05, sweep: 0.5, twist: 0.03, flex: -0.5, bendE: 0.02, twistE: 0,
  wristBack: 0.32, bendW: 0.0, fan2: 0.16, fan3: 0.32,
};

function mixPose(out: WingPose, a: Readonly<WingPose>, b: Readonly<WingPose>, t: number): WingPose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

function axisQuat(out: THREE.Quaternion, axis: THREE.Vector3, angle: number): THREE.Quaternion {
  return out.setFromAxisAngle(axis, angle);
}

/** Mirror a rotation through the X = 0 plane (used for the left wing). */
function mirrorQuat(q: THREE.Quaternion): THREE.Quaternion {
  return q.set(q.x, -q.y, -q.z, q.w);
}

// Inner membrane columns (shoulder → elbow → wrist) and outer columns (wrist → wingtip).
const MEMBRANE_INNER_COLS = 8;
const MEMBRANE_OUTER_COLS = 10;
const MEMBRANE_COLS = MEMBRANE_INNER_COLS + MEMBRANE_OUTER_COLS + 1;
const MEMBRANE_ROWS = 7;
/** Body attachment of the inner trailing edge (flank / hip) in the right wingRoot frame. */
const MEMBRANE_BODY_ATTACH = new THREE.Vector3(0.06, 0.0, 0.4);

interface WingRig {
  side: number;
  root: THREE.Group;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  fingers: THREE.Group[];
  membrane: THREE.Mesh;
  membraneGeo: THREE.BufferGeometry;
  membranePos: THREE.BufferAttribute;
}

interface LegRig {
  side: number;
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
  foot: THREE.Group;
}

interface ArmRig {
  side: number;
  shoulder: THREE.Group;
  elbow: THREE.Group;
  hand: THREE.Group;
}

interface ScarfTail {
  side: number;
  group: THREE.Group;
  geo: THREE.BufferGeometry;
  pos: THREE.BufferAttribute;
}

/** Leg joint angles (hip roll + sagittal angles) shared by the IK and FK paths. */
interface LegAngles {
  roll: number;
  hip: number;
  knee: number;
  ankle: number;
  foot: number;
}

const SCARF_SEGMENTS = 12;
const SCARF_LENGTH = 0.56;

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

/**
 * Playable rigged Zephyr — the Prism Sky Drake. Root sits at the soles of the feet (Y = 0)
 * and faces -Z. Stands ~1.8 m to the horn tips with a ~2.7 m flight wingspan.
 */
export function createSkyDrakeRig(options?: { accentColor?: string }): CharacterRig {
  const materials = createSkyDrakeMaterials(options?.accentColor);
  const geometries: THREE.BufferGeometry[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const mesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number] = [0, 0, 0],
    scale: readonly [number, number, number] = [1, 1, 1],
    rotation: readonly [number, number, number] = [0, 0, 0],
  ): THREE.Mesh => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(position[0], position[1], position[2]);
    m.scale.set(scale[0], scale[1], scale[2]);
    m.rotation.set(rotation[0], rotation[1], rotation[2]);
    return m;
  };
  const pivot = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // Shared primitives
  const ball = geo(new THREE.SphereGeometry(1, 24, 16));
  const lowBall = geo(new THREE.SphereGeometry(1, 12, 8));
  const clawGeo = geo(new THREE.ConeGeometry(1, 1, 7));
  clawGeo.translate(0, 0.5, 0);
  const plateGeo = geo(new THREE.ConeGeometry(1, 1, 4));
  plateGeo.translate(0, 0.5, 0);

  const group = new THREE.Group();
  group.name = 'character-sky-drake';

  const rigRoot = pivot('rigRoot', group, 0, COM_HEIGHT, 0);
  rigRoot.rotation.order = 'ZYX';

  const legRoot = pivot('legRoot', rigRoot, 0, HIP_HEIGHT - COM_HEIGHT, 0);
  const bodyPivot = pivot('bodyPivot', rigRoot, 0, HIP_HEIGHT - COM_HEIGHT, 0);
  bodyPivot.rotation.order = 'ZYX';

  // --- TORSO ---------------------------------------------------------------
  const torso = pivot('torso', bodyPivot);
  torso.rotation.x = TORSO_LEAN;

  const torsoGeo = geo(new THREE.LatheGeometry(TORSO_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)), 36, 0, TAU));
  torso.add(mesh(torsoGeo, materials.body, [0, 0, 0], [1, 1, TORSO_DEPTH]));
  torso.add(mesh(geo(bellyPlates()), materials.belly));

  // Layered upper-back mantle (slightly raised shoulder shell)
  torso.add(mesh(ball, materials.body, [0, 0.34, 0.035], [0.2, 0.15, 0.17]));
  // Hip / haunch masses blending into the thighs
  for (const side of [-1, 1]) {
    torso.add(mesh(ball, materials.body, [side * 0.12, -0.04, 0.02], [0.13, 0.15, 0.15]));
  }

  // Dorsal spine plates down the back
  const dorsal = (parent: THREE.Object3D, x: number, y: number, z: number, h: number, tilt: number) => {
    parent.add(mesh(plateGeo, materials.wingBone, [x, y, z], [0.012, h, h * 0.55], [Math.PI / 2 + tilt, 0, 0]));
  };
  for (let i = 0; i < 6; i++) {
    const y = 0.45 - i * 0.09;
    dorsal(torso, 0, y, torsoRadius(y) * TORSO_DEPTH - 0.008, 0.07 - i * 0.004, 0.45);
  }

  // --- SCARF ----------------------------------------------------------------
  const collarGeo = geo(new THREE.TorusGeometry(0.1, 0.034, 10, 28));
  collarGeo.rotateX(Math.PI / 2);
  torso.add(mesh(collarGeo, materials.scarf, [0, 0.475, -0.005], [1.02, 1.15, 0.95], [0.12, 0, 0]));
  torso.add(mesh(collarGeo, materials.scarf, [0, 0.44, 0.0], [1.14, 0.9, 1.06], [0.18, 0, 0]));
  torso.add(mesh(ball, materials.scarf, [0, 0.45, 0.125], [0.05, 0.045, 0.04]));

  const scarfTails: ScarfTail[] = [];
  {
    const vertsPerSheet = (SCARF_SEGMENTS + 1) * 2;
    for (const side of [-1, 1]) {
      const tailGroup = pivot(side < 0 ? 'scarfTailL' : 'scarfTailR', torso, side * 0.022, 0.44, 0.15);
      const g = geo(new THREE.BufferGeometry());
      const pos = new THREE.BufferAttribute(new Float32Array(vertsPerSheet * 2 * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      const uvs: number[] = [];
      const indices: number[] = [];
      for (let sheet = 0; sheet < 2; sheet++) {
        for (let i = 0; i <= SCARF_SEGMENTS; i++) {
          uvs.push(i / SCARF_SEGMENTS, 0, i / SCARF_SEGMENTS, 1);
        }
        const base = sheet * vertsPerSheet;
        for (let i = 0; i < SCARF_SEGMENTS; i++) {
          const a = base + i * 2;
          if (sheet === 0) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
          else indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      g.setAttribute('position', pos);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      g.setIndex(indices);
      const ribbon = new THREE.Mesh(g, materials.scarf);
      ribbon.frustumCulled = false;
      tailGroup.add(ribbon);
      scarfTails.push({ side, group: tailGroup, geo: g, pos });
    }
  }

  // --- NECK & HEAD ----------------------------------------------------------
  const neckPivot = pivot('neckPivot', torso, 0, 0.47, -0.025);
  const neckCurve = [
    new THREE.Vector3(0, -0.04, 0.01),
    new THREE.Vector3(0, 0.06, -0.012),
    new THREE.Vector3(0, 0.14, -0.05),
    new THREE.Vector3(0, 0.2, -0.1),
  ];
  neckPivot.add(mesh(geo(taperedTube(neckCurve, 0.078, 0.056, 12, 14)), materials.body));
  // Warm throat plates down the front of the neck
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    neckPivot.add(
      mesh(ball, materials.belly, [0, 0.02 + t * 0.15, -0.05 - t * 0.06], [0.044 - t * 0.008, 0.03, 0.02], [0.3 + t * 0.4, 0, 0]),
    );
  }
  for (let i = 0; i < 3; i++) {
    const t = i / 2;
    dorsal(neckPivot, 0, 0.02 + t * 0.14, 0.06 - t * 0.075, 0.05, 0.6 - t * 0.2);
  }

  const headPivot = pivot('headPivot', neckPivot, 0, 0.2, -0.105);

  // Cranium + cheeks + brow
  headPivot.add(mesh(ball, materials.body, [0, 0.065, -0.01], [0.105, 0.092, 0.118]));
  headPivot.add(mesh(ball, materials.body, [0, 0.105, -0.075], [0.075, 0.035, 0.065], [0.15, 0, 0]));
  for (const side of [-1, 1]) {
    headPivot.add(mesh(ball, materials.body, [side * 0.06, 0.025, -0.05], [0.05, 0.045, 0.06]));
  }

  // Muzzle: friendly tapered snout lathe pointing -Z
  const muzzleGeo = geo(
    new THREE.LatheGeometry(
      [
        [0.001, -0.02],
        [0.07, 0.0],
        [0.076, 0.04],
        [0.072, 0.08],
        [0.062, 0.115],
        [0.047, 0.14],
        [0.028, 0.156],
        [0.001, 0.162],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      20,
    ),
  );
  muzzleGeo.rotateX(-Math.PI / 2);
  headPivot.add(mesh(muzzleGeo, materials.body, [0, 0.035, -0.08], [0.95, 0.72, 1]));
  // Rounded nose ridge
  headPivot.add(mesh(ball, materials.body, [0, 0.07, -0.17], [0.032, 0.022, 0.07], [-0.12, 0, 0]));
  // Nostrils
  for (const side of [-1, 1]) {
    headPivot.add(mesh(lowBall, materials.eyeRim, [side * 0.022, 0.058, -0.228], [0.009, 0.006, 0.008]));
  }
  // Upper lip line (warm)
  headPivot.add(mesh(ball, materials.belly, [0, 0.008, -0.15], [0.058, 0.012, 0.08]));

  // Articulated lower jaw with warm under-chin
  const jawPivot = pivot('jawPivot', headPivot, 0, 0.005, -0.03);
  jawPivot.add(mesh(ball, materials.belly, [0, -0.018, -0.1], [0.058, 0.026, 0.115]));
  jawPivot.add(mesh(ball, materials.body, [0, -0.008, -0.06], [0.064, 0.024, 0.08]));

  // Big expressive eyes with blinking lids, set at a 3/4 angle
  const irisGeo = geo(irisDome(0.03, 0.95));
  const eyeSocketGeo = geo(new THREE.SphereGeometry(0.037, 18, 12));
  const eyeRingGeo = geo(new THREE.TorusGeometry(0.0255, 0.0052, 8, 24));
  const eyelidGeo = geo(new THREE.SphereGeometry(0.041, 20, 10, 0, TAU, 0, Math.PI / 2));
  const eyes: Array<{ side: number; group: THREE.Group; lid: THREE.Group }> = [];
  for (const side of [-1, 1]) {
    const eye = pivot(side < 0 ? 'eyeL' : 'eyeR', headPivot, side * 0.066, 0.083, -0.088);
    eye.rotation.set(-0.08, -side * 0.52, 0);
    eye.add(mesh(eyeSocketGeo, materials.eyeRim, [0, 0, 0.006], [1, 1, 0.72]));
    eye.add(mesh(irisGeo, materials.eyeIris, [0, 0, -0.0085]));
    eye.add(mesh(eyeRingGeo, materials.eyeRim, [0, 0, -0.024]));
    const lid = pivot('eyelid', eye);
    lid.add(mesh(eyelidGeo, materials.eyelid));
    // Brow scale over each eye
    eye.add(mesh(ball, materials.body, [0, 0.032, -0.006], [0.045, 0.014, 0.04], [-0.2, 0, 0]));
    eyes.push({ side, group: eye, lid });
  }

  // Sweeping twin horns curving up and back
  for (const side of [-1, 1]) {
    const pts = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.014, 0.06, 0.018),
      new THREE.Vector3(side * 0.036, 0.112, 0.064),
      new THREE.Vector3(side * 0.056, 0.142, 0.13),
      new THREE.Vector3(side * 0.066, 0.15, 0.2),
    ];
    const horn = mesh(geo(taperedTube(pts, 0.021, 0.0025, 18, 9)), materials.horn, [side * 0.05, 0.128, 0.0]);
    horn.name = side < 0 ? 'hornL' : 'hornR';
    headPivot.add(horn);
    // Small secondary brow horn
    const nub = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.012, 0.025, 0.02),
      new THREE.Vector3(side * 0.02, 0.035, 0.055),
    ];
    headPivot.add(mesh(geo(taperedTube(nub, 0.01, 0.0015, 8, 6)), materials.horn, [side * 0.078, 0.1, 0.02]));
  }

  // Luminous aurora ear-fins and cheek frills
  const earFinGeo = geo(fanFin(0.17, 0.5, 3, 0.12));
  const cheekFinGeo = geo(fanFin(0.12, 0.62, 4, 0.1));
  const headCrestGeo = geo(fanFin(0.15, 0.35, 3, 0));
  const crests: Array<{ side: number; ear: THREE.Group; cheek: THREE.Group }> = [];
  for (const side of [-1, 1]) {
    const ear = pivot('earFin', headPivot, side * 0.085, 0.1, 0.035);
    const earMesh = mesh(earFinGeo, materials.crest);
    if (side < 0) earMesh.scale.x = -1;
    ear.add(earMesh);
    const cheek = pivot('cheekFrill', headPivot, side * 0.08, 0.0, -0.005);
    const cheekMesh = mesh(cheekFinGeo, materials.crest);
    if (side < 0) cheekMesh.scale.x = -1;
    cheek.add(cheekMesh);
    crests.push({ side, ear, cheek });
  }
  const headCrest = pivot('headCrest', headPivot, 0, 0.14, 0.04);
  headCrest.add(mesh(headCrestGeo, materials.crest, [0, 0, 0], [1, 1, 1], [-0.25, 0, 0]));

  // --- ARMS -------------------------------------------------------------------
  const upperArmGeo = geo(boneAlongNegY(0.17, 0.04, 0.03));
  const forearmGeo = geo(boneAlongNegY(0.15, 0.03, 0.024));
  const arms: ArmRig[] = [];
  for (const side of [-1, 1]) {
    const y = 0.34;
    const shoulder = pivot(side < 0 ? 'armShoulderL' : 'armShoulderR', torso, side * (torsoRadius(y) - 0.02), y, -0.075);
    shoulder.add(mesh(ball, materials.body, [0, 0, 0], [0.05, 0.05, 0.05]));
    shoulder.add(mesh(upperArmGeo, materials.body));
    const elbow = pivot(side < 0 ? 'armElbowL' : 'armElbowR', shoulder, 0, -0.17, 0);
    elbow.add(mesh(ball, materials.body, [0, 0, 0], [0.032, 0.032, 0.032]));
    elbow.add(mesh(forearmGeo, materials.body));
    elbow.add(mesh(ball, materials.belly, [0, -0.07, -0.016], [0.022, 0.06, 0.014]));
    const hand = pivot('hand', elbow, 0, -0.15, 0);
    hand.add(mesh(ball, materials.body, [0, -0.012, 0], [0.03, 0.026, 0.026]));
    for (let c = 0; c < 3; c++) {
      const a = (c - 1) * 0.38;
      hand.add(
        mesh(clawGeo, materials.horn, [Math.sin(a) * 0.016, -0.03, -0.012], [0.007, 0.034, 0.007], [Math.PI + 0.55, 0, a * 0.6]),
      );
    }
    arms.push({ side, shoulder, elbow, hand });
  }

  // --- LEGS -------------------------------------------------------------------
  const shinGeo = geo(boneAlongNegY(SHIN, 0.055, 0.036));
  const metaGeo = geo(boneAlongNegY(META, 0.036, 0.028));
  const toeGeo = geo(boneAlongZ(0.1, 0.022, 0.014, 8));
  const legs: LegRig[] = [];
  for (const side of [-1, 1]) {
    const hip = pivot(side < 0 ? 'hipL' : 'hipR', legRoot, side * HIP_X, 0, 0.0);
    hip.rotation.order = 'ZYX';
    // Muscular drumstick thigh
    hip.add(mesh(ball, materials.body, [0, -THIGH * 0.45, 0.0], [0.085, THIGH * 0.6, 0.1]));
    const knee = pivot(side < 0 ? 'kneeL' : 'kneeR', hip, 0, -THIGH, 0);
    knee.add(mesh(ball, materials.body, [0, 0, 0], [0.056, 0.056, 0.056]));
    knee.add(mesh(shinGeo, materials.body));
    knee.add(mesh(ball, materials.belly, [0, -SHIN * 0.45, -0.03], [0.03, SHIN * 0.32, 0.02]));
    const ankle = pivot(side < 0 ? 'ankleL' : 'ankleR', knee, 0, -SHIN, 0);
    ankle.add(mesh(ball, materials.body, [0, 0, 0], [0.04, 0.04, 0.04]));
    ankle.add(mesh(metaGeo, materials.body));
    // Little hock spur
    ankle.add(mesh(clawGeo, materials.horn, [0, 0.005, 0.03], [0.009, 0.04, 0.009], [1.9, 0, 0]));
    const foot = pivot(side < 0 ? 'footL' : 'footR', ankle, 0, -META, 0);
    foot.add(mesh(ball, materials.body, [0, 0, -0.01], [0.04, 0.032, 0.05]));
    for (let t = 0; t < 3; t++) {
      const yaw = (1 - t) * 0.36;
      const toe = new THREE.Group();
      toe.rotation.set(0, yaw, 0);
      foot.add(toe);
      // Toe pointing -Z (forward): mirror the +Z bone with a half turn.
      toe.add(mesh(toeGeo, materials.body, [0, -0.012, -0.01], [1, 1, 1], [0, Math.PI, 0]));
      toe.add(mesh(ball, materials.belly, [0, -0.024, -0.06], [0.018, 0.011, 0.045]));
      toe.add(mesh(clawGeo, materials.horn, [0, -0.012, -0.108], [0.011, 0.04, 0.011], [-Math.PI / 2 - 0.35, 0, 0]));
    }
    // Rear dew claw
    foot.add(mesh(clawGeo, materials.horn, [0, -0.012, 0.03], [0.009, 0.03, 0.009], [Math.PI / 2 + 0.4, 0, 0]));
    legs.push({ side, hip, knee, ankle, foot });
  }

  // --- TAIL -------------------------------------------------------------------
  const tailSegs: THREE.Group[] = [];
  {
    let parent: THREE.Object3D = bodyPivot;
    let offsetZ = 0;
    for (let i = 0; i < 4; i++) {
      const seg = pivot(`tailSeg${i}`, parent, 0, i === 0 ? -0.07 : 0, i === 0 ? 0.13 : offsetZ);
      seg.add(mesh(geo(boneAlongZ(TAIL_LEN[i] + 0.02, TAIL_RADIUS[i], TAIL_RADIUS[i + 1], 14)), materials.body));
      seg.add(mesh(ball, materials.body, [0, 0, 0], [TAIL_RADIUS[i], TAIL_RADIUS[i], TAIL_RADIUS[i]]));
      // Warm ventral strip
      seg.add(
        mesh(ball, materials.belly, [0, -TAIL_RADIUS[i] * 0.55, TAIL_LEN[i] * 0.5], [TAIL_RADIUS[i] * 0.62, TAIL_RADIUS[i] * 0.45, TAIL_LEN[i] * 0.5]),
      );
      // Dorsal ridge accents
      for (let p = 0; p < 2; p++) {
        const z = TAIL_LEN[i] * (0.25 + p * 0.45);
        const r = lerp(TAIL_RADIUS[i], TAIL_RADIUS[i + 1], z / TAIL_LEN[i]);
        dorsal(seg, 0, r * 0.82, z, 0.028 + r * 0.35, -0.67);
      }
      tailSegs.push(seg);
      parent = seg;
      offsetZ = TAIL_LEN[i];
    }
  }
  const tailVane = pivot('tailVane', tailSegs[3], 0, 0, TAIL_LEN[3]);
  {
    const flukeGeo = geo(fanFin(0.3, 0.78, 5, 0));
    flukeGeo.rotateZ(Math.PI / 2);
    tailVane.add(mesh(flukeGeo, materials.crest));
    tailVane.add(mesh(geo(fanFin(0.2, 0.5, 3, 0)), materials.crest, [0, 0.005, 0], [1, 1, 1], [-0.1, 0, 0]));
    tailVane.add(mesh(ball, materials.crest, [0, 0, 0.02], [0.022, 0.022, 0.04]));
  }

  // --- WINGS ------------------------------------------------------------------
  const humerusGeo = geo(boneAlongX(HUMERUS, 0.03, 0.022, 10));
  const wingForearmGeo = geo(boneAlongX(FOREARM, 0.023, 0.016, 10));
  const fingerGeos = FINGER_LEN.map((len, k) => geo(boneAlongX(len, 0.014 - k * 0.0015, 0.0035, 7)));
  const tipVaneGeo = geo(leafVane(0.13, 0.03));
  const wings: WingRig[] = [];

  const membraneIndex = (side: number): number[] => {
    const idx: number[] = [];
    for (let c = 0; c < MEMBRANE_COLS - 1; c++) {
      for (let r = 0; r < MEMBRANE_ROWS - 1; r++) {
        const a = c * MEMBRANE_ROWS + r;
        const b = (c + 1) * MEMBRANE_ROWS + r;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    return idx;
  };

  for (const side of [-1, 1]) {
    const y = 0.39;
    const root = pivot(side < 0 ? 'wingRootL' : 'wingRootR', torso, side * 0.1, y, torsoRadius(y) * TORSO_DEPTH - 0.025);
    // Wing frame: X span, Y dorsal (= torso back), Z trailing (= toward the tail).
    root.rotation.x = Math.PI / 2;
    const shoulder = pivot('wingShoulder', root);
    shoulder.add(mesh(ball, materials.wingBone, [0, 0, 0], [0.042, 0.042, 0.042]));
    const humerus = mesh(humerusGeo, materials.wingBone);
    if (side < 0) humerus.rotation.y = Math.PI;
    shoulder.add(humerus);

    const elbow = pivot('wingElbow', shoulder, side * HUMERUS, 0, 0);
    elbow.add(mesh(ball, materials.wingBone, [0, 0, 0], [0.028, 0.028, 0.028]));
    const forearm = mesh(wingForearmGeo, materials.wingBone);
    if (side < 0) forearm.rotation.y = Math.PI;
    elbow.add(forearm);

    const wrist = pivot('wingWrist', elbow, side * FOREARM, 0, 0);
    wrist.add(mesh(ball, materials.wingBone, [0, 0, 0], [0.026, 0.026, 0.026]));
    // Wrist thumb claw pointing toward the leading edge
    wrist.add(mesh(clawGeo, materials.horn, [side * 0.01, 0, -0.015], [0.011, 0.055, 0.011], [-Math.PI / 2, 0, -side * 0.5]));

    const fingers: THREE.Group[] = [];
    FINGER_LEN.forEach((len, k) => {
      const finger = pivot(`wingFinger${k + 1}`, wrist);
      const bone = mesh(fingerGeos[k], materials.wingBone);
      if (side < 0) bone.rotation.y = Math.PI;
      finger.add(bone);
      // Trailing aurora feather tip
      const vane = mesh(tipVaneGeo, materials.crest, [side * (len - 0.015), 0, 0]);
      if (side < 0) vane.rotation.y = Math.PI;
      finger.add(vane);
      fingers.push(finger);
    });

    const membraneGeo = geo(new THREE.BufferGeometry());
    const membranePos = new THREE.BufferAttribute(new Float32Array(MEMBRANE_COLS * MEMBRANE_ROWS * 3), 3);
    membranePos.setUsage(THREE.DynamicDrawUsage);
    const uvs: number[] = [];
    for (let c = 0; c < MEMBRANE_COLS; c++) {
      const u =
        c <= MEMBRANE_INNER_COLS
          ? (c / MEMBRANE_INNER_COLS) * 0.5
          : 0.5 + ((c - MEMBRANE_INNER_COLS) / MEMBRANE_OUTER_COLS) * 0.5;
      for (let r = 0; r < MEMBRANE_ROWS; r++) uvs.push(u, r / (MEMBRANE_ROWS - 1));
    }
    membraneGeo.setAttribute('position', membranePos);
    membraneGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    membraneGeo.setIndex(membraneIndex(side));
    const membrane = new THREE.Mesh(membraneGeo, materials.wingMembrane);
    membrane.name = 'wingMembrane';
    membrane.frustumCulled = false;
    root.add(membrane);

    wings.push({ side, root, shoulder, elbow, wrist, fingers, membrane, membraneGeo, membranePos });
  }

  // -------------------------------------------------------------------------
  // Animation scratch state
  // -------------------------------------------------------------------------
  const qA = new THREE.Quaternion();
  const qB = new THREE.Quaternion();
  const qC = new THREE.Quaternion();
  const qSh = new THREE.Quaternion();
  const qEl = new THREE.Quaternion();
  const qWr = new THREE.Quaternion();
  const qElW = new THREE.Quaternion();
  const qWrW = new THREE.Quaternion();
  const qFinger = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];
  const pE = new THREE.Vector3();
  const pW = new THREE.Vector3();
  const pF = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const tmpV = new THREE.Vector3();
  const lead = new THREE.Vector3();
  const trail = new THREE.Vector3();
  const colLead: THREE.Vector3[] = Array.from({ length: MEMBRANE_COLS }, () => new THREE.Vector3());
  const colTrail: THREE.Vector3[] = Array.from({ length: MEMBRANE_COLS }, () => new THREE.Vector3());
  const colNormal = new THREE.Vector3();
  const spanDir = new THREE.Vector3();
  const chordDir = new THREE.Vector3();
  const pose: WingPose = { ...POSE_FOLD };
  const poseOpen: WingPose = { ...POSE_FLY };
  const legOut: LegAngles = { roll: 0, hip: 0, knee: 0, ankle: 0, foot: 0 };
  const torsoQ = new THREE.Quaternion();
  const gravityT = new THREE.Vector3();
  const windT = new THREE.Vector3();
  const ribbonDir = new THREE.Vector3();
  const ribbonP = new THREE.Vector3();
  const ribbonW = new THREE.Vector3();
  const ribbonN = new THREE.Vector3();

  let gaitPhase = 0;
  let wingPhase = 0;
  let flyBlend = 0;
  let airBlend = 0;
  let moveBlend = 0;
  let wingOpen = 0;
  let soarK = 0;
  let boostK = 0;
  let sprintK = 0;
  let rising = 0;
  let gaitSpeed = 0;
  let dirX = 0;
  let dirZ = -1;
  let smoothTurn = 0;
  let smoothStrafe = 0;
  let flightPitch = 0;
  let flightBank = 0;
  let headYaw = 0;
  let prevStroke = 0;
  let blinkTimer = 2.2;
  let blinkT = -1;
  let jawOpen = 0;
  let excite = 0;

  // ---------------------------------------------------------------------------
  // Leg IK: digitigrade chain (thigh, shin, metatarsal) reaching a ball-of-foot target.
  // Angles are absolute sagittal angles where 0 hangs straight down and + swings forward (-Z).
  // ---------------------------------------------------------------------------
  const solveLeg = (tx: number, ty: number, tz: number, metaAbs: number, footAbs: number, out: LegAngles) => {
    const down = Math.max(1e-4, -ty);
    out.roll = Math.atan2(tx, down);
    const d = Math.hypot(tx, down);
    let ad = d - META * Math.cos(metaAbs);
    let az = tz + META * Math.sin(metaAbs);
    const raw = Math.hypot(ad, az);
    const reach = clamp(raw, 0.12, THIGH + SHIN - 0.004);
    if (raw > 1e-6) {
      ad *= reach / raw;
      az *= reach / raw;
    } else {
      ad = reach;
      az = 0;
    }
    const phi = Math.atan2(-az, ad);
    const cosA = clamp((THIGH * THIGH + reach * reach - SHIN * SHIN) / (2 * THIGH * reach), -1, 1);
    const theta1 = phi + Math.acos(cosA);
    const kd = THIGH * Math.cos(theta1);
    const kz = -THIGH * Math.sin(theta1);
    const theta2 = Math.atan2(-(az - kz), ad - kd);
    out.hip = theta1;
    out.knee = theta2 - theta1;
    out.ankle = metaAbs - theta2;
    out.foot = footAbs - metaAbs;
    return out;
  };

  // ---------------------------------------------------------------------------
  // Wing chain: drive joints from a pose and rebuild the membrane from the bones.
  // ---------------------------------------------------------------------------
  const applyWing = (w: WingRig, p: Readonly<WingPose>, billow: number, fold: number) => {
    // Right-wing quaternions in the wingRoot frame
    axisQuat(qSh, AXIS_Z, p.elev)
      .multiply(axisQuat(qA, AXIS_Y, -p.sweep))
      .multiply(axisQuat(qB, AXIS_X, p.twist));
    axisQuat(qEl, AXIS_Y, p.flex)
      .multiply(axisQuat(qA, AXIS_Z, p.bendE))
      .multiply(axisQuat(qB, AXIS_X, p.twistE));
    axisQuat(qWr, AXIS_Y, -p.wristBack).multiply(axisQuat(qA, AXIS_Z, p.bendW));
    axisQuat(qFinger[0], AXIS_Y, 0);
    axisQuat(qFinger[1], AXIS_Y, -p.fan2);
    axisQuat(qFinger[2], AXIS_Y, -p.fan3);

    // Joint positions (right-wing space)
    pE.set(HUMERUS, 0, 0).applyQuaternion(qSh);
    qElW.copy(qSh).multiply(qEl);
    pW.set(FOREARM, 0, 0).applyQuaternion(qElW).add(pE);
    qWrW.copy(qElW).multiply(qWr);
    for (let k = 0; k < 3; k++) {
      qC.copy(qWrW).multiply(qFinger[k]);
      pF[k].set(FINGER_LEN[k], 0, 0).applyQuaternion(qC).add(pW);
    }

    // Push joint rotations to the scene graph (mirrored for the left wing)
    const mirror = w.side < 0;
    w.shoulder.quaternion.copy(qSh);
    w.elbow.quaternion.copy(qEl);
    w.wrist.quaternion.copy(qWr);
    for (let k = 0; k < 3; k++) w.fingers[k].quaternion.copy(qFinger[k]);
    if (mirror) {
      mirrorQuat(w.shoulder.quaternion);
      mirrorQuat(w.elbow.quaternion);
      mirrorQuat(w.wrist.quaternion);
      for (const f of w.fingers) mirrorQuat(f.quaternion);
    }

    // Leading / trailing edge per column
    const H = MEMBRANE_BODY_ATTACH;
    const shoulderShare = HUMERUS / (HUMERUS + FOREARM);
    for (let c = 0; c <= MEMBRANE_INNER_COLS; c++) {
      const s = c / MEMBRANE_INNER_COLS;
      if (s <= shoulderShare) lead.set(0, 0, 0).lerp(pE, s / shoulderShare);
      else lead.copy(pE).lerp(pW, (s - shoulderShare) / (1 - shoulderShare));
      trail.copy(H).lerp(pF[2], s);
      // Scalloped inner trailing edge curving toward the leading edge
      trail.lerp(lead, 0.2 * Math.sin(Math.PI * s));
      colLead[c].copy(lead);
      colTrail[c].copy(trail);
    }
    for (let c = 1; c <= MEMBRANE_OUTER_COLS; c++) {
      const s = c / MEMBRANE_OUTER_COLS;
      const col = MEMBRANE_INNER_COLS + c;
      lead.copy(pW).lerp(pF[0], s);
      let local: number;
      if (s <= 0.5) {
        local = s / 0.5;
        trail.copy(pF[2]).lerp(pF[1], local);
      } else {
        local = (s - 0.5) / 0.5;
        trail.copy(pF[1]).lerp(pF[0], local);
      }
      trail.lerp(lead, 0.24 * Math.sin(Math.PI * local) * (1 - 0.3 * s));
      colLead[col].copy(lead);
      colTrail[col].copy(trail);
    }

    // Fill the grid (v = 0 trailing → v = 1 leading), with billow along the local membrane normal
    const arr = w.membranePos.array as Float32Array;
    for (let c = 0; c < MEMBRANE_COLS; c++) {
      const prev = colLead[Math.max(0, c - 1)];
      const next = colLead[Math.min(MEMBRANE_COLS - 1, c + 1)];
      spanDir.subVectors(next, prev);
      chordDir.subVectors(colLead[c], colTrail[c]);
      colNormal.crossVectors(spanDir, chordDir);
      const nLen = colNormal.length();
      if (nLen > 1e-6) colNormal.multiplyScalar(1 / nLen);
      else colNormal.set(0, 1, 0);
      const u = c / (MEMBRANE_COLS - 1);
      const chord = chordDir.length();
      for (let r = 0; r < MEMBRANE_ROWS; r++) {
        const v = r / (MEMBRANE_ROWS - 1);
        tmpV.copy(colTrail[c]).lerp(colLead[c], v);
        const bulge = Math.sin(Math.PI * v) * Math.sin(Math.PI * Math.min(1, u * 1.15));
        const offset = bulge * chord * billow + fold * 0.014 * Math.sin(Math.PI * v) * (0.4 + u);
        tmpV.addScaledVector(colNormal, offset);
        const i = (c * MEMBRANE_ROWS + r) * 3;
        arr[i] = mirror ? -tmpV.x : tmpV.x;
        arr[i + 1] = tmpV.y;
        arr[i + 2] = tmpV.z;
      }
    }
    w.membranePos.needsUpdate = true;
    w.membraneGeo.computeVertexNormals();
    w.membraneGeo.boundingBox = null;
    w.membraneGeo.boundingSphere = null;
  };

  // ---------------------------------------------------------------------------
  // Scarf tails: ribbon centreline bent by gravity + apparent wind, with flutter.
  // ---------------------------------------------------------------------------
  const updateScarf = (elapsed: number, windSpeed: number) => {
    const vertsPerSheet = (SCARF_SEGMENTS + 1) * 2;
    const segLen = SCARF_LENGTH / SCARF_SEGMENTS;
    const windK = clamp(windSpeed / 7, 0, 3.2);
    const flutterFreq = 4 + Math.min(windSpeed, 30) * 0.55;
    const flutterAmp = 0.06 + 0.3 * clamp(windSpeed / 14, 0, 1);
    for (const tail of scarfTails) {
      const arr = tail.pos.array as Float32Array;
      ribbonP.set(0, 0, 0);
      for (let i = 0; i <= SCARF_SEGMENTS; i++) {
        const t = i / SCARF_SEGMENTS;
        // Emerge from the knot heading back & slightly outward, then hang with gravity / stream with wind
        ribbonDir.set(tail.side * 0.25, -0.35, 1).multiplyScalar(1 - smooth01(t * 2.2));
        ribbonDir.addScaledVector(gravityT, 0.6 + t);
        ribbonDir.addScaledVector(windT, windK * (0.4 + t));
        const wave = Math.sin(elapsed * flutterFreq - i * 0.75 + tail.side * 0.9);
        ribbonDir.x += wave * flutterAmp * t * 1.6 + tail.side * 0.12 * t;
        ribbonDir.y += Math.cos(elapsed * flutterFreq * 0.7 - i * 0.6) * flutterAmp * t * 0.8;
        if (ribbonDir.lengthSq() < 1e-8) ribbonDir.set(0, -1, 0);
        ribbonDir.normalize();
        if (i > 0) ribbonP.addScaledVector(ribbonDir, segLen);
        // Width runs side to side, twisting gently with the flutter
        ribbonW.set(1, 0, 0).addScaledVector(ribbonDir, -ribbonDir.x);
        ribbonW.y += wave * 0.35 * t;
        if (ribbonW.lengthSq() < 1e-8) ribbonW.set(0, 0, 1);
        ribbonW.normalize();
        ribbonN.crossVectors(ribbonDir, ribbonW).normalize();
        const halfW = 0.036 - 0.01 * t + 0.008 * Math.sin(t * Math.PI);
        for (let sheet = 0; sheet < 2; sheet++) {
          const thick = sheet === 0 ? 0.0035 : -0.0035;
          for (let k = 0; k < 2; k++) {
            const sgn = k === 0 ? -1 : 1;
            const idx = (sheet * vertsPerSheet + i * 2 + k) * 3;
            arr[idx] = ribbonP.x + ribbonW.x * halfW * sgn + ribbonN.x * thick;
            arr[idx + 1] = ribbonP.y + ribbonW.y * halfW * sgn + ribbonN.y * thick;
            arr[idx + 2] = ribbonP.z + ribbonW.z * halfW * sgn + ribbonN.z * thick;
          }
        }
      }
      tail.pos.needsUpdate = true;
      tail.geo.computeVertexNormals();
      tail.geo.boundingBox = null;
      tail.geo.boundingSphere = null;
    }
  };

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------
  const update = (dt: number, elapsed: number, motion: AvatarMotionState) => {
    const step = Number.isFinite(dt) ? clamp(dt, 0, 0.05) : 0;
    const time = Number.isFinite(elapsed) ? elapsed : 0;

    const flying = motion.isFlying;
    const grounded = motion.grounded && !flying;
    const fwd = Number.isFinite(motion.forwardSpeed) ? motion.forwardSpeed : 0;
    const strafe = Number.isFinite(motion.strafeSpeed) ? motion.strafeSpeed : 0;
    const velY = Number.isFinite(motion.velocityY) ? motion.velocityY : 0;
    const speed = Number.isFinite(motion.speed) ? Math.max(0, motion.speed) : 0;
    const boost = clamp(motion.boost || 0, 0, 1);
    const turn = clamp(motion.turnRate || 0, -4, 4);
    const lookPitch = clamp(motion.pitch || 0, -1.2, 1.2);
    const land = clamp(motion.landImpact || 0, 0, 1);

    // --- state blends ---------------------------------------------------------
    flyBlend = damp(flyBlend, flying ? 1 : 0, 6, step);
    airBlend = damp(airBlend, !grounded && !flying ? 1 : 0, 9, step);
    const planarSpeed = Math.hypot(fwd, strafe) || speed;
    const groundSpeed = grounded ? Math.min(planarSpeed, 18) : 0;
    moveBlend = damp(moveBlend, clamp(groundSpeed / 1.2, 0, 1), 9, step);
    gaitSpeed = damp(gaitSpeed, groundSpeed, 8, step);
    soarK = damp(soarK, clamp((speed - 4) / 11, 0, 1), 3.2, step);
    boostK = damp(boostK, flying ? boost : 0, 5, step);
    sprintK = damp(sprintK, grounded ? Math.max(boost, clamp((planarSpeed - 9) / 5, 0, 1)) : 0, 5, step);
    rising = damp(rising, clamp(velY / 7.8, -1, 1), 8, step);
    smoothTurn = damp(smoothTurn, turn, 7, step);
    smoothStrafe = damp(smoothStrafe, clamp(strafe, -12, 12), 7, step);
    wingOpen = damp(wingOpen, Math.max(airBlend, flyBlend), 6.5, step);

    if (planarSpeed > 0.25) {
      const tx = strafe / planarSpeed;
      const tz = -fwd / planarSpeed;
      if (Number.isFinite(tx) && Number.isFinite(tz) && Math.abs(tx) + Math.abs(tz) > 1e-3) {
        dirX = damp(dirX, tx, 10, step);
        dirZ = damp(dirZ, tz, 10, step);
      }
    }
    const dirLen = Math.hypot(dirX, dirZ) || 1;
    const ndx = dirX / dirLen;
    const ndz = dirZ / dirLen;

    const groundW = (1 - flyBlend) * (1 - airBlend);
    const jumpW = (1 - flyBlend) * airBlend;

    // --- gait timing (stance travel matches ground speed: no foot skating) ------
    const gv = gaitSpeed;
    const cadence = clamp(1.0 + 0.12 * gv, 1.0, 2.8);
    const stride = Math.min(0.92, 0.26 + 0.1 * gv);
    const duty = gv > 0.05 ? clamp((stride * cadence) / gv, 0.16, 0.64) : 0.6;
    const travel = Math.min(0.95, gv > 0.05 ? (gv * duty) / cadence : 0);
    gaitPhase = (gaitPhase + cadence * step * (moveBlend > 0.01 ? 1 : 0)) % 1;
    const runK = clamp(gv / 8, 0, 1.4);

    // --- pelvis height, bob & landing squash ----------------------------------
    const bobPhase = TAU * 2 * (gaitPhase - duty * 0.5);
    const bob = -Math.cos(bobPhase) * (0.015 + 0.03 * runK) * moveBlend * groundW;
    const breath = Math.sin(time * 2.1) * 0.008;
    const crouch = 0.05 * Math.min(runK, 1.2) * moveBlend + land * 0.15 * (1 - flyBlend);
    const pelvisY = HIP_HEIGHT - COM_HEIGHT + bob - crouch + breath * (1 - moveBlend) * groundW;
    legRoot.position.y = pelvisY;
    bodyPivot.position.y = pelvisY;
    const squash = land * 0.12 * (1 - flyBlend);
    bodyPivot.scale.set(1 + squash * 0.45, 1 - squash * 0.6, 1 + squash * 0.45);

    // --- whole-body flight pitch & bank -----------------------------------------
    const hoverPitch = -0.5;
    const soarPitch = -1.18;
    const boostPitch = -1.38;
    let targetPitch = lerp(hoverPitch, soarPitch, soarK);
    targetPitch = lerp(targetPitch, boostPitch, boostK);
    targetPitch += lookPitch * 0.62 + clamp(velY * 0.025, -0.25, 0.25);
    targetPitch = clamp(targetPitch, -1.55, 0.25);
    const jumpPitch = -0.1 - clamp(rising, -1, 1) * 0.06;
    flightPitch = damp(flightPitch, targetPitch * flyBlend + jumpPitch * jumpW, 5, step);
    const bankTarget =
      (clamp(smoothTurn * (0.3 + boostK * 0.12), -0.85, 0.85) - clamp(smoothStrafe * 0.035, -0.35, 0.35)) * flyBlend +
      clamp(smoothTurn * 0.08, -0.25, 0.25) * jumpW;
    flightBank = damp(flightBank, bankTarget, 5, step);

    const flapLift = -Math.sin(wingPhase) * 0.045 * flyBlend * (1 - boostK * 0.8);
    rigRoot.position.y = COM_HEIGHT + flapLift + Math.sin(time * 1.7) * 0.02 * flyBlend * (1 - soarK);
    rigRoot.rotation.set(flightPitch, 0, flightBank);

    // --- pelvis / torso posture on the ground ---------------------------------
    const groundLean = -0.08 * Math.min(runK, 1.2) * moveBlend - 0.1 * sprintK;
    const sway = Math.sin(TAU * gaitPhase) * 0.05 * moveBlend * groundW;
    const groundBank = clamp(smoothTurn * 0.07, -0.18, 0.18) - clamp(smoothStrafe * 0.012, -0.12, 0.12);
    bodyPivot.rotation.set(
      groundLean * groundW - land * 0.12 * (1 - flyBlend),
      Math.sin(TAU * gaitPhase) * 0.07 * moveBlend * groundW,
      (groundBank + sway) * groundW,
    );
    torso.rotation.x = TORSO_LEAN + breath * 0.6 - 0.05 * sprintK + rising * 0.06 * jumpW - 0.06 * boostK;
    torso.rotation.y = -Math.sin(TAU * gaitPhase) * 0.08 * moveBlend * groundW;
    torso.scale.set(1 + breath * 0.5, 1, 1 + breath * 0.8);

    // --- legs ---------------------------------------------------------------------
    const groundY = -(rigRoot.position.y + legRoot.position.y);
    const lift = (0.07 + 0.06 * Math.min(runK, 1.3)) * moveBlend;
    const legPhaseOut: number[] = [0, 0];
    for (let li = 0; li < legs.length; li++) {
      const leg = legs[li];
      const p = (gaitPhase + (leg.side > 0 ? 0.5 : 0)) % 1;
      let o: number;
      let ly = 0;
      let metaAbs = META_REST;
      let footAbs = 0;
      if (p < duty) {
        const s = p / duty;
        o = 0.5 - s;
        metaAbs = META_REST - 0.18 * Math.max(0, s - 0.6) * moveBlend;
      } else {
        const t = (p - duty) / (1 - duty);
        o = -0.5 + smooth01(t);
        const arc = Math.sin(Math.PI * t);
        ly = lift * arc;
        metaAbs = META_REST - 0.75 * arc * moveBlend;
        footAbs = (-0.6 * arc + 0.15 * Math.max(0, t - 0.75) * 4 * (1 - t)) * moveBlend;
      }
      legPhaseOut[li] = o;
      const reach = o * travel * moveBlend;
      const tx = leg.side * 0.025 + ndx * reach;
      const tz = -0.015 + ndz * reach;
      const ty = groundY + FOOT_PAD + ly;
      solveLeg(tx, ty, tz, metaAbs, footAbs, legOut);
      const gRoll = legOut.roll;
      const gHip = legOut.hip;
      const gKnee = legOut.knee;
      const gAnkle = legOut.ankle;
      const gFoot = legOut.foot;

      // Airborne jump: tucked while rising, reaching down to land while falling
      const up = Math.max(0, rising);
      const down = Math.max(0, -rising);
      const jHip = 0.55 + up * 0.55 - down * 0.25 + (leg.side > 0 ? 0.12 : -0.08);
      const jKnee = -(1.05 + up * 0.6 - down * 0.4);
      const jAnkle = 0.75 + up * 0.25 - down * 0.2;
      const jFoot = -0.35 - up * 0.2 + down * 0.15;

      // Flight: streamlined trailing legs with a lazy alternating paddle
      const kick = Math.sin(time * 3.2 + leg.side * 1.5) * 0.12 * (1 - boostK);
      const fHip = lerp(0.42, 0.12, soarK) - 0.14 * boostK + kick;
      const fKnee = -lerp(1.0, 0.75, soarK) + 0.4 * boostK;
      const fAnkle = lerp(0.7, 0.55, soarK) - 0.2 * boostK;
      const fFoot = -0.55 - 0.35 * boostK;

      leg.hip.rotation.set(
        gHip * groundW + jHip * jumpW + fHip * flyBlend,
        0,
        gRoll * groundW + leg.side * (0.06 * jumpW + 0.05 * flyBlend),
      );
      leg.knee.rotation.x = gKnee * groundW + jKnee * jumpW + fKnee * flyBlend;
      leg.ankle.rotation.x = gAnkle * groundW + jAnkle * jumpW + fAnkle * flyBlend;
      leg.foot.rotation.x = gFoot * groundW + jFoot * jumpW + fFoot * flyBlend;
    }

    // --- arms -----------------------------------------------------------------------
    for (const arm of arms) {
      const opposite = arm.side > 0 ? legPhaseOut[0] : legPhaseOut[1];
      const swing = opposite * (0.9 + 0.5 * Math.min(runK, 1.3)) * moveBlend;
      const idle = Math.sin(time * 1.9 + arm.side) * 0.04;
      const gShX = 0.22 + swing + idle - 0.15 * sprintK;
      const gShZ = arm.side * 0.14;
      const gEl = 0.55 + 0.35 * Math.min(runK, 1.2) * moveBlend + Math.max(0, swing) * 0.4 + 0.3 * sprintK;
      // Jump: arms thrown out for balance
      const jShX = 0.55 + Math.max(0, rising) * 0.3;
      const jShZ = arm.side * (0.45 + Math.max(0, -rising) * 0.25);
      const jEl = 0.45;
      // Flight: tucked against the chest
      const fShX = 0.12 - 0.2 * boostK;
      const fShZ = arm.side * 0.04;
      const fEl = 1.85 - 0.15 * boostK;
      arm.shoulder.rotation.set(
        gShX * groundW + jShX * jumpW + fShX * flyBlend,
        0,
        gShZ * groundW + jShZ * jumpW + fShZ * flyBlend,
      );
      arm.elbow.rotation.x = gEl * groundW + jEl * jumpW + fEl * flyBlend;
      arm.hand.rotation.x = -0.2 + 0.35 * flyBlend;
    }

    // --- neck & head (counter the body pitch so Zephyr keeps looking ahead) -----
    const bodyPitch = flightPitch + torso.rotation.x + bodyPivot.rotation.x;
    const counter = -bodyPitch * 0.88 - lookPitch * 0.25 * flyBlend;
    const idleLook = Math.sin(time * 0.43) * 0.22 * (1 - moveBlend) * groundW;
    headYaw = damp(headYaw, clamp(smoothTurn * 0.22, -0.5, 0.5) + idleLook, 6, step);
    const nod = Math.sin(TAU * 2 * gaitPhase) * 0.05 * moveBlend * groundW + Math.sin(time * 1.3) * 0.025;
    neckPivot.rotation.set(counter * 0.45 - 0.05, headYaw * 0.4, -flightBank * 0.25);
    headPivot.rotation.set(
      counter * 0.55 + nod + 0.04 + (lookPitch * 0.3 * groundW),
      headYaw * 0.6,
      -flightBank * 0.35 + Math.sin(time * 0.9) * 0.05 * (1 - moveBlend) * groundW,
    );

    // Excited open-mouth grin when boosting / launching, gentle breathing otherwise
    excite = damp(excite, clamp(boostK * 1.1 + Math.max(0, rising) * 0.5 * jumpW + sprintK * 0.4, 0, 1), 6, step);
    jawOpen = damp(jawOpen, 0.035 + Math.max(0, Math.sin(time * 2.1)) * 0.03 + excite * 0.34, 10, step);
    jawPivot.rotation.x = -jawOpen;

    // Blinks (double-blink now and then) and wide eyes when excited
    blinkTimer -= step;
    if (blinkTimer <= 0) {
      blinkT = 0;
      const r = Math.sin(time * 12.9898) * 43758.5453;
      blinkTimer = 2.2 + (r - Math.floor(r)) * 3.4;
    }
    let closed = 0;
    if (blinkT >= 0) {
      blinkT += step;
      const dur = 0.16;
      closed = Math.sin(clamp(blinkT / dur, 0, 1) * Math.PI);
      if (blinkT >= dur) blinkT = -1;
    }
    const openAngle = 0.88 + excite * 0.3 - flyBlend * 0.08 * (1 - excite);
    for (const eye of eyes) {
      eye.lid.rotation.x = lerp(openAngle, -1.45, closed);
      eye.group.rotation.y = -eye.side * 0.52 + headYaw * 0.25;
    }

    // Aurora frills flare in flight & boost
    const flare = 0.15 * groundW + 0.5 * flyBlend + 0.35 * boostK + 0.3 * jumpW + Math.sin(time * 3.1) * 0.04;
    const streamBack = 0.25 * soarK * flyBlend + 0.25 * boostK;
    for (const c of crests) {
      const flutter = Math.sin(time * (5 + boostK * 9) + c.side) * 0.05 * (0.4 + flyBlend);
      c.ear.rotation.set(-0.3 + streamBack * 0.6 + flutter, c.side * (0.55 + flare * 0.8 - streamBack), 0);
      c.cheek.rotation.set(0.35 - streamBack * 0.3 - flutter, c.side * (0.7 + flare - streamBack * 0.6), 0);
    }
    headCrest.rotation.x = -0.1 + streamBack * 0.6 + Math.sin(time * 2.2) * 0.04;

    // --- tail -------------------------------------------------------------------------
    const tailFreq = moveBlend > 0.05 ? TAU * cadence : 1.6 + flyBlend * 1.2;
    const swayAmp = (0.1 + 0.08 * moveBlend) * groundW + 0.08 * jumpW + 0.07 * flyBlend * (1 - boostK * 0.6);
    for (let i = 0; i < tailSegs.length; i++) {
      const seg = tailSegs[i];
      const phase = time * tailFreq - i * 0.85;
      const w = 0.6 + i * 0.3;
      const whip = smoothTurn * (0.07 + i * 0.03) * (0.6 + flyBlend);
      const undulate = Math.sin(phase * 0.8 + 1.2) * 0.06 * flyBlend * w;
      // In flight the tail streams level behind the body whatever its pitch
      const flyX = i === 0 ? lerp(TAIL_FLY[0], clamp(-bodyPitch + 0.08, 0.3, 1.75), Math.max(soarK, boostK)) : TAIL_FLY[i];
      const restX = lerp(TAIL_REST[i], flyX, flyBlend);
      const jumpX = i === 0 ? -rising * 0.18 * jumpW : 0;
      seg.rotation.set(
        restX + undulate + jumpX - (i === 0 ? land * 0.25 : 0) + (i === 0 ? -0.1 * sprintK : 0),
        Math.sin(phase) * swayAmp * w + whip,
        -flightBank * 0.12,
      );
    }
    tailVane.rotation.set(Math.sin(time * tailFreq - 3.6) * 0.1, Math.sin(time * tailFreq - 3.4) * 0.15, 0);

    // --- wings ------------------------------------------------------------------------
    // Base pose: folded mantle → jump display / flight spread → swept boost delta
    mixPose(poseOpen, POSE_JUMP, POSE_FLY, flyBlend);
    // Falling jumps hold the wings high like a parachute
    poseOpen.sweep -= Math.max(0, -rising) * 0.25 * jumpW;
    mixPose(pose, POSE_FOLD, poseOpen, smooth01(wingOpen));
    mixPose(pose, pose, POSE_BOOST, boostK);

    // Wingbeat frequency & amplitude per mode
    const glide = clamp(0.5 + velY * 0.12 + 0.4 * Math.sin(time * 0.55), 0, 1);
    const flyFreq = lerp(2.5, 1.45, soarK);
    const flyAmp = lerp(0.95, 0.38 * (0.35 + 0.65 * glide), soarK);
    const jumpFreq = 2.3;
    const jumpAmp = 0.35 + Math.max(0, rising) * 0.45 - Math.max(0, -rising) * 0.15;
    let freq = lerp(jumpFreq, flyFreq, flyBlend);
    let amp = lerp(jumpAmp, flyAmp, flyBlend) * wingOpen;
    freq = lerp(freq, 4.8, boostK);
    amp = lerp(amp, 0.05, boostK);
    wingPhase = (wingPhase + TAU * freq * step) % (TAU * 1000);

    const strokeS = Math.sin(wingPhase);
    const strokeC = Math.cos(wingPhase);
    // Stroke plane: in-plane when the body is upright, about the chord axis when horizontal
    const horiz = clamp(-bodyPitch / 1.25, 0, 1);
    const stroke = amp * strokeS;
    pose.elev += stroke * horiz;
    pose.sweep -= stroke * (1 - horiz);
    // Figure-8: pronate on the downstroke, small fore-aft loop
    pose.twist += amp * 0.38 * strokeC;
    pose.sweep += amp * 0.12 * Math.sin(wingPhase * 2);
    // Elbow / wrist phase lag
    const lagE = amp * 0.42 * Math.sin(wingPhase - 0.6);
    const lagW = amp * 0.5 * Math.sin(wingPhase - 1.15);
    pose.bendE += lagE * horiz;
    pose.flex += lagE * (1 - horiz);
    pose.bendW += lagW * horiz;
    pose.wristBack -= lagW * (1 - horiz);
    // Partial fold on the upstroke
    const upFold = Math.max(0, strokeC) * amp * wingOpen;
    pose.flex += upFold * 0.45;
    pose.wristBack += upFold * 0.5;
    pose.fan2 -= upFold * 0.15;
    pose.fan3 -= upFold * 0.25;
    // Folded breathing + gait bounce
    const foldW = 1 - wingOpen;
    pose.elev += foldW * (Math.sin(time * 1.3) * 0.025 + bob * 0.8);
    pose.wristBack += foldW * Math.sin(time * 1.3 + 0.6) * 0.03;
    // Boost shiver
    pose.twist += boostK * Math.sin(time * 31) * 0.015;

    const strokeVel = (stroke - prevStroke) / Math.max(step, 1e-3);
    prevStroke = stroke;
    const billow = (0.05 * wingOpen + clamp(-strokeVel * 0.012, -0.05, 0.05) * wingOpen) * (1 - boostK * 0.6) + 0.02 * foldW;
    for (const w of wings) applyWing(w, pose, billow, foldW);

    // --- scarf tails ------------------------------------------------------------------
    torsoQ.copy(rigRoot.quaternion).multiply(bodyPivot.quaternion).multiply(torso.quaternion).invert();
    gravityT.set(0, -1, 0).applyQuaternion(torsoQ);
    windT.set(-strafe, -velY, fwd);
    const windSpeed = windT.length();
    if (windSpeed > 1e-4) windT.multiplyScalar(1 / windSpeed).applyQuaternion(torsoQ);
    else windT.set(0, 0, 0);
    updateScarf(time, windSpeed);

    materials.update(step, time, motion);
  };

  update(0, 0, IDLE_MOTION_STATE);

  return {
    group,
    setAccentColor: (hexColor: string) => materials.setAccentColor(hexColor),
    update,
    dispose: () => {
      for (const g of geometries) g.dispose();
      geometries.length = 0;
      materials.dispose();
    },
  };
}
