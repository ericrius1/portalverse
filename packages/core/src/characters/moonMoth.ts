import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  atan,
  cameraPosition,
  clamp,
  cos,
  dot,
  exp,
  float,
  fract,
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
  vec2,
  vec3,
} from 'three/tsl';
import { IDLE_MOTION_STATE, type AvatarMotionState, type CharacterRig } from './types';

/*
 * Velveteen Moonbite — Moon-Biting Gourmand (Velvet Luna Moth).
 *
 * Built natively in Portalverse space: +X right, +Y up, -Z forward.
 * Feet rest cleanly at Y = 0; crown reaches ~1.64 m, antenna plumes ~2.02 m.
 */

const VELVET_DARK = '#3b0764';
const VELVET_MID = '#581c87';
const VELVET_PLUM = '#6b21a8';
const FUCHSIA_ROOT = '#d946ef';
const LILAC_EDGE = '#f0abfc';
const RUFF_CREAM = '#f3e8ff';
const MOON_PEARL = '#f5f3ff';
const CRIMSON_THREAD = '#dc2626';
const BEAT_RAD_PER_SEC = (88 / 60) * Math.PI * 2; // Portalverse 88 BPM shared pulse

const clampNum = THREE.MathUtils.clamp;
const lerpNum = THREE.MathUtils.lerp;

function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalized 0..1 UVs for any 2D ShapeGeometry so TSL wing gradients & eyespots align predictably. */
function normalizeShapeUVs(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const spanX = Math.max(1e-4, box.max.x - box.min.x);
  const spanY = Math.max(1e-4, box.max.y - box.min.y);
  const pos = geo.getAttribute('position');
  const uvArr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvArr[i * 2] = (pos.getX(i) - box.min.x) / spanX;
    uvArr[i * 2 + 1] = (pos.getY(i) - box.min.y) / spanY;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return geo;
}

/** Broad scalloped luna forewing extending along +X (mirrored for left wing). */
function buildForewingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.04);
  s.bezierCurveTo(0.24, 0.34, 0.68, 0.44, 0.96, 0.36);
  s.bezierCurveTo(1.06, 0.32, 1.04, 0.14, 0.92, 0.05);
  // Soft opera-cape scallops along the trailing edge
  s.bezierCurveTo(0.95, -0.04, 0.84, -0.14, 0.72, -0.15);
  s.bezierCurveTo(0.68, -0.24, 0.52, -0.28, 0.38, -0.23);
  s.bezierCurveTo(0.24, -0.27, 0.10, -0.18, 0, -0.10);
  s.closePath();

  const geo = normalizeShapeUVs(new THREE.ShapeGeometry(s, 20));
  // Subtle organic camber so the wing catches light like real velvet
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const camber = Math.sin(clampNum(x / 1.02, 0, 1) * Math.PI) * 0.055 - Math.abs(y) * 0.04;
    pos.setZ(i, camber);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Scalloped luna hindwing (root lobe; long swallowtail ribbon attaches below). */
function buildHindwingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.05);
  s.bezierCurveTo(0.28, 0.14, 0.56, 0.04, 0.66, -0.16);
  s.bezierCurveTo(0.70, -0.32, 0.58, -0.48, 0.42, -0.54);
  s.bezierCurveTo(0.32, -0.60, 0.22, -0.64, 0.14, -0.56);
  s.bezierCurveTo(0.06, -0.44, 0.02, -0.22, 0, 0.05);
  s.closePath();

  const geo = normalizeShapeUVs(new THREE.ShapeGeometry(s, 18));
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    pos.setZ(i, Math.sin(clampNum(x / 0.68, 0, 1) * Math.PI) * 0.035);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Graceful beveled crescent-moon tiara mesh. */
function buildCrescentTiaraGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const outerR = 0.155;
  const innerR = 0.118;
  const offsetY = 0.056;
  const segs = 28;
  // Outer arc (bottom-heavy bowl opening upward like a moon crown)
  for (let i = 0; i <= segs; i++) {
    const a = -Math.PI * 0.92 + (i / segs) * Math.PI * 0.84;
    const x = Math.cos(a) * outerR;
    const y = Math.sin(a) * outerR;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  // Inner concave arc returning to the other horn tip
  for (let i = segs; i >= 0; i--) {
    const a = -Math.PI * 0.88 + (i / segs) * Math.PI * 0.76;
    const x = Math.cos(a) * innerR;
    const y = Math.sin(a) * innerR + offsetY;
    s.lineTo(x, y);
  }
  s.closePath();

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.022,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.006,
    bevelSegments: 3,
    curveSegments: 16,
  });
  geo.center();
  return geo;
}

/** Scalloped lace napkin tucked under Velveteen's chin, in case of moon. */
function buildLaceNapkinGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.075, 0.02);
  s.lineTo(0.075, 0.02);
  s.quadraticCurveTo(0.105, -0.07, 0.088, -0.17);
  // Scalloped lace hem
  s.quadraticCurveTo(0.06, -0.20, 0.032, -0.18);
  s.quadraticCurveTo(0.0, -0.22, -0.032, -0.18);
  s.quadraticCurveTo(-0.06, -0.20, -0.088, -0.17);
  s.quadraticCurveTo(-0.105, -0.07, -0.075, 0.02);
  s.closePath();
  const geo = normalizeShapeUVs(new THREE.ShapeGeometry(s, 14));
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Gentle drape outward over her chest
    pos.setZ(i, -0.02 * (1 - x * x * 45) + (y < -0.04 ? Math.sin(x * 26) * 0.006 : 0));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Tiny crimson figure-eight stitch geometry (matching the secret thread motif). */
function buildFigureEightGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = Math.sin(t) * 0.014;
    const y = Math.sin(2 * t) * 0.009;
    pts.push(new THREE.Vector3(x, y, 0));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true);
  return new THREE.TubeGeometry(curve, 32, 0.0022, 6, true);
}

