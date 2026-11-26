import * as THREE from 'three/webgpu';
import {
  Fn,
  cameraPosition,
  clamp,
  dot,
  float,
  length,
  max,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';
import { IDLE_MOTION_STATE, type AvatarMotionState, type CharacterRig } from './types';

const YELLOW = '#ffc21a';
const BLACK = '#1c1410';

/** Scale that converts the Honey Hood bee proportions (~5.6 units tall) to ~1.72 m explorer height. */
const BEE_SCALE = 0.305;
/** Vertical lift inside scaled space so the soles of the shoes sit cleanly at Y = 0. */
const STANDING_BODY_Y = 2.94;

/** Radius of the blue suit jacket from hem to collar (matching Honey Hood bee). */
const JACKET_PROFILE: Array<[number, number]> = [
  [1.0, -0.98],
  [1.22, -0.78],
  [1.24, -0.35],
  [1.16, 0.15],
  [0.98, 0.52],
  [0.62, 0.78],
];

function jacketRadius(y: number): number {
  for (let i = 1; i < JACKET_PROFILE.length; i++) {
    const [r1, y1] = JACKET_PROFILE[i];
    if (y <= y1) {
      const [r0, y0] = JACKET_PROFILE[i - 1];
      return r0 + (r1 - r0) * Math.max(0, (y - y0) / (y1 - y0));
    }
  }
  return JACKET_PROFILE[JACKET_PROFILE.length - 1][0];
}

/** Deterministic PRNG so every bee instance has identical lush fur placement with zero flicker. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Curved strip hugging the front (+Z) of the blue jacket.
 * `edges(t)` returns [leftAngle, rightAngle] in radians from straight ahead.
 */
function frontPanel(
  bottom: number,
  top: number,
  lift: number,
  edges: (t: number) => [number, number],
  rows = 14,
  columns = 6,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const y = bottom + (top - bottom) * t;
    const [left, right] = edges(t);
    const radius = jacketRadius(y) + lift;
    for (let column = 0; column <= columns; column++) {
      const angle = left + ((right - left) * column) / columns;
      positions.push(Math.sin(angle) * radius, y, Math.cos(angle) * radius);
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * stride + column;
      indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Short spiky bee fur cones standing out from an ellipsoid surface. */
function buildFuzz(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  center: THREE.Vector3,
  radii: THREE.Vector3,
  count: number,
  colorAt: (unit: THREE.Vector3) => string,
  keep: (unit: THREE.Vector3) => boolean,
  rand: () => number,
): THREE.InstancedMesh {
  const hairs = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const unit = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    do {
      unit.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    } while (unit.lengthSq() > 1 || unit.lengthSq() < 0.05 || !keep(unit.normalize()));
    normal.copy(unit).divide(radii).normalize();
    dummy.position.copy(unit).multiply(radii).add(center).addScaledVector(normal, 0.07);
    normal.y -= 0.35;
    dummy.quaternion.setFromUnitVectors(up, normal.normalize());
    dummy.scale.setScalar(0.65 + rand() * 0.7);
    dummy.updateMatrix();
    hairs.setMatrixAt(i, dummy.matrix);
    hairs.setColorAt(i, color.set(colorAt(unit)));
  }
  hairs.instanceMatrix.needsUpdate = true;
  if (hairs.instanceColor) hairs.instanceColor.needsUpdate = true;
  return hairs;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function makeMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...position);
  m.scale.set(...scale);
  return m;
}

function createWingMaterial() {
  const wingGlow = uniform(0.0);
  const wingBoost = uniform(0.0);
  const mat = new THREE.MeshStandardNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.14,
    metalness: 0.08,
  });

  const out = Fn(() => {
    const p = uv().sub(0.5).mul(2.0);
    const r = length(p);
    const veinPrimary = smoothstep(float(0.055), float(0.015), p.y.abs());
    const veinArc = smoothstep(float(0.045), float(0.01), p.y.sub(sin(p.x.mul(3.4)).mul(0.28)).abs());
    const vein = max(veinPrimary.mul(0.55), veinArc.mul(0.35));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = max(dot(normalWorld.abs(), viewDir), 0.0);
    const fresnel = pow(float(1.0).sub(ndotv), 2.4);

    const shimmerPhase = sin(p.x.mul(7.0).add(p.y.mul(5.0)).sub(time.mul(8.0))).mul(0.5).add(0.5);
    const baseTint = vec3(0.86, 0.95, 1.0);
    const iriCyan = vec3(0.56, 0.94, 1.0);
    const iriGold = vec3(1.0, 0.92, 0.68);
    const iri = mix(iriCyan, iriGold, shimmerPhase);

    const color = mix(baseTint, iri, clamp(fresnel.mul(0.7).add(wingBoost.mul(0.35)), 0.0, 0.9));
    const rim = smoothstep(float(0.75), float(0.98), r);
    const alpha = clamp(
      float(0.42).add(fresnel.mul(0.28)).add(vein.mul(0.16)).add(rim.mul(0.14)).add(wingGlow.mul(0.1)),
      0.24,
      0.86,
    );
    const emissive = mix(vec3(0.22, 0.34, 0.4), iri, float(0.4).add(wingBoost.mul(0.5)))
      .mul(float(0.28).add(wingGlow.mul(0.45)).add(wingBoost.mul(0.55)));
    return { color, alpha, emissive };
  });

  const node = out();
  mat.colorNode = node.color;
  mat.opacityNode = node.alpha;
  mat.emissiveNode = node.emissive;

  return { mat, wingGlow, wingBoost };
}

