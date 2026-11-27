import * as THREE from 'three/webgpu';
import { HOLE_RADIUS, MONSTER_RADIUS, POOL_Y, groundAt, type Monster } from './logic';
import {
  dripMaterial,
  fadeMaterial,
  hornMaterial,
  plainMaterial,
  skinMaterial,
  type ClimateUniforms,
  type Resources,
} from './materials';

const HORN_LENGTH = 3.2;

/** A horn: a tapered tube rising from its root and curling outward, then forward at the tip. */
function hornGeometry(side: -1 | 1): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(side * 0.7, 0.9, -0.15),
    new THREE.Vector3(side * 1.45, 2.0, -0.05),
    new THREE.Vector3(side * 1.55, 2.85, 0.45),
    new THREE.Vector3(side * 1.25, HORN_LENGTH, 0.95),
  ]);
  const rings = 24;
  const sides = 12;
  const frames = curve.computeFrenetFrames(rings, false);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const centre = curve.getPointAt(t);
    const radius = 0.55 * (1 - t) ** 0.85 + 0.02;
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
      positions.push(centre.x + n.x * radius, centre.y + n.y * radius, centre.z + n.z * radius);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j;
      const b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

const DROPS_PER_SOURCE = 4;
/** Where the chest pivots (above the pool), and the head on it: low and forward, so he looms. */
const CHEST_Y = 0.3;
/** He stands this far up out of the pool at rest, so his chest clears the rim. */
const RISE = 1.3;
const HEAD_AT = new THREE.Vector3(0, 3.05, 0.95);
const UPPER_ARM = 2.3;
const FOREARM = 2.1;

/** A springy joint value: chases its target with weight and a little overshoot. */
interface Spring { x: number; v: number }
const spring = (x = 0): Spring => ({ x, v: 0 });
function chase(s: Spring, target: number, dt: number, stiffness = 26, damping = 0.75): number {
  const w = Math.sqrt(stiffness);
  s.v += (stiffness * (target - s.x) - 2 * damping * w * s.v) * dt;
  s.x += s.v * dt;
  return s.x;
}

interface Drop {
  source: number;
  x: number;
  y: number;
  z: number;
  vy: number;
  wait: number;
}

/**
 * The lava monster, from the chest up, bobbing in his pool: a grumpy, glowing-eyed brute with a
 * heavy brow, fangs and a jaw that drops open to roar, and two large horns that drip lava
 * (or, frozen, shed snowflakes).
 */