/** Velvet TSL material with soft fresnel plum-lilac sheen. */
function createVelvetMaterial(baseHex: string, rimHex: string) {
  const baseCol = uniform(new THREE.Color(baseHex));
  const rimCol = uniform(new THREE.Color(rimHex));
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.78,
    metalness: 0.08,
  });
  mat.colorNode = baseCol;
  mat.emissiveNode = Fn(() => {
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = max(dot(normalize(normalWorld), viewDir), 0.0);
    const fresnel = pow(float(1.0).sub(ndotv), 2.4);
    return rimCol.mul(fresnel.mul(0.36));
  })();
  return { material: mat, baseCol, rimCol };
}

/**
 * TSL WebGPU luna-wing shader:
 * - Radial velvet fuchsia-to-lilac gradient
 * - Translucent organic wing veins
 * - Glowing crescent-SDF eyespot on the forewing
 * - Thin-film iridescent fresnel shimmer & sparkling moondust scale glitter
 * - 88 BPM beat pulse & Moonbite Dash boost flare
 */
function createLunaWingMaterial(hasEyespot: boolean) {
  const rootColor = uniform(new THREE.Color(FUCHSIA_ROOT));
  const edgeColor = uniform(new THREE.Color(LILAC_EDGE));
  const uBoost = uniform(0.0);
  const uFlight = uniform(0.0);

  const mat = new THREE.MeshStandardNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    roughness: 0.34,
    metalness: 0.14,
  });

  const wingOut = Fn(() => {
    const p = uv();
    // Radial distance from wing root (near u=0, v=0.55)
    const rootDelta = vec2(p.x, p.y.sub(0.56).mul(0.85));
    const radial = clamp(length(rootDelta).mul(1.06), 0.0, 1.0);

    // Rich dark plum velvet at the very root -> vivid fuchsia -> luminous pale lilac edge
    const deepRoot = vec3(0.24, 0.04, 0.42);
    const bodyGrad = mix(deepRoot, rootColor, smoothstep(float(0.02), float(0.28), radial));
    const fullGrad = mix(bodyGrad, edgeColor, smoothstep(float(0.45), float(0.96), radial));

    // Fanning organic wing veins radiating from root
    const ang = atan(p.y.sub(0.55), p.x.add(0.05));
    const veinWave = abs(sin(ang.mul(13.0).add(radial.mul(2.4))));
    const veinMask = smoothstep(float(0.14), float(0.0), veinWave).mul(
      smoothstep(float(0.06), float(0.22), radial),
    );
    const crossVein = smoothstep(
      float(0.08),
      float(0.0),
      abs(sin(radial.mul(18.0).add(sin(ang.mul(6.0)).mul(0.5)))),
    ).mul(0.35);

    // Scalloped luminous border trim
    const rimBorder = smoothstep(float(0.76), float(0.98), radial);

    // Crescent-SDF eyespot on the forewing
    const spotCenter = vec2(0.56, 0.62);
    const outerCircle = length(p.sub(spotCenter));
    const innerCut = length(p.sub(spotCenter.add(vec2(0.042, 0.028))));
    const crescentFill = smoothstep(float(0.12), float(0.092), outerCircle).mul(
      smoothstep(float(0.068), float(0.098), innerCut),
    );
    const crescentHalo = exp(outerCircle.mul(-10.5)).mul(0.55);
    const spotWeight = hasEyespot ? crescentFill.add(crescentHalo) : float(0.0);

    // Fine sparkling scale-dust glitter
    const cell = p.mul(44.0);
    const cellHash = fract(sin(dot(cell.floor(), vec2(127.1, 311.7))).mul(43758.5453));
    const sparkle = pow(
      sin(time.mul(3.4).add(cellHash.mul(40.0))).mul(0.5).add(0.5),
      6.0,
    ).mul(smoothstep(float(0.68), float(0.96), cellHash));

    // Thin-film iridescent fresnel shimmer
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = abs(dot(normalize(normalWorld), viewDir));
    const fresnel = pow(float(1.0).sub(ndotv), 2.3);
    const irid = vec3(
      sin(fresnel.mul(5.5).add(time.mul(1.2))).mul(0.35).add(0.65),
      sin(fresnel.mul(5.5).add(time.mul(1.2)).add(2.0)).mul(0.25).add(0.55),
      cos(fresnel.mul(4.8).sub(time.mul(0.9))).mul(0.25).add(0.75),
    );

    // Subtle 88 BPM shared heartbeat on the eyespots & rim
    const beatPulse = sin(time.mul(BEAT_RAD_PER_SEC)).mul(0.5).add(0.5);
    const pearl = vec3(0.99, 0.96, 1.0);

    const baseRgb = mix(fullGrad, edgeColor.mul(1.18), veinMask.mul(0.45).add(crossVein.mul(0.2)))
      .add(irid.mul(fresnel.mul(0.28)));
    const emissive = pearl
      .mul(spotWeight.mul(float(1.05).add(beatPulse.mul(0.35)).add(uBoost.mul(1.3))))
      .add(edgeColor.mul(rimBorder.mul(float(0.28).add(uFlight.mul(0.22)).add(uBoost.mul(0.65)))))
      .add(rootColor.mul(veinMask.mul(float(0.22).add(uBoost.mul(0.5)))))
      .add(pearl.mul(sparkle.mul(float(0.55).add(uBoost.mul(0.9)))));

    return { baseRgb, emissive };
  })();

  mat.colorNode = wingOut.baseRgb;
  mat.emissiveNode = wingOut.emissive;
  mat.opacityNode = float(0.93);

  return { material: mat, rootColor, edgeColor, uBoost, uFlight };
}