interface ArmRig {
  side: number;
  shoulder: THREE.Group;
  elbow: THREE.Group;
}

interface LegRig {
  side: number;
  hip: THREE.Group;
  knee: THREE.Group;
  foot: THREE.Group;
}

interface WingRig {
  pivot: THREE.Group;
  side: number;
  isUpper: boolean;
  restTilt: number;
}

/**
 * Playable rigged Suit Bee ("Barnaby Buzz") based on the Honey Hood executive bee.
 * Root sits at `Y = 0` at the soles of the shoes and faces `-Z` forward per Portalverse convention.
 */
export function createSuitBeeRig(): CharacterRig {
  const owned: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(r: T): T => {
    owned.push(r);
    return r;
  };
  const geo = <T extends THREE.BufferGeometry>(g: T): T => own(g);
  const mat = (color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}) =>
    own(new THREE.MeshStandardMaterial({ color, roughness: 0.72, ...opts }));

  const rand = mulberry32(0xbee5017);

  const root = new THREE.Group();
  root.name = 'character-suit-bee';

  // Inner coordinate space matches Honey Hood bee (+Z forward), rotated 180deg around Y so the bee faces -Z!
  const scaleGroup = new THREE.Group();
  scaleGroup.scale.setScalar(BEE_SCALE);
  scaleGroup.rotation.y = Math.PI;
  root.add(scaleGroup);

  const bodyPivot = new THREE.Group();
  bodyPivot.position.set(0, STANDING_BODY_Y, 0);
  scaleGroup.add(bodyPivot);

  // Materials
  const yellow = mat(YELLOW, { roughness: 0.74 });
  const black = mat(BLACK, { roughness: 0.42 });
  const eyeBlack = mat('#0d0b0c', { roughness: 0.12, metalness: 0.15 });
  const white = mat('#ffffff', { roughness: 0.25, emissive: '#334155', emissiveIntensity: 0.15 });
  const blue = mat('#1f4396', { roughness: 0.56, side: THREE.DoubleSide });
  const lapelBlue = mat('#16306f', { roughness: 0.42, side: THREE.DoubleSide });
  const shirt = mat('#f7f4ee', { roughness: 0.48, side: THREE.DoubleSide });
  const red = mat('#d0141f', { roughness: 0.36, emissive: '#3a0004', side: THREE.DoubleSide });
  const gold = mat('#f2c14e', { metalness: 0.62, roughness: 0.26 });
  const mouthMat = mat('#4a0d12', { roughness: 0.45 });
  const fuzzMat = mat('#ffffff', { roughness: 0.96 });
  const abdomenMat = mat('#ffffff', { vertexColors: true, roughness: 0.78 });
  const wingShader = createWingMaterial();
  own(wingShader.mat);

  // Shared primitive geometries
  const ballGeo = geo(new THREE.SphereGeometry(1, 22, 16));
  const hairGeo = geo(new THREE.ConeGeometry(0.036, 0.3, 3));
  const unitCylGeo = geo(new THREE.CylinderGeometry(1, 1, 1, 12));

  // --- TORSO / NAVY SUIT JACKET ---
  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'bee-torso';
  bodyPivot.add(torsoGroup);

  const jacketProfile = JACKET_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  torsoGroup.add(makeMesh(geo(new THREE.LatheGeometry(jacketProfile, 36)), blue));

  const opening = (t: number) => 0.04 + 0.6 * t;
  torsoGroup.add(
    makeMesh(geo(frontPanel(-0.4, 0.76, 0.015, (t) => [-opening(t), opening(t)])), shirt),
  );
  const collarGeo = geo(new THREE.ConeGeometry(0.17, 0.42, 3));
  for (const side of [-1, 1]) {
    torsoGroup.add(
      makeMesh(
        geo(
          frontPanel(-0.4, 0.76, 0.035, (t) => {
            const inner = side * opening(t);
            const outer = side * (opening(t) + 0.06 + 0.22 * Math.sin(Math.PI * t * 0.85));
            return side < 0 ? [outer, inner] : [inner, outer];
          }),
        ),
        lapelBlue,
      ),
    );
    const collar = makeMesh(collarGeo, shirt, [side * 0.27, 0.68, 0.84]);
    collar.rotation.set(0.2, 0, side * 2.25);
    torsoGroup.add(collar);
  }
  for (const y of [-0.55, -0.8]) {
    torsoGroup.add(makeMesh(ballGeo, gold, [0, y, jacketRadius(y) + 0.03], [0.09, 0.09, 0.05]));
  }
  torsoGroup.add(makeMesh(geo(frontPanel(0.02, 0.14, 0.05, () => [0.58, 0.78], 6, 4)), shirt));

  // Articulated Red Necktie (pivoted at the collar knot so it swings and flutters in flight!)
  const tiePivot = new THREE.Group();
  tiePivot.position.set(0, 0.64, jacketRadius(0.64) + 0.08);
  torsoGroup.add(tiePivot);
  tiePivot.add(makeMesh(ballGeo, red, [0, 0, 0], [0.17, 0.13, 0.1]));

  const tieBladeGeo = geo(
    frontPanel(-0.62, 0.58, 0.075, (t) => {
      const half = t < 0.18 ? (t / 0.18) * 0.19 : 0.19 - 0.12 * ((t - 0.18) / 0.82);
      return [-half, half];
    }),
  );
  // Shift tie blade geometry into tiePivot's local frame so it hangs directly below the knot.
  tieBladeGeo.translate(0, -0.64, -(jacketRadius(0.64) + 0.08));
  tiePivot.add(makeMesh(tieBladeGeo, red));

  // --- ARTICULATED FUZZY STRIPED ABDOMEN ---
  const abdomenPivot = new THREE.Group();
  abdomenPivot.position.set(0, -0.78, -0.18);
  bodyPivot.add(abdomenPivot);

  const stripe = (unitY: number) => (Math.floor((unitY + 1) * 3.2) % 2 ? BLACK : YELLOW);
  const abdomenGeo = geo(new THREE.SphereGeometry(1, 26, 32).toNonIndexed());
  const abPos = abdomenGeo.getAttribute('position');
  const abColors = new Float32Array(abPos.count * 3);
  const tmpCol = new THREE.Color();
  for (let i = 0; i < abPos.count; i += 3) {
    tmpCol.set(stripe((abPos.getY(i) + abPos.getY(i + 1) + abPos.getY(i + 2)) / 3));
    for (let k = 0; k < 3; k++) tmpCol.toArray(abColors, (i + k) * 3);
  }
  abdomenGeo.setAttribute('color', new THREE.BufferAttribute(abColors, 3));

  const abdomenLocalCenter = new THREE.Vector3(0, -0.72, -0.17);
  const abdomenRadii = new THREE.Vector3(1.15, 1.2, 1.15);
  const abdomenMesh = makeMesh(abdomenGeo, abdomenMat);
  abdomenMesh.position.copy(abdomenLocalCenter);
  abdomenMesh.scale.copy(abdomenRadii);
  abdomenPivot.add(abdomenMesh);
  abdomenPivot.add(
    buildFuzz(hairGeo, fuzzMat, abdomenLocalCenter, abdomenRadii, 460, (u) => stripe(u.y), (u) => u.y < 0.55, rand),
  );

  const stinger = makeMesh(geo(new THREE.ConeGeometry(0.2, 0.6, 10)), black, [0, -1.82, -0.67]);
  stinger.rotation.x = Math.PI + 0.5;
  abdomenPivot.add(stinger);

  // --- ARTICULATED HEAD, BLINKING EYES & BOUNCY ANTENNAE ---
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.78, 0.25);
  torsoGroup.add(headPivot);

  const headLocalCenter = new THREE.Vector3(0, 0.8, 0.2);
  const headRadius = new THREE.Vector3(1.12, 1.08, 1.1);
  const headMesh = makeMesh(ballGeo, yellow);
  headMesh.position.copy(headLocalCenter);
  headMesh.scale.copy(headRadius);
  headPivot.add(headMesh);
  headPivot.add(
    buildFuzz(
      hairGeo,
      fuzzMat,
      headLocalCenter,
      headRadius,
      300,
      () => YELLOW,
      (u) => u.z < 0.45 || u.y > 0.65,
      rand,
    ),
  );

  const eyes: THREE.Group[] = [];
  const antennae: Array<{ pivot: THREE.Group; side: number }> = [];
  const stalkGeo = geo(new THREE.CylinderGeometry(0.055, 0.055, 0.85, 10));
  for (const side of [-1, 1]) {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * 0.43, 1.02, 1.18);
    eyeGroup.add(
      makeMesh(ballGeo, eyeBlack, [0, 0, 0], [0.27, 0.35, 0.17]),
      makeMesh(ballGeo, white, [-side * 0.07, 0.13, 0.16], [0.08, 0.09, 0.05]),
    );
    headPivot.add(eyeGroup);
    eyes.push(eyeGroup);

    const antPivot = new THREE.Group();
    antPivot.position.set(side * 0.4, 1.72, 0.3);
    const stalk = makeMesh(stalkGeo, black, [0, 0.42, 0]);
    const tip = makeMesh(ballGeo, black, [0, 0.86, 0], [0.19, 0.19, 0.19]);
    antPivot.add(stalk, tip);
    // Natural outward + slight forward lean at rest
    antPivot.rotation.set(0.18, 0, -side * 0.48);
    headPivot.add(antPivot);
    antennae.push({ pivot: antPivot, side });
  }
  const mouth = makeMesh(ballGeo, mouthMat, [0, 0.36, 1.22], [0.32, 0.075, 0.12]);
  headPivot.add(mouth);

  // --- ARTICULATED ARMS (SHOULDER -> UPPER SLEEVE -> ELBOW -> FOREARM + CUFF + HAND) ---
  const arms: ArmRig[] = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.96, 0.32, 0.05);
    torsoGroup.add(shoulder);

    // Rounded suit shoulder cap
    shoulder.add(makeMesh(ballGeo, blue, [0, 0, 0], [0.34, 0.34, 0.34]));
    // Upper sleeve hanging down along -Y
    shoulder.add(makeMesh(unitCylGeo, blue, [0, -0.34, 0], [0.25, 0.68, 0.25]));

    const elbow = new THREE.Group();
    elbow.position.set(0, -0.68, 0);
    shoulder.add(elbow);

    elbow.add(makeMesh(ballGeo, blue, [0, 0, 0], [0.23, 0.23, 0.23]));
    elbow.add(makeMesh(unitCylGeo, blue, [0, -0.26, 0], [0.23, 0.52, 0.23]));
    elbow.add(makeMesh(unitCylGeo, shirt, [0, -0.56, 0], [0.19, 0.16, 0.19]));
    elbow.add(makeMesh(ballGeo, black, [0, -0.74, 0], [0.23, 0.23, 0.23]));

    arms.push({ side, shoulder, elbow });
  }

  // --- ARTICULATED BIPEDAL LEGS (HIP -> THIGH -> KNEE -> SHIN -> ANKLE/SHOE) ---
  const legs: LegRig[] = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.58, -1.85, 0.22);
    bodyPivot.add(hip);

    // Thigh: length 0.50
    hip.add(makeMesh(unitCylGeo, black, [0, -0.25, 0], [0.11, 0.5, 0.11]));

    const knee = new THREE.Group();
    knee.position.set(0, -0.5, 0);
    hip.add(knee);

    knee.add(makeMesh(ballGeo, black, [0, 0, 0], [0.11, 0.11, 0.11]));
    // Shin: length 0.45 -> ankle at y = -0.45, total hip->ankle = 0.95 -> ankle at -2.80, shoe radius 0.14 -> sole at -2.94!
    knee.add(makeMesh(unitCylGeo, black, [0, -0.225, 0], [0.095, 0.45, 0.095]));

    const foot = new THREE.Group();
    foot.position.set(0, -0.45, 0);
    knee.add(foot);
    // Shoe extends slightly forward (+Z in local bee space)
    foot.add(makeMesh(ballGeo, black, [0, 0, 0.09], [0.2, 0.14, 0.3]));

    legs.push({ side, hip, knee, foot });
  }

  // --- TWO PAIRS OF TRANSLUCENT IRIDESCENT WINGS ---
  const wingGeo = geo(new THREE.CircleGeometry(1, 28));
  const wings: WingRig[] = [];
  for (const side of [-1, 1]) {
    const specs: Array<[number, number, number, number, boolean]> = [
      [0.54, 1.72, 0.74, 0.44, true],
      [-0.14, 1.18, 0.52, -0.24, false],
    ];
    for (const [y, lengthVal, widthVal, restTilt, isUpper] of specs) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.44, y, -1.04);
      const wingMesh = makeMesh(wingGeo, wingShader.mat, [side * lengthVal, 0, 0], [lengthVal, widthVal, 1]);
      pivot.add(wingMesh);
      torsoGroup.add(pivot);
      wings.push({ pivot, side, isUpper, restTilt });
    }
  }

  // --- SMOOTH ANIMATION STATE ---
  let gaitPhase = 0;
  let wingPhase = 0;
  let flyBlend = 0;
  let airBlend = 0;
  let moveBlend = 0;
  let smoothPitch = 0;
  let smoothRoll = 0;
  let smoothTurn = 0;
  let smoothSpeed = 0;
  let blinkTimer = 2.6;
  let blinkDuration = 0;

  const update = (dt: number, elapsed: number, motion: AvatarMotionState) => {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);

    const targetFly = motion.isFlying ? 1 : 0;
    const targetAir = !motion.grounded && !motion.isFlying ? 1 : 0;
    const horizSpeed = Math.min(motion.speed, 26);
    const walkActivity = motion.grounded ? THREE.MathUtils.clamp(motion.speedNorm, 0, 1.45) : 0;
    const walkWeight = THREE.MathUtils.clamp(walkActivity / 0.12, 0, 1);

    flyBlend = damp(flyBlend, targetFly, 8.5, safeDt);
    airBlend = damp(airBlend, targetAir, 10.0, safeDt);
    moveBlend = damp(moveBlend, walkWeight, 11.0, safeDt);
    smoothSpeed = damp(smoothSpeed, horizSpeed, 9.0, safeDt);
    smoothTurn = damp(smoothTurn, THREE.MathUtils.clamp(motion.turnRate, -3.5, 3.5), 10.0, safeDt);

    // Advance walk cycle cleanly proportional to ground speed (no foot skating)
    const dirSign = motion.forwardSpeed < -0.5 ? -1 : 1;
    const strideRate = 5.4 + Math.min(motion.speedNorm, 1.5) * 4.8;
    gaitPhase += safeDt * strideRate * moveBlend * dirSign;

    // Wingbeat frequency ramps from gentle idle twitch -> fast buzz in flight / jump
    const buzzIntensity = Math.max(
      flyBlend,
      airBlend * 0.72,
      THREE.MathUtils.clamp((motion.speedNorm - 0.85) * 0.8, 0, 0.55) * (1 - flyBlend),
    );
    const wingFreq = 6.0 + buzzIntensity * 34.0 + motion.boost * 14.0;
    wingPhase += safeDt * wingFreq;

    // Update TSL wing shader uniforms
    wingShader.wingGlow.value = THREE.MathUtils.clamp(buzzIntensity, 0, 1);
    wingShader.wingBoost.value = THREE.MathUtils.clamp(motion.boost * flyBlend, 0, 1);

    // --- BODY ROOT: BOB, LEAN, BANKING & SQUASH-STRETCH ---
    const idleBreath = Math.sin(elapsed * 2.4) * 0.045 * (1 - moveBlend) * (1 - flyBlend);
    const walkBob = Math.abs(Math.sin(gaitPhase)) * 0.16 * moveBlend * (1 - flyBlend);
    const hoverBob = Math.sin(elapsed * 4.2) * 0.18 * flyBlend;
    const squash = motion.landImpact * 0.18;

    bodyPivot.position.y = STANDING_BODY_Y + idleBreath + walkBob + hoverBob - squash * 1.1;
    bodyPivot.scale.set(1 + squash * 0.55, 1 - squash * 0.7, 1 + squash * 0.55);

    // Forward pitch (+X leans chest forward toward +Z in local bee space)
    const walkLean = Math.min(motion.speedNorm, 1.3) * 0.16 * moveBlend;
    const flyForwardFactor = THREE.MathUtils.clamp(smoothSpeed / 14, 0, 1);
    const flyLean =
      (0.24 + flyForwardFactor * 0.42 + motion.boost * 0.24 - THREE.MathUtils.clamp(motion.pitch, -0.8, 0.8) * 0.35) *
      flyBlend;
    const jumpLean = THREE.MathUtils.clamp(motion.velocityY * 0.025, -0.18, 0.18) * airBlend;
    smoothPitch = damp(smoothPitch, walkLean + flyLean + jumpLean, 9.0, safeDt);

    // Banking roll (-Z tilts top toward +X = character's left when turning left)
    const strafeBank = THREE.MathUtils.clamp(motion.strafeSpeed * 0.028, -0.22, 0.22);
    const turnBank = -smoothTurn * (0.09 + flyBlend * 0.18 + motion.boost * 0.08);
    const walkSway = Math.cos(gaitPhase) * 0.055 * moveBlend * (1 - flyBlend);
    smoothRoll = damp(smoothRoll, THREE.MathUtils.clamp(turnBank + strafeBank + walkSway, -0.58, 0.58), 9.0, safeDt);

    bodyPivot.rotation.set(smoothPitch, Math.sin(gaitPhase) * 0.06 * moveBlend * (1 - flyBlend), smoothRoll);

    // --- ABDOMEN WAG & STREAMLINED FLIGHT POSTURE ---
    const abWalkWag = Math.sin(gaitPhase) * 0.09 * moveBlend * (1 - flyBlend);
    const abFlyTilt = (0.34 + flyForwardFactor * 0.3 + motion.boost * 0.18) * flyBlend;
    const abBreath = Math.sin(elapsed * 2.4 - 0.6) * 0.035;
    abdomenPivot.rotation.set(abFlyTilt + abBreath, abWalkWag, -smoothRoll * 0.22);

    // --- HEAD LOOK, COUNTER-PITCH IN FLIGHT, BLINKING & ANTENNAE ---
    const headCounterPitch = -flyLean * 0.65 + THREE.MathUtils.clamp(-motion.pitch * 0.35, -0.35, 0.35) * flyBlend;
    const headIdleNod = Math.sin(elapsed * 1.9) * 0.04 * (1 - moveBlend) * (1 - flyBlend);
    const headTurnLook = THREE.MathUtils.clamp(smoothTurn * 0.14, -0.32, 0.32);
    headPivot.rotation.set(headCounterPitch + headIdleNod, headTurnLook, -smoothRoll * 0.3);

    // Natural eye blinking
    blinkTimer -= safeDt;
    if (blinkTimer <= 0) {
      blinkDuration = 0.13;
      blinkTimer = 2.4 + ((Math.sin(elapsed * 13.7) * 0.5 + 0.5) * 3.4);
    }
    let eyeScaleY = 1;
    if (blinkDuration > 0) {
      blinkDuration = Math.max(0, blinkDuration - safeDt);
      const b = Math.sin((blinkDuration / 0.13) * Math.PI);
      eyeScaleY = Math.max(0.12, 1 - b * 0.88);
    }
    for (const eye of eyes) eye.scale.y = eyeScaleY;

    // Happy mouth opens slightly when boosting or jumping
    const excitement = THREE.MathUtils.clamp(motion.boost * flyBlend * 0.85 + airBlend * 0.35, 0, 1);
    mouth.scale.y = 0.075 + excitement * 0.13;

    // Springy antennae bounce on footsteps and sweep back cleanly in flight
    const antBounce = Math.sin(gaitPhase * 2 - 0.5) * 0.12 * moveBlend;
    const antSweepBack = -(0.22 + flyForwardFactor * 0.52 + motion.boost * 0.35) * flyBlend;
    const antIdleSway = Math.sin(elapsed * 2.7) * 0.05;
    for (const { pivot, side } of antennae) {
      pivot.rotation.set(
        0.18 + antBounce + antSweepBack + antIdleSway,
        0,
        -side * (0.48 + flyBlend * 0.14) - smoothRoll * 0.25,
      );
    }

    // --- FLUTTERING RED NECKTIE ---
    const tieSwingZ = -Math.cos(gaitPhase) * 0.14 * moveBlend - smoothRoll * 0.5;
    const tieWindX =
      Math.min(motion.speedNorm, 1.3) * 0.16 * moveBlend +
      (0.12 + Math.sin(elapsed * 18) * 0.09 * (0.3 + flyForwardFactor)) * flyBlend;
    // Keep tie slightly lifted away from jacket belly (negative X lifts forward/outward in +Z space)
    tiePivot.rotation.set(-Math.max(0, tieWindX * 0.45), 0, tieSwingZ);

    // --- ARTICULATED ARMS ---
    for (const arm of arms) {
      // Counter-phase to same-side leg
      const phase = gaitPhase + (arm.side > 0 ? Math.PI : 0);
      const strideAmp = 0.45 + Math.min(motion.speedNorm, 1.3) * 0.35;
      const walkSwingX = -Math.sin(phase) * strideAmp * moveBlend;
      const walkElbowX = -(0.22 + Math.max(0, Math.sin(phase)) * 0.45) * moveBlend;

      const idleSwayX = Math.sin(elapsed * 2.1 + arm.side * 0.8) * 0.05 * (1 - moveBlend);
      const jumpRaiseZ = -arm.side * 0.42 * airBlend;
      const jumpRaiseX = -0.35 * airBlend;

      // In flight: arms tuck neatly & sweep backward into an aerodynamic pose (positive X swings -Y back toward -Z)
      const flySweepX = (0.38 + flyForwardFactor * 0.48 + motion.boost * 0.32) * flyBlend;
      const flyOutZ = -arm.side * (0.38 - motion.boost * 0.12) * flyBlend;
      const flyElbowX = -(0.32 - motion.boost * 0.18) * flyBlend;

      const groundWeight = 1 - flyBlend;
      const shoulderX = (walkSwingX + idleSwayX) * groundWeight * (1 - airBlend * 0.6) + jumpRaiseX + flySweepX;
      const shoulderZ = -arm.side * (0.32 + moveBlend * 0.06) * groundWeight + jumpRaiseZ + flyOutZ;

      arm.shoulder.rotation.set(shoulderX, 0, shoulderZ);
      arm.elbow.rotation.set(
        -(0.16 * (1 - moveBlend) * groundWeight) + walkElbowX * groundWeight + flyElbowX - 0.35 * airBlend,
        0,
        0,
      );
    }

    // --- ARTICULATED LEGS & FEET ---
    for (const leg of legs) {
      const phase = gaitPhase + (leg.side > 0 ? 0 : Math.PI);
      const strideAmp = 0.52 + Math.min(motion.speedNorm, 1.4) * 0.38;
      // Negative X swings downward leg forward (+Z); positive X swings backward (-Z)
      const walkHipX = -Math.sin(phase) * strideAmp * moveBlend;
      // Knee bends backward (+X) on lift-off/swing forward pass
      const kneeLift = Math.max(0, Math.cos(phase - 0.35));
      const walkKneeX = kneeLift * (0.62 + Math.min(motion.speedNorm, 1.4) * 0.42) * moveBlend;
      const walkFootX = -(walkHipX * 0.4 + walkKneeX * 0.35) * moveBlend;

      // Jump / airborne tuck
      const riseTuck = THREE.MathUtils.clamp(motion.velocityY * 0.08, -0.25, 0.65);
      const jumpHipX = -(0.28 + riseTuck * 0.45) * airBlend;
      const jumpKneeX = (0.55 + Math.max(0, riseTuck) * 0.45) * airBlend;
      const jumpFootX = 0.25 * airBlend;

      // Flight trailing legs (swept cleanly back behind abdomen with gentle alternating kick)
      const flyTrailKick = Math.sin(elapsed * 4.5 + leg.side * 1.4) * 0.09 * flyBlend;
      const flyHipX = (0.48 + flyForwardFactor * 0.46 + motion.boost * 0.22 + flyTrailKick) * flyBlend;
      const flyKneeX = (0.35 + motion.boost * 0.25) * flyBlend;
      const flyFootX = 0.42 * flyBlend;

      const groundWeight = (1 - flyBlend) * (1 - airBlend);
      leg.hip.rotation.set(
        walkHipX * groundWeight + jumpHipX + flyHipX,
        0,
        -leg.side * 0.06 * (1 - flyBlend) - smoothRoll * 0.15 * flyBlend,
      );
      leg.knee.rotation.set(walkKneeX * groundWeight + jumpKneeX + flyKneeX, 0, 0);
      leg.foot.rotation.set(walkFootX * groundWeight + jumpFootX + flyFootX, 0, 0);
    }

    // --- WINGS: RELAXED FOLD AT IDLE -> SHIMMERING HIGH-SPEED FIGURE-8 BUZZ IN FLIGHT ---
    for (const w of wings) {
      const phaseOffset = w.isUpper ? 0 : -0.65;
      const idleFlutter = Math.sin(elapsed * 2.2 + phaseOffset) * 0.06;
      const restFoldY = w.side * (0.52 - buzzIntensity * 0.38);
      const flapAmp = 0.08 + buzzIntensity * 0.64 + motion.boost * 0.14;
      const flapY = Math.sin(wingPhase + phaseOffset) * flapAmp;
      const pitchTwist = Math.cos(wingPhase + phaseOffset) * 0.26 * buzzIntensity;
      const tiltZ = w.side * (w.restTilt + Math.sin(wingPhase + phaseOffset) * 0.16 * buzzIntensity);

      w.pivot.rotation.set(pitchTwist, restFoldY + w.side * (idleFlutter + flapY), tiltZ);
    }
  };

  // Initialize into clean resting pose
  update(0, 0, IDLE_MOTION_STATE);

  return {
    group: root,
    update,
    dispose: () => {
      for (const r of owned) r.dispose();
    },
  };
}