export function createMonster(res: Resources, u: ClimateUniforms, rand: () => number) {
  const group = new THREE.Group();
  group.name = 'monster';
  const body = new THREE.Group();
  const chest = new THREE.Group();
  chest.position.y = CHEST_Y;
  const head = new THREE.Group();
  head.position.copy(HEAD_AT);
  group.add(body);
  body.add(chest);
  chest.add(head);

  const skin = skinMaterial(u, res.own);
  const belly = skinMaterial(u, res.own, true);
  const spikeMat = hornMaterial(u, res.own, 1);
  const sphereGeo0 = res.geo(new THREE.SphereGeometry(1, 24, 16));
  const spikeGeo = res.geo(new THREE.ConeGeometry(0.22, 1, 7).translate(0, 0.5, 0));

  // Waist: thick, sunk into the pool.
  const waistProfile = [[0.01, -5.5], [MONSTER_RADIUS - 0.2, -5.5], [MONSTER_RADIUS, -2.6], [MONSTER_RADIUS + 0.1, -0.6], [MONSTER_RADIUS - 0.1, 0.6], [0.01, 0.7]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const waist = new THREE.Mesh(res.geo(new THREE.LatheGeometry(waistProfile, 28)), skin);
  waist.name = 'monster-torso';
  body.add(waist);

  // Chest: a huge hunched barrel with slabbed pecs, swelling into heavy shoulders.
  const ribs = new THREE.Mesh(sphereGeo0, skin);
  ribs.scale.set(2.75, 2.0, 2.1);
  ribs.position.set(0, 1.0, 0.15);
  const traps = new THREE.Mesh(sphereGeo0, skin);
  traps.scale.set(2.3, 1.1, 1.5);
  traps.position.set(0, 2.25, -0.25);
  chest.add(ribs, traps);
  for (const side of [-1, 1]) {
    const pec = new THREE.Mesh(sphereGeo0, belly);
    pec.scale.set(1.25, 0.85, 0.65);
    pec.position.set(side * 1.05, 1.35, 1.55);
    pec.rotation.set(0.2, side * 0.35, side * -0.15);
    const delt = new THREE.Mesh(sphereGeo0, skin);
    delt.scale.set(1.15, 1.0, 1.1);
    delt.position.set(side * 2.55, 1.95, 0.05);
    chest.add(pec, delt);
  }
  // Abs: a few plates down the belly, just above the lava.
  for (let row = 0; row < 2; row++) {
    for (const side of [-1, 1]) {
      const plate = new THREE.Mesh(sphereGeo0, belly);
      plate.scale.set(0.55, 0.38, 0.35);
      plate.position.set(side * 0.55, 0.35 - row * 0.65, 1.85 - row * 0.1);
      chest.add(plate);
    }
  }
  // Spikes: a ridge down the back, and a crown on each shoulder.
  const spike = (parent: THREE.Object3D, x: number, y: number, z: number, rx: number, rz: number, len: number) => {
    const s2 = new THREE.Mesh(spikeGeo, spikeMat);
    s2.position.set(x, y, z);
    s2.rotation.set(rx, 0, rz);
    s2.scale.set(1 + len * 0.3, len, 1 + len * 0.3);
    parent.add(s2);
  };
  for (let i = 0; i < 6; i++) spike(chest, 0, 2.9 - i * 0.55, -1.2 - Math.sin(i * 0.5) * 0.6, -1.0 - i * 0.12, 0, 1.3 - i * 0.12);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) spike(chest, side * (2.4 + i * 0.35), 2.7 - i * 0.12, -0.2 + i * 0.25, -0.3, side * -(0.4 + i * 0.25), 1.1 - i * 0.2);
  }

  // Arms: shoulder → elbow → wrist → four clawed fingers, each joint on a spring.
  const upperGeo = res.geo(new THREE.CapsuleGeometry(0.72, UPPER_ARM - 0.6, 6, 14).translate(0, -UPPER_ARM / 2, 0));
  const foreGeo = res.geo(new THREE.CapsuleGeometry(0.62, FOREARM - 0.5, 6, 14).translate(0, -FOREARM / 2, 0));
  const fingerGeo = res.geo(new THREE.CapsuleGeometry(0.17, 0.45, 4, 8).translate(0, -0.35, 0));
  const clawGeo = res.geo(new THREE.ConeGeometry(0.13, 0.55, 6).translate(0, 0.27, 0).rotateX(Math.PI));
  const clawMat = hornMaterial(u, res.own, -0.55);
  interface Arm {
    side: -1 | 1;
    shoulder: THREE.Group;
    elbow: THREE.Group;
    wrist: THREE.Group;
    fingers: THREE.Group[];
    claws: THREE.Object3D[];
    /** How far the arm is raised to keep out of the rock, and how hard the hand grips the edge. */
    lift: number;
    grip: number;
    j: { sx: Spring; sz: Spring; sy: Spring; el: Spring; wr: Spring; curl: Spring };
  }
  const arms: Arm[] = ([-1, 1] as const).map(side => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 2.7, 1.85, 0.1);
    const upper = new THREE.Mesh(upperGeo, skin);
    const bicep = new THREE.Mesh(sphereGeo0, skin);
    bicep.scale.set(0.8, 0.95, 0.85);
    bicep.position.set(0, -1.0, 0.18);
    shoulder.add(upper, bicep);
    const elbow = new THREE.Group();
    elbow.name = 'arm-elbow';
    elbow.position.y = -UPPER_ARM;
    const fore = new THREE.Mesh(foreGeo, skin);
    elbow.add(fore);
    // A row of spines along the back of the forearm.
    for (let i = 0; i < 3; i++) spike(elbow, side * 0.25, -0.4 - i * 0.55, -0.45, -2.2, side * 0.3, 0.7 - i * 0.12);
    shoulder.add(elbow);
    const wrist = new THREE.Group();
    wrist.name = 'arm-wrist';
    wrist.position.y = -FOREARM;
    const palm = new THREE.Mesh(sphereGeo0, belly);
    palm.scale.set(0.75, 0.55, 0.65);
    palm.position.y = -0.3;
    wrist.add(palm);
    elbow.add(wrist);
    const fingers: THREE.Group[] = [];
    const claws: THREE.Object3D[] = [];
    for (let f = 0; f < 4; f++) {
      const finger = new THREE.Group();
      const thumb = f === 3;
      finger.position.set(thumb ? -side * 0.55 : (f - 1) * 0.36, -0.55, thumb ? 0.15 : 0.35);
      finger.rotation.set(0, 0, thumb ? side * 0.6 : (f - 1) * -0.12);
      finger.add(new THREE.Mesh(fingerGeo, skin));
      const claw = new THREE.Mesh(clawGeo, clawMat);
      claw.name = 'arm-claw';
      claw.position.y = -0.75;
      claw.rotation.x = 0.35;
      finger.add(claw);
      wrist.add(finger);
      fingers.push(finger);
      claws.push(claw);
    }
    chest.add(shoulder);
    return { side, shoulder, elbow, wrist, fingers, claws, lift: 0, grip: 0, j: { sx: spring(-0.5), sz: spring(side * 0.35), sy: spring(0), el: spring(-1.1), wr: spring(0), curl: spring(0.6) } };
  });
  const lean = { x: spring(0.06), z: spring(0), twist: spring(0) };
  // How far he stands up out of the pool: tall by default, taller when you come close, and
  // surging right up out of the lava to roar down at you.
  const rise = spring(RISE);

  // Head: a broad, flat-topped skull with a jutting snout.
  const skull = new THREE.Mesh(res.geo(new THREE.SphereGeometry(2, 36, 24)), skin);
  skull.scale.set(1.08, 0.82, 0.95);
  // A hard, faceted snout that stops above the fangs, so they hang bare beneath it.
  const facetGeo = res.geo(new THREE.IcosahedronGeometry(1, 1));
  const muzzle = new THREE.Mesh(facetGeo, skin);
  muzzle.scale.set(1.05, 0.4, 0.85);
  muzzle.position.set(0, 0.02, 1.5);
  muzzle.rotation.x = -0.12;
  head.add(skull, muzzle);

  // ---- The angry face. Everything that moves is kept in `face` for update().
  const fang = plainMaterial(res.own, '#f3e6d2', { roughness: 0.35 });
  const eyeGlow = fadeMaterial(u, res.own, { color: '#ffd23a', emissive: '#ffb020', glow: 3.2 }, { color: '#d8f6ff', emissive: '#6fe0ff', glow: 2.6 }, { roughness: 0.2 });
  const slit = fadeMaterial(u, res.own, { color: '#1a0500', emissive: '#300800', glow: 1 }, { color: '#04121f', emissive: '#001020', glow: 1 });
  const mouthGlow = fadeMaterial(u, res.own, { color: '#3a0a02', emissive: '#ff4400', glow: 1 }, { color: '#0a1a2c', emissive: '#2f8fd0', glow: 1 });
  const sphereGeo = sphereGeo0;

  // Glowing eyes, narrow and slanted in toward the nose, under a heavy brow.
  const eyes: THREE.Group[] = [];
  const brows: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.78, 0.38, 1.72);
    eye.rotation.set(0, side * 0.28, side * 0.38);
    // A dark, sunken socket with a small burning ember deep inside: no pupil, just glare.
    const socket = new THREE.Mesh(sphereGeo, slit);
    socket.scale.set(0.46, 0.26, 0.2);
    socket.position.z = -0.04;
    const ball = new THREE.Mesh(sphereGeo, eyeGlow);
    ball.scale.set(0.3, 0.11, 0.16);
    ball.position.z = 0.03;
    eye.add(socket, ball);
    head.add(eye);
    eyes.push(eye);

    const brow = new THREE.Mesh(res.geo(new THREE.CapsuleGeometry(0.2, 0.75, 4, 10).rotateZ(Math.PI / 2)), skin);
    brow.position.set(side * 0.74, 0.6, 1.86);
    brow.rotation.set(0.1, side * 0.3, side * 0.45);
    head.add(brow);
    brows.push(brow);
  }
  // A ridged snout with flaring nostrils.
  const nostrils: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const n = new THREE.Mesh(sphereGeo, slit);
    n.scale.set(0.13, 0.09, 0.1);
    n.position.set(side * 0.32, -0.08, 2.08);
    head.add(n);
    nostrils.push(n);
  }

  // The mouth: a glowing throat, jagged fangs on top, and a lower jaw that drops open.
  const throat = new THREE.Mesh(sphereGeo, mouthGlow);
  throat.scale.set(0.95, 0.55, 0.5);
  throat.position.set(0, -0.75, 1.45);
  head.add(throat);
  const fangGeo = res.geo(new THREE.ConeGeometry(0.11, 0.5, 6));
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * 0.3;
    const f = new THREE.Mesh(fangGeo, fang);
    f.position.set(x, -0.58 - (Math.abs(x) < 0.5 ? 0 : 0.06), 1.95 - Math.abs(x) * 0.28);
    f.rotation.set(Math.PI + 0.15, 0, x * 0.2);
    f.scale.setScalar(i === 1 || i === 4 ? 1.5 : 0.8);
    head.add(f);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.65, 0.4);
  // A narrow, angular lower jaw that tucks in behind the snout.
  const chin = new THREE.Mesh(facetGeo, skin);
  chin.scale.set(0.95, 0.26, 1.05);
  chin.position.set(0, -0.32, 0.8);
  jaw.add(chin);
  for (let i = 0; i < 5; i++) {
    const x = (i - 2) * 0.34;
    const f = new THREE.Mesh(fangGeo, fang);
    f.position.set(x, -0.1, 1.68 - Math.abs(x) * 0.32);
    f.rotation.set(-0.15, 0, -x * 0.2);
    f.scale.setScalar(i === 0 || i === 4 ? 1.2 : 0.65);
    jaw.add(f);
  }
  head.add(jaw);
  // Horns.
  const horn = hornMaterial(u, res.own, HORN_LENGTH);
  for (const side of [-1, 1] as const) {
    const h = new THREE.Mesh(res.geo(hornGeometry(side)), horn);
    h.position.set(side * 1.0, 1.45, -0.1);
    h.name = 'monster-horn';
    head.add(h);
  }

  // Where he meets the pool: a glowing ring of molten lava, then a collar of ice.
  const collar = new THREE.Mesh(
    res.geo(new THREE.TorusGeometry(MONSTER_RADIUS + 0.15, 0.22, 10, 48).rotateX(Math.PI / 2)),
    fadeMaterial(u, res.own, { color: '#ff8a1a', emissive: '#ff5a10', glow: 2.2 }, { color: '#e6f6ff', emissive: '#7fc8ff', glow: 0.35 }, { roughness: 0.2 }),
  );
  group.add(collar);

  // Drips: from the horn tips, the jaw and every claw.
  const DRIP_SOURCES: Array<{ from: THREE.Object3D; at: [number, number, number] }> = [
    { from: head, at: [-1.25 - 1.0, 1.45 + HORN_LENGTH, 0.85] },
    { from: head, at: [1.25 + 1.0, 1.45 + HORN_LENGTH, 0.85] },
    { from: jaw, at: [0, -0.5, 1.6] },
    ...arms.flatMap(arm => arm.claws.slice(0, 3).map(claw => ({ from: claw, at: [0, -0.5, 0] as [number, number, number] }))),
  ];
  const drops: Drop[] = [];
  DRIP_SOURCES.forEach((_, source) => {
    for (let i = 0; i < DROPS_PER_SOURCE; i++) drops.push({ source, x: 0, y: -99, z: 0, vy: 0, wait: rand() * 3 });
  });
  const dropMesh = new THREE.InstancedMesh(res.geo(new THREE.SphereGeometry(0.13, 8, 6)), dripMaterial(u, res.own), drops.length);
  dropMesh.name = 'monster-drips';
  dropMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const at = new THREE.Vector3();
  const poolY = POOL_Y;

  const mouth = new THREE.Vector3();
  return {
    group,
    drops: dropMesh,
    /** The mouth, in room coordinates, as of the last update. */
    mouth,
    update(m: Monster, dt: number, elapsed: number, yell: { windup: number; roar: number; open: number }, target: { x: number; z: number } | null) {
      const ice = u.ice.value as number;
      group.position.set(m.x, POOL_Y + m.bob, m.z);
      body.rotation.y = m.yaw;
      // Where the player is, in his own frame: ahead (+z), to his left/right (x), and how close.
      const fwdX = Math.sin(m.yaw);
      const fwdZ = Math.cos(m.yaw);
      const speedFwd = m.vx * fwdX + m.vz * fwdZ;
      const speedSide = m.vx * fwdZ - m.vz * fwdX;
      let near = 0;
      let targetSide = 0;
      if (target) {
        const dx = target.x - m.x;
        const dz = target.z - m.z;
        const dist = Math.hypot(dx, dz);
        near = 1 - Math.min(1, Math.max(0, (dist - 7) / 7));
        targetSide = (dx * fwdZ - dz * fwdX) / (dist || 1);
      }
      const rear = yell.windup * (1 - yell.roar);
      // Hunched and stalking: he leans in as you come close, surges when he moves, rears back to
      // draw breath, and lunges on the roar.
      const breathe = Math.sin(elapsed * (1.4 + rear * 3));
      chest.rotation.x = chase(lean.x, 0.06 - near * 0.08 + speedFwd * 0.06 - rear * 0.4 + yell.roar * 0.2, dt, 14);
      chest.rotation.z = chase(lean.z, -speedSide * 0.07, dt, 10);
      chest.rotation.y = chase(lean.twist, targetSide * 0.35, dt, 12);
      chest.scale.set(1 + breathe * 0.015 + rear * 0.06, 1 + breathe * 0.025, 1 + breathe * 0.02 + rear * 0.05);
      body.rotation.set(0, m.yaw, 0);
      body.position.y = chase(rise, RISE + near * 0.5 + yell.windup * 1.9 - yell.roar * 0.3 + speedFwd * 0.05, dt, 10, 0.55);

      // Arms: wading through the lava when he moves, reaching and clawing at you when you're
      // close, flung wide on the in-breath and thrust out on the roar.
      const wade = Math.min(1, Math.hypot(m.vx, m.vz) / 2);
      arms.forEach(arm => {
        const { side, j } = arm;
        const phase = elapsed * 2.4 + (side < 0 ? 0 : Math.PI);
        const toward = side * targetSide > 0.15 ? 1 : 0.35;
        const reach = near * toward * (0.7 + 0.3 * Math.sin(elapsed * 1.7 + side));
        const claw = Math.max(0, Math.sin(elapsed * 3.1 + side * 1.3)) ** 2;
        let sx = -0.55 - wade * 0.35 * Math.sin(phase) - reach * 0.9;
        let sz = side * (0.6 + wade * 0.15 + near * 0.15);
        let el = -1.15 + wade * 0.4 * Math.cos(phase) + reach * 0.75;
        let wr = -0.2 - reach * 0.3;
        let curl = 0.55 + 0.35 * claw - reach * 0.4;
        // Arms spread wide and high as he draws breath, then slam forward with the roar.
        sx += rear * 0.6 - yell.roar * 0.9;
        sz += side * (rear * 1.15 + yell.roar * 0.35);
        el += -rear * 0.5 + yell.roar * 0.8;
        curl += -rear * 0.4 - yell.roar * 0.8;
        // Keep out of the rim: raise the arm as far as the rock needs, lay the hand flat on top
        // and hook the claws over the edge.
        sx -= arm.lift;
        el += arm.lift * 0.35;
        wr += arm.grip * 0.7;
        curl += arm.grip * 0.6;
        arm.shoulder.rotation.set(chase(j.sx, sx, dt), chase(j.sy, -side * reach * 0.4, dt), chase(j.sz, sz, dt), 'XZY');
        arm.elbow.rotation.x = chase(j.el, el, dt, 30);
        arm.wrist.rotation.x = chase(j.wr, wr, dt, 34);
        const c = chase(j.curl, curl, dt, 40, 0.6);
        arm.fingers.forEach((f, i) => { f.rotation.x = c * (i === 3 ? 0.6 : 1) + Math.sin(elapsed * 6 + i) * 0.04; });
      });
      let turn = m.headYaw - m.yaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      // A grumbling, twitching face: brows that furrow, eyes that narrow and flare, a jaw that
      // works and snarls. On a yell he rears back, then lunges with his jaw dropped wide.
      const grumble = Math.sin(elapsed * 2.3) * 0.5 + Math.sin(elapsed * 5.1 + 1) * 0.3;
      const twitch = Math.max(0, Math.sin(elapsed * 0.83) * Math.sin(elapsed * 3.7)) ** 3;
      const shake = yell.roar * Math.sin(elapsed * 38) * 0.05;
      head.rotation.set(
        0.22 + near * 0.1 - rear * 0.45 - yell.roar * 0.05 + Math.sin(elapsed * 0.9) * 0.04,
        Math.max(-0.8, Math.min(0.8, turn)) + shake,
        Math.sin(elapsed * 0.7) * 0.05 + shake * 0.6,
      );
      head.position.set(HEAD_AT.x, HEAD_AT.y + near * 0.1, HEAD_AT.z + near * 0.3 + yell.roar * 0.6 - rear * 0.35);
      jaw.rotation.x = 0.16 + Math.max(0, grumble) * 0.1 + yell.open * 0.75;
      throat.scale.set(0.95, 0.55 + yell.open * 0.35, 0.5);
      const fury = 0.6 + 0.4 * Math.max(yell.windup, yell.roar);
      brows.forEach((brow, i) => {
        const side = i === 0 ? -1 : 1;
        brow.rotation.z = side * (0.36 + 0.18 * fury + twitch * 0.12 * (i === 0 ? 1 : 0.4));
        brow.position.y = 0.62 - 0.07 * fury - twitch * 0.04 + yell.roar * 0.05;
      });
      eyes.forEach(eye => {
        // Squint while grumbling, eyes wide and blazing on the roar.
        eye.scale.set(1, 0.85 - 0.15 * Math.max(0, grumble) * (1 - yell.roar) + yell.roar * 0.35, 1);
      });
      nostrils.forEach(n => n.scale.set(0.13 * (1 + yell.windup * 0.6), 0.09 * (1 + yell.windup * 0.6), 0.1));
      collar.position.y = -m.bob;
      collar.scale.setScalar(1 + Math.sin(elapsed * 2.7) * 0.03);
      group.updateMatrixWorld(true);
      head.localToWorld(mouth.set(0, -0.75, 2.2));
      // Feel for the rock: how deep the elbow, wrist or claws sit in it, or how close above it.
      arms.forEach(arm => {
        let pen = -Infinity;
        for (const part of [arm.elbow, arm.wrist, ...arm.claws]) {
          part.getWorldPosition(at);
          if (Math.hypot(at.x, at.z) < HOLE_RADIUS - 0.4) continue;
          pen = Math.max(pen, groundAt(at.x, at.z).y + 0.12 - at.y);
        }
        // Lift fast when in the rock, settle back down slowly when clear.
        arm.lift = Math.min(1.8, Math.max(0, arm.lift + (pen > 0 ? pen * 14 : -0.5) * dt));
        const touching = pen > -0.35 ? 1 : 0;
        arm.grip += (touching - arm.grip) * (1 - Math.exp(-8 * dt));
      });

      // Lava falls fast and splashes; snowflakes drift down slowly, swaying.
      const gravity = 9 - 8 * ice;
      drops.forEach((d, i) => {
        if (d.wait > 0) {
          d.wait -= dt;
          if (d.wait <= 0) {
            const src = DRIP_SOURCES[d.source];
            at.set(...src.at);
            src.from.localToWorld(at);
            d.x = at.x + (rand() - 0.5) * 0.2;
            d.y = at.y;
            d.z = at.z + (rand() - 0.5) * 0.2;
            d.vy = 0;
          }
          dummy.scale.setScalar(0);
        } else {
          d.vy -= gravity * dt;
          d.vy = Math.max(d.vy, -(14 - 12.5 * ice));
          d.y += d.vy * dt;
          d.x += Math.sin(elapsed * 2 + i) * ice * dt * 0.6;
          const stretch = 1 + Math.min(1.4, -d.vy * 0.12) * (1 - ice);
          dummy.scale.set(1 - 0.3 * ice, stretch * (1 - 0.6 * ice), 1 - 0.3 * ice);
          if (d.y < poolY) d.wait = 0.4 + rand() * 2.2;
        }
        dummy.position.set(d.x, d.y, d.z);
        dummy.updateMatrix();
        dropMesh.setMatrixAt(i, dummy.matrix);
      });
      dropMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