/** Pearly emissive crescent tiara with subtle lunar crater shimmer and boost flare. */
function createTiaraMaterial() {
  const uBoost = uniform(0.0);
  const pearl = uniform(new THREE.Color(MOON_PEARL));
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.24,
    metalness: 0.12,
  });
  mat.colorNode = pearl;
  mat.emissiveNode = Fn(() => {
    const p = positionWorld.mul(18.0);
    const crater = sin(p.x).mul(cos(p.y.mul(1.3))).mul(sin(p.z.mul(1.1))).mul(0.14);
    const beat = sin(time.mul(BEAT_RAD_PER_SEC)).mul(0.5).add(0.5);
    const glow = float(0.95).add(beat.mul(0.28)).add(uBoost.mul(1.9)).add(crater);
    return pearl.mul(glow);
  })();
  return { material: mat, uBoost };
}

/** Build a feathery curved plume antenna with instanced tapered barbs along both sides. */
function buildPlumeAntenna(
  side: -1 | 1,
  spineMat: THREE.Material,
  barbMat: THREE.Material,
  geometries: THREE.BufferGeometry[],
): { root: THREE.Group; tipPivot: THREE.Group } {
  const root = new THREE.Group();
  const spinePts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(side * 0.08, 0.13, -0.02),
    new THREE.Vector3(side * 0.19, 0.27, -0.03),
  ];
  const lowerCurve = new THREE.CatmullRomCurve3(spinePts);
  const lowerSpineGeo = new THREE.TubeGeometry(lowerCurve, 12, 0.011, 6, false);
  geometries.push(lowerSpineGeo);
  root.add(new THREE.Mesh(lowerSpineGeo, spineMat));

  // Upper springy curling tip
  const tipPivot = new THREE.Group();
  tipPivot.position.copy(spinePts[2]);
  root.add(tipPivot);

  const tipPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(side * 0.11, 0.11, -0.01),
    new THREE.Vector3(side * 0.19, 0.16, 0.03),
    new THREE.Vector3(side * 0.22, 0.12, 0.06),
  ];
  const tipCurve = new THREE.CatmullRomCurve3(tipPts);
  const tipSpineGeo = new THREE.TubeGeometry(tipCurve, 12, 0.0085, 6, false);
  geometries.push(tipSpineGeo);
  tipPivot.add(new THREE.Mesh(tipSpineGeo, spineMat));

  // Feathery barbs along lower + upper plume
  const barbGeo = new THREE.ConeGeometry(0.0085, 1.0, 4);
  barbGeo.translate(0, 0.5, 0);
  geometries.push(barbGeo);

  const addBarbs = (parent: THREE.Group, curve: THREE.CatmullRomCurve3, pairs: number, maxLen: number, startT: number) => {
    const mesh = new THREE.InstancedMesh(barbGeo, barbMat, pairs * 2);
    const dummy = new THREE.Object3D();
    const pos = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    let idx = 0;
    for (let i = 0; i < pairs; i++) {
      const t = startT + ((1 - startT) * i) / Math.max(1, pairs - 1);
      curve.getPointAt(t, pos);
      curve.getTangentAt(t, tangent).normalize();
      const envelope = Math.sin(clampNum(t, 0.08, 0.98) * Math.PI);
      const len = maxLen * (0.42 + 0.72 * envelope);
      for (const s of [-1, 1] as const) {
        dir.set(s * 0.78, 0.32, s * 0.24).addScaledVector(tangent, 0.45).normalize();
        dummy.position.copy(pos);
        dummy.quaternion.setFromUnitVectors(up, dir);
        dummy.scale.set(0.75 + 0.35 * envelope, len, 0.75 + 0.35 * envelope);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    parent.add(mesh);
  };

  addBarbs(root, lowerCurve, 12, 0.088, 0.16);
  addBarbs(tipPivot, tipCurve, 11, 0.072, 0.05);

  return { root, tipPivot };
}

/**
 * Velveteen Moonbite — procedural Three.js WebGPU playable character rig.
 */
export function createMoonMothRig(options?: { accentColor?: string }): CharacterRig {
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  const group = new THREE.Group();
  const rigRoot = new THREE.Group();
  rigRoot.position.y = 0.92;
  rigRoot.rotation.order = 'ZYX';
  group.add(rigRoot);

  // Materials
  const velvetBody = createVelvetMaterial(VELVET_DARK, LILAC_EDGE);
  trackMat(velvetBody.material);
  const velvetPlum = createVelvetMaterial(VELVET_MID, '#e879f9');
  trackMat(velvetPlum.material);
  const pantaloonMat = createVelvetMaterial(VELVET_PLUM, RUFF_CREAM);
  trackMat(pantaloonMat.material);

  const ruffMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: RUFF_CREAM,
      emissive: '#d8b4fe',
      emissiveIntensity: 0.16,
      roughness: 0.88,
      metalness: 0.02,
    }),
  );

  const goldTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#fde68a',
      emissive: '#f59e0b',
      emissiveIntensity: 0.2,
      roughness: 0.28,
      metalness: 0.78,
    }),
  );

  const napkinMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      emissive: '#e2e8f0',
      emissiveIntensity: 0.08,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
    }),
  );

  const crimsonMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: CRIMSON_THREAD,
      emissive: '#ef4444',
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.1,
    }),
  );

  const eyeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#09040f',
      roughness: 0.06,
      metalness: 0.35,
    }),
  );

  const starGlintMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#f5d0fe',
    }),
  );

  const antennaSpineMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#e9d5ff',
      emissive: '#c084fc',
      emissiveIntensity: 0.28,
      roughness: 0.42,
      metalness: 0.15,
    }),
  );

  const antennaBarbMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: '#f5d0fe',
      emissive: '#d946ef',
      emissiveIntensity: 0.26,
      roughness: 0.55,
      metalness: 0.05,
    }),
  );

  const forewingShader = createLunaWingMaterial(true);
  trackMat(forewingShader.material);
  const hindwingShader = createLunaWingMaterial(false);
  trackMat(hindwingShader.material);

  const tiaraShader = createTiaraMaterial();
  trackMat(tiaraShader.material);

  const moondustMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#f5d0fe',
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  // Subtle accent customization (keeps Velveteen unmistakably violet-fuchsia while nodding to player aura)
  const applyAccent = (hex?: string) => {
    if (!hex) return;
    const base = new THREE.Color(FUCHSIA_ROOT);
    const custom = new THREE.Color(hex);
    forewingShader.rootColor.value.copy(base).lerp(custom, 0.26);
    hindwingShader.rootColor.value.copy(base).lerp(custom, 0.26);
  };
  applyAccent(options?.accentColor);

  // -------------------------------------------------------------------------
  // Lower body: legs in fluffy violet pantaloons + pointed velvet slippers
  // Feet rest at Y = 0 in group space (which is y = -0.92 relative to rigRoot)
  // -------------------------------------------------------------------------
  const legRoot = new THREE.Group();
  legRoot.position.y = -0.18; // Pelvis at Y = 0.74 m in world space
  rigRoot.add(legRoot);

  const thighGeo = trackGeo(new THREE.CapsuleGeometry(0.068, 0.22, 6, 12));
  const pantaloonGeo = trackGeo(new THREE.SphereGeometry(0.112, 14, 12));
  const pantaloonCuffGeo = trackGeo(new THREE.TorusGeometry(0.088, 0.026, 8, 18));
  const shinGeo = trackGeo(new THREE.CylinderGeometry(0.036, 0.026, 0.24, 10));
  const slipperGeo = trackGeo(new THREE.SphereGeometry(0.055, 12, 10));

  const legs: Array<{ hip: THREE.Group; knee: THREE.Group; side: -1 | 1 }> = [];
  for (const side of [-1, 1] as const) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0, 0);
    legRoot.add(hip);

    const thigh = new THREE.Mesh(thighGeo, velvetBody.material);
    thigh.position.y = -0.15;
    hip.add(thigh);

    // Fluffy violet leg-warmer pantaloon puff
    const puff = new THREE.Mesh(pantaloonGeo, pantaloonMat.material);
    puff.scale.set(1.0, 1.32, 1.0);
    puff.position.y = -0.25;
    hip.add(puff);

    const cuff = new THREE.Mesh(pantaloonCuffGeo, ruffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.y = -0.37;
    hip.add(cuff);

    const knee = new THREE.Group();
    knee.position.y = -0.38;
    hip.add(knee);

    const shin = new THREE.Mesh(shinGeo, velvetBody.material);
    shin.position.y = -0.13;
    knee.add(shin);

    // Pointed velvet slipper resting at y = -0.36 from knee (= -0.74 from pelvis = Y=0!)
    const slipper = new THREE.Mesh(slipperGeo, velvetPlum.material);
    slipper.scale.set(0.86, 0.56, 1.75);
    slipper.position.set(0, -0.33, -0.045);
    knee.add(slipper);

    legs.push({ hip, knee, side });
  }

  // -------------------------------------------------------------------------
  // Torso, velvet bustle abdomen, opera ruff, lace napkin + crimson stitch
  // -------------------------------------------------------------------------
  const bodyPivot = new THREE.Group();
  bodyPivot.position.y = -0.14;
  rigRoot.add(bodyPivot);

  // Contoured moth abdomen / velvet bustle extending slightly back (+Z)
  const abdomenGeo = trackGeo(new THREE.SphereGeometry(0.20, 18, 16));
  const abdomen = new THREE.Mesh(abdomenGeo, velvetBody.material);
  abdomen.scale.set(0.92, 1.18, 1.15);
  abdomen.position.set(0, 0.02, 0.10);
  abdomen.rotation.x = 0.28;
  bodyPivot.add(abdomen);

  // Delicate lilac-gold waist sash rings
  const sashGeo = trackGeo(new THREE.TorusGeometry(0.175, 0.018, 10, 24));
  const sash = new THREE.Mesh(sashGeo, goldTrimMat);
  sash.rotation.x = Math.PI / 2 + 0.12;
  sash.position.set(0, 0.16, 0.02);
  bodyPivot.add(sash);

  // Upper thorax
  const thoraxPivot = new THREE.Group();
  thoraxPivot.position.set(0, 0.18, 0);
  bodyPivot.add(thoraxPivot);

  const thoraxGeo = trackGeo(new THREE.SphereGeometry(0.19, 18, 16));
  const thorax = new THREE.Mesh(thoraxGeo, velvetPlum.material);
  thorax.scale.set(0.98, 1.24, 0.92);
  thorax.position.set(0, 0.19, -0.01);
  thoraxPivot.add(thorax);

  // Plump cream-lilac fur-stole opera ruff around the collar
  const ruffGroup = new THREE.Group();
  ruffGroup.position.set(0, 0.36, -0.01);
  thoraxPivot.add(ruffGroup);

  const ruffPuffGeo = trackGeo(new THREE.SphereGeometry(0.088, 12, 10));
  const ruffCount = 12;
  for (let i = 0; i < ruffCount; i++) {
    const a = (i / ruffCount) * Math.PI * 2;
    const puff = new THREE.Mesh(ruffPuffGeo, ruffMat);
    const rx = 0.195;
    const rz = 0.165;
    puff.position.set(Math.cos(a) * rx, Math.sin(a * 2) * 0.014, Math.sin(a) * rz);
    puff.scale.set(1.12, 0.92, 1.05);
    ruffGroup.add(puff);
  }

  // Instanced soft fluff bristles across the fur stole
  const rand = mulberry32(880400);
  const fluffGeo = trackGeo(new THREE.ConeGeometry(0.018, 0.075, 4));
  fluffGeo.translate(0, 0.037, 0);
  const fluffCount = 140;
  const fluffMesh = new THREE.InstancedMesh(fluffGeo, ruffMat, fluffCount);
  const dummy = new THREE.Object3D();
  const upVec = new THREE.Vector3(0, 1, 0);
  const dirVec = new THREE.Vector3();
  for (let i = 0; i < fluffCount; i++) {
    const ang = rand() * Math.PI * 2;
    const elev = (rand() - 0.35) * 0.9;
    const r = 0.22 + rand() * 0.03;
    dummy.position.set(Math.cos(ang) * r, elev * 0.06, Math.sin(ang) * r * 0.88);
    dirVec.set(Math.cos(ang), 0.35 + elev * 0.6, Math.sin(ang)).normalize();
    dummy.quaternion.setFromUnitVectors(upVec, dirVec);
    dummy.scale.setScalar(0.7 + rand() * 0.55);
    dummy.updateMatrix();
    fluffMesh.setMatrixAt(i, dummy.matrix);
  }
  fluffMesh.instanceMatrix.needsUpdate = true;
  ruffGroup.add(fluffMesh);

  // Lace napkin tucked under her chin (in case of moon!) + tiny crimson figure-8 stitch
  const napkinPivot = new THREE.Group();
  napkinPivot.position.set(0, 0.31, -0.175);
  thoraxPivot.add(napkinPivot);

  const napkinGeo = trackGeo(buildLaceNapkinGeometry());
  const napkinMesh = new THREE.Mesh(napkinGeo, napkinMat);
  napkinPivot.add(napkinMesh);

  // The tiny embroidered crimson figure-eight stitch in the napkin's lower-right corner
  const stitchGeo = trackGeo(buildFigureEightGeometry());
  const stitchMesh = new THREE.Mesh(stitchGeo, crimsonMat);
  stitchMesh.position.set(0.048, -0.145, -0.018);
  stitchMesh.rotation.z = 0.22;
  napkinPivot.add(stitchMesh);

  // -------------------------------------------------------------------------
  // Head, glossy star-glint eyes, plume antennae, and floating crescent tiara
  // -------------------------------------------------------------------------
  const headPivot = new THREE.Group();
  headPivot.position.set(0, 0.44, -0.02);
  thoraxPivot.add(headPivot);

  const headGeo = trackGeo(new THREE.SphereGeometry(0.165, 20, 16));
  const head = new THREE.Mesh(headGeo, velvetBody.material);
  head.scale.set(1.04, 0.96, 0.98);
  head.position.y = 0.12;
  headPivot.add(head);

  // Glossy black moth eyes with violet star-glints
  const eyeGeo = trackGeo(new THREE.SphereGeometry(0.064, 16, 14));
  const glintBigGeo = trackGeo(new THREE.OctahedronGeometry(0.016, 0));
  const glintSmallGeo = trackGeo(new THREE.SphereGeometry(0.009, 8, 8));
  const eyeGroups: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const eg = new THREE.Group();
    eg.position.set(side * 0.088, 0.135, -0.118);
    headPivot.add(eg);

    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.scale.set(0.92, 1.12, 0.85);
    eg.add(eye);

    const glintBig = new THREE.Mesh(glintBigGeo, starGlintMat);
    glintBig.position.set(side * 0.015, 0.026, -0.048);
    glintBig.scale.set(0.85, 1.25, 0.4);
    eg.add(glintBig);

    const glintSmall = new THREE.Mesh(glintSmallGeo, starGlintMat);
    glintSmall.position.set(-side * 0.016, -0.022, -0.048);
    eg.add(glintSmall);

    eyeGroups.push(eg);
  }

  // Two feathery opera-plume antennae (tips reach ~2.02 m in world space)
  const antennaL = buildPlumeAntenna(-1, antennaSpineMat, antennaBarbMat, geometries);
  antennaL.root.position.set(-0.072, 0.24, -0.02);
  headPivot.add(antennaL.root);

  const antennaR = buildPlumeAntenna(1, antennaSpineMat, antennaBarbMat, geometries);
  antennaR.root.position.set(0.072, 0.24, -0.02);
  headPivot.add(antennaR.root);

  // Floating glowing crescent-moon tiara between the antennae
  const tiaraPivot = new THREE.Group();
  tiaraPivot.position.set(0, 0.34, -0.03);
  headPivot.add(tiaraPivot);

  const tiaraGeo = trackGeo(buildCrescentTiaraGeometry());
  const tiaraMesh = new THREE.Mesh(tiaraGeo, tiaraShader.material);
  tiaraPivot.add(tiaraMesh);

  // -------------------------------------------------------------------------
  // Six limbs! Upper expressive opera arms + dainty middle napkin hands
  // -------------------------------------------------------------------------
  const upperArmGeo = trackGeo(new THREE.CapsuleGeometry(0.036, 0.18, 6, 10));
  const forearmGeo = trackGeo(new THREE.CapsuleGeometry(0.028, 0.17, 6, 10));
  const gloveGeo = trackGeo(new THREE.SphereGeometry(0.04, 10, 8));

  const upperArms: Array<{ shoulder: THREE.Group; elbow: THREE.Group; side: -1 | 1 }> = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.205, 0.30, -0.01);
    thoraxPivot.add(shoulder);

    const upper = new THREE.Mesh(upperArmGeo, velvetBody.material);
    upper.position.y = -0.11;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.22;
    shoulder.add(elbow);

    const fore = new THREE.Mesh(forearmGeo, velvetPlum.material);
    fore.position.y = -0.10;
    elbow.add(fore);

    const glove = new THREE.Mesh(gloveGeo, ruffMat);
    glove.scale.set(0.9, 1.15, 0.85);
    glove.position.y = -0.21;
    elbow.add(glove);

    upperArms.push({ shoulder, elbow, side });
  }

  // Dainty middle pair clasped near her waist that handles & dabs the lace napkin
  const midArmGeo = trackGeo(new THREE.CapsuleGeometry(0.022, 0.12, 5, 8));
  const midHandGeo = trackGeo(new THREE.SphereGeometry(0.028, 8, 8));
  const midArms: Array<{ shoulder: THREE.Group; forearm: THREE.Group; side: -1 | 1 }> = [];
  for (const side of [-1, 1] as const) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.155, 0.15, -0.06);
    thoraxPivot.add(shoulder);

    const upper = new THREE.Mesh(midArmGeo, velvetBody.material);
    upper.rotation.z = side * 0.55;
    upper.rotation.x = -0.45;
    upper.position.set(-side * 0.04, -0.05, -0.04);
    shoulder.add(upper);

    const forearm = new THREE.Group();
    forearm.position.set(-side * 0.08, -0.09, -0.09);
    shoulder.add(forearm);

    const lower = new THREE.Mesh(midArmGeo, velvetPlum.material);
    lower.scale.set(0.85, 0.85, 0.85);
    lower.rotation.z = -side * 0.72;
    lower.position.set(-side * 0.035, 0.02, -0.03);
    forearm.add(lower);

    const hand = new THREE.Mesh(midHandGeo, ruffMat);
    hand.position.set(-side * 0.065, 0.035, -0.055);
    forearm.add(hand);

    midArms.push({ shoulder, forearm, side });
  }

  // -------------------------------------------------------------------------
  // Four luna wings + twin articulated swallowtail hindwing trains (~0.88 m)
  // -------------------------------------------------------------------------
  const forewingGeo = trackGeo(buildForewingGeometry());
  const hindwingGeo = trackGeo(buildHindwingGeometry());
  const tailSegGeo = trackGeo(new THREE.PlaneGeometry(0.072, 0.24, 2, 4));
  tailSegGeo.translate(0, -0.12, 0);
  const tailTipGeo = trackGeo(new THREE.CircleGeometry(0.052, 12));
  tailTipGeo.scale(0.82, 1.45, 1);

  interface WingSide {
    side: -1 | 1;
    forePivot: THREE.Group;
    hindPivot: THREE.Group;
    tailSegs: THREE.Group[];
  }
  const wings: WingSide[] = [];

  for (const side of [-1, 1] as const) {
    const forePivot = new THREE.Group();
    forePivot.position.set(side * 0.12, 0.30, 0.10);
    thoraxPivot.add(forePivot);

    const foreMesh = new THREE.Mesh(forewingGeo, forewingShader.material);
    foreMesh.scale.x = side;
    forePivot.add(foreMesh);

    const hindPivot = new THREE.Group();
    hindPivot.position.set(side * 0.10, 0.18, 0.11);
    thoraxPivot.add(hindPivot);

    const hindMesh = new THREE.Mesh(hindwingGeo, hindwingShader.material);
    hindMesh.scale.x = side;
    hindPivot.add(hindMesh);

    // 4-segment articulated swallowtail ribbon (~0.92 m total length) trailing behind like an opera gown
    const tailSegs: THREE.Group[] = [];
    let parent: THREE.Group = hindPivot;
    for (let s = 0; s < 4; s++) {
      const seg = new THREE.Group();
      if (s === 0) seg.position.set(side * 0.26, -0.52, 0.02);
      else seg.position.set(0, -0.22, 0);
      const ribbon = new THREE.Mesh(tailSegGeo, hindwingShader.material);
      const widthScale = 1 - s * 0.14;
      ribbon.scale.set(widthScale, 1, 1);
      seg.add(ribbon);
      if (s === 3) {
        const spade = new THREE.Mesh(tailTipGeo, forewingShader.material);
        spade.position.y = -0.24;
        seg.add(spade);
      }
      parent.add(seg);
      tailSegs.push(seg);
      parent = seg;
    }

    wings.push({ side, forePivot, hindPivot, tailSegs });
  }

  // -------------------------------------------------------------------------
  // Shimmering instanced moondust sparkle trail (curls into a figure-eight)
  // -------------------------------------------------------------------------
  const dustCount = 24;
  const dustGeo = trackGeo(new THREE.OctahedronGeometry(0.036, 0));
  const dustMesh = new THREE.InstancedMesh(dustGeo, moondustMat, dustCount);
  dustMesh.frustumCulled = false;
  rigRoot.add(dustMesh);

  // -------------------------------------------------------------------------
  // Animation state
  // -------------------------------------------------------------------------
  let flightBlend = 0;
  let boostBlend = 0;
  let walkCycle = 0;
  let wingPhase = 0;
  let smoothBank = 0;
  let smoothPitch = 0;
  let smoothSpeed = 0;
  let blinkTimer = 2.6;
  let blinkAmount = 0;

  const update = (dt: number, elapsed: number, motion: AvatarMotionState) => {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    const speedNorm = clampNum(motion.speedNorm, 0, 2);
    smoothSpeed = damp(smoothSpeed, speedNorm, 9, safeDt);
    flightBlend = damp(flightBlend, motion.isFlying ? 1 : 0, 7.5, safeDt);
    boostBlend = damp(boostBlend, motion.boost, 6.5, safeDt);
    smoothBank = damp(smoothBank, clampNum(motion.turnRate * 0.24, -0.52, 0.52), 8, safeDt);
    smoothPitch = damp(smoothPitch, clampNum(motion.pitch, -0.5, 0.5), 8, safeDt);

    forewingShader.uBoost.value = boostBlend;
    forewingShader.uFlight.value = flightBlend;
    hindwingShader.uBoost.value = boostBlend;
    hindwingShader.uFlight.value = flightBlend;
    tiaraShader.uBoost.value = boostBlend;

    // Prim gliding sashay walk cycle
    const groundedWalk = (1 - flightBlend) * clampNum(smoothSpeed * 1.15, 0, 1);
    walkCycle += safeDt * (3.2 + smoothSpeed * 5.4);

    // Deep, unhurried 2.7 Hz luna-moth wingbeats in flight (faster on boost)
    const flapFreq = lerpNum(1.1, 2.75 + boostBlend * 1.1, flightBlend);
    wingPhase += safeDt * flapFreq * Math.PI * 2;

    // Eye blink cycle
    blinkTimer -= safeDt;
    if (blinkTimer <= 0) {
      blinkTimer = 2.4 + (Math.sin(elapsed * 7.3) * 0.5 + 0.5) * 2.8;
    }
    const targetBlink = blinkTimer > 0 && blinkTimer < 0.11 ? 1 : 0;
    blinkAmount = damp(blinkAmount, targetBlink, 28, safeDt);
    for (const eg of eyeGroups) {
      eg.scale.y = Math.max(0.14, 1 - blinkAmount * 0.85);
    }

    // Whole-body hover: lazy figure-eight in flight hover, gentle poise on foot
    const omega = (Math.PI * 2) / 3.5; // 3.5s figure-eight period
    const hoverScale = flightBlend * (1 - boostBlend * 0.7);
    const fig8X = Math.sin(elapsed * omega) * 0.08 * hoverScale;
    const fig8Y = Math.sin(elapsed * omega * 2) * 0.05 * hoverScale;

    // Idle "notices a bright light every ~8s, sways one step toward it, catches herself"
    const idleWeight = (1 - flightBlend) * (1 - clampNum(smoothSpeed * 2.5, 0, 1));
    const lightCycle = elapsed % 8.4;
    const lightSway =
      idleWeight *
      (lightCycle > 5.0 && lightCycle < 7.2
        ? Math.sin(((lightCycle - 5.0) / 2.2) * Math.PI)
        : 0);

    const strideBob = Math.abs(Math.sin(walkCycle)) * 0.032 * groundedWalk;
    const landSquash = clampNum(motion.landImpact, 0, 1);

    rigRoot.position.set(
      fig8X + lightSway * 0.05,
      0.92 + fig8Y + strideBob - landSquash * 0.08 + flightBlend * 0.14,
      -lightSway * 0.04,
    );
    rigRoot.scale.set(
      1 + landSquash * 0.08,
      1 - landSquash * 0.1,
      1 + landSquash * 0.08,
    );

    // Pitch forward into a sleek crescent dart during flight & Moonbite Dash
    const flyForwardPitch = flightBlend * (-0.34 - boostBlend * 0.52 + smoothPitch * 0.55);
    rigRoot.rotation.set(flyForwardPitch, 0, -smoothBank * (0.45 + flightBlend * 0.65));

    // Sashay hip sway & torso poise
    const sashay = Math.sin(walkCycle) * 0.09 * groundedWalk;
    bodyPivot.rotation.z = sashay;
    bodyPivot.rotation.y = Math.sin(walkCycle) * 0.11 * groundedWalk;
    thoraxPivot.rotation.y = -Math.sin(walkCycle) * 0.09 * groundedWalk + lightSway * 0.24;
    thoraxPivot.rotation.x =
      -0.06 * groundedWalk + Math.sin(elapsed * 2.1) * 0.025 * (1 - flightBlend);

    // Head curiosity: turns gently toward the light during idle, steadies in flight
    headPivot.rotation.y =
      Math.sin(elapsed * 0.65) * 0.14 * idleWeight + lightSway * 0.28 + smoothBank * 0.35;
    headPivot.rotation.x =
      -flyForwardPitch * 0.55 + Math.sin(elapsed * 1.4) * 0.04 * idleWeight - lightSway * 0.12;

    // Independent out-of-phase "day-tasting" plume antennae twitch + spring tip follow
    const sniffL =
      Math.sin(elapsed * 3.1) * 0.09 + Math.sin(elapsed * 7.8) * 0.045 * idleWeight;
    const sniffR =
      Math.cos(elapsed * 2.7 + 1.3) * 0.09 + Math.sin(elapsed * 6.9 + 2.1) * 0.045 * idleWeight;
    const sweptBack = flightBlend * 0.35 + boostBlend * 0.48 + groundedWalk * 0.08;
    antennaL.root.rotation.set(sweptBack + sniffL, -0.1, 0.08 + sniffL * 0.6);
    antennaR.root.rotation.set(sweptBack + sniffR, 0.1, -0.08 - sniffR * 0.6);
    antennaL.tipPivot.rotation.set(
      sweptBack * 0.4 + Math.sin(elapsed * 4.4 - 0.5) * 0.08,
      0,
      Math.cos(walkCycle) * 0.08 * groundedWalk,
    );
    antennaR.tipPivot.rotation.set(
      sweptBack * 0.4 + Math.cos(elapsed * 4.1 - 0.5) * 0.08,
      0,
      -Math.cos(walkCycle) * 0.08 * groundedWalk,
    );

    // Floating crescent-moon tiara bob + Moonbite Dash scale flare
    tiaraPivot.position.y = 0.345 + Math.sin(elapsed * 2.4) * 0.014;
    tiaraPivot.rotation.y = Math.sin(elapsed * 1.1) * 0.09;
    tiaraPivot.scale.setScalar(1 + boostBlend * 0.24);

    // Legs: prim short steps on foot, tucked gracefully back in flight
    for (const leg of legs) {
      const phase = walkCycle + (leg.side > 0 ? 0 : Math.PI);
      const step = Math.sin(phase) * 0.38 * groundedWalk;
      const lift = Math.max(0, Math.cos(phase)) * 0.42 * groundedWalk;
      const flyTuck = flightBlend * (-0.42 - boostBlend * 0.25);
      leg.hip.rotation.x = lerpNum(step, flyTuck, flightBlend);
      leg.hip.rotation.z = leg.side * (0.04 + flightBlend * 0.08);
      leg.knee.rotation.x = lerpNum(lift, 0.35 * flightBlend, flightBlend);
    }

    // Upper arms: poised opera swing on foot, swept gracefully in flight
    for (const arm of upperArms) {
      const swing = Math.sin(walkCycle + (arm.side > 0 ? Math.PI : 0)) * 0.28 * groundedWalk;
      arm.shoulder.rotation.x = lerpNum(swing - lightSway * 0.18, -0.35 - boostBlend * 0.3, flightBlend);
      arm.shoulder.rotation.z = arm.side * lerpNum(0.24 + groundedWalk * 0.08, 0.55 - boostBlend * 0.2, flightBlend);
      arm.elbow.rotation.x = lerpNum(-0.42 - lightSway * 0.22, -0.18, flightBlend);
    }

    // Dainty middle arms: clasped at waist, periodically dabbing her chin with the lace napkin!
    const dabCycle = elapsed % 5.6;
    const dab =
      idleWeight *
      (dabCycle > 1.8 && dabCycle < 3.0 ? Math.sin(((dabCycle - 1.8) / 1.2) * Math.PI) : 0);
    for (const arm of midArms) {
      const dabActive = arm.side > 0 ? dab : dab * 0.25;
      arm.shoulder.rotation.x = -0.15 - dabActive * 0.72 + flightBlend * 0.2;
      arm.shoulder.rotation.z = arm.side * (0.05 - dabActive * 0.14);
      arm.forearm.rotation.x = -dabActive * 0.48;
    }
    napkinPivot.rotation.x =
      -0.08 - dab * 0.24 - groundedWalk * 0.12 - flightBlend * 0.35 - boostBlend * 0.28;

    // Jump parasol snap-open when airborne off a jump
    const jumpAir = !motion.grounded && !motion.isFlying ? 1 : 0;
    const spreadBlend = Math.max(flightBlend, jumpAir * 0.85);

    // Wings: draped opera cape on foot -> sweeping wide luna beats in flight -> sleek crescent on boost
    const beatAngle = Math.sin(wingPhase) * (0.68 - boostBlend * 0.34);
    for (const w of wings) {
      // Opera-cape folded angle on foot (draped cleanly behind her back)
      const capeY = w.side * (1.26 + Math.sin(walkCycle) * 0.08 * groundedWalk);
      const capeZ = -w.side * 0.56;
      const capeX = 0.12;

      // Flight & boost wing pose
      const flyY = w.side * (0.18 + beatAngle * 0.78 + boostBlend * 0.62);
      const flyZ = w.side * (0.14 + Math.cos(wingPhase) * 0.18 - boostBlend * 0.35);
      const flyX = -0.06 + boostBlend * 0.14;

      w.forePivot.rotation.set(
        lerpNum(capeX, flyX, spreadBlend),
        lerpNum(capeY, flyY, spreadBlend),
        lerpNum(capeZ, flyZ, spreadBlend),
      );

      // Hindwings trail slightly behind forewing beat phase
      const hindBeat = Math.sin(wingPhase - 0.55) * (0.55 - boostBlend * 0.3);
      w.hindPivot.rotation.set(
        lerpNum(0.18, -0.08 + boostBlend * 0.18, spreadBlend),
        w.side * lerpNum(1.32 - Math.sin(walkCycle) * 0.07 * groundedWalk, 0.25 + hindBeat * 0.65 + boostBlend * 0.52, spreadBlend),
        w.side * lerpNum(-0.42, -0.12 - boostBlend * 0.22, spreadBlend),
      );

      // Articulated swallowtail hindwing ribbons: S-curve swish on foot, ruler-straight on Moonbite Dash!
      for (let s = 0; s < w.tailSegs.length; s++) {
        const seg = w.tailSegs[s];
        const wave = Math.sin(elapsed * (3.2 + flightBlend * 3.8) - s * 0.9 + (w.side > 0 ? 0 : 1.1));
        const swayAmp = (1 - boostBlend * 0.88) * (0.14 + s * 0.05);
        seg.rotation.x = lerpNum(0.16 + s * 0.06, 0.36 + boostBlend * 0.12, spreadBlend) + wave * swayAmp * 0.5;
        seg.rotation.z = w.side * (wave * swayAmp + smoothBank * 0.15);
      }
    }

    // Shimmering moondust trail (soft ambient glints in flight, bright curling figure-eight ribbon on boost)
    const dustVisibility = clampNum(flightBlend * 0.45 + boostBlend * 0.85, 0, 1);
    dustMesh.visible = dustVisibility > 0.02;
    if (dustMesh.visible) {
      for (let i = 0; i < dustCount; i++) {
        const frac = i / dustCount;
        const t = elapsed * (2.6 + boostBlend * 3.4) - frac * 2.4;
        // Ribbon trails behind (+Z) and curls into a figure-eight as it dissipates
        const curlRadius = (0.14 + frac * 0.42) * (0.55 + boostBlend * 0.75);
        const px = Math.sin(t * 2.0) * curlRadius;
        const py = Math.sin(t * 4.0) * curlRadius * 0.45 + 0.12;
        const pz = 0.26 + frac * (0.85 + boostBlend * 1.45);
        const lifeScale = Math.sin(frac * Math.PI) * dustVisibility * (0.45 + boostBlend * 0.85);
        dummy.position.set(px, py, pz);
        dummy.rotation.set(t, t * 1.3, 0);
        dummy.scale.setScalar(Math.max(0.001, lifeScale));
        dummy.updateMatrix();
        dustMesh.setMatrixAt(i, dummy.matrix);
      }
      dustMesh.instanceMatrix.needsUpdate = true;
    }
  };

  // Initialize cleanly into idle pose so bounding box checks match standing posture
  update(0.016, 0, IDLE_MOTION_STATE);

  return {
    group,
    setAccentColor: applyAccent,
    update,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
