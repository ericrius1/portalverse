import * as THREE from 'three/webgpu';
import { mesh, span, type Resources } from './tools';

const YELLOW = '#ffc21a';
const BLACK = '#1c1410';

/** Radius of the jacket at a height, from the hem to the collar. */
const JACKET_PROFILE: Array<[number, number]> = [
  [1.0, -0.98], [1.22, -0.78], [1.24, -0.35], [1.16, 0.15], [0.98, 0.52], [0.62, 0.78],
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

/**
 * A strip lying on the front of the jacket. `edges` gives its left and right
 * angles (radians from straight ahead) at each height.
 */
function frontPanel(
  bottom: number,
  top: number,
  lift: number,
  edges: (t: number) => [number, number],
): THREE.BufferGeometry {
  const rows = 14;
  const columns = 6;
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

/** Short hairs standing out from an ellipsoid. */
function fuzz(
  res: Resources,
  center: THREE.Vector3,
  radii: THREE.Vector3,
  count: number,
  colorAt: (unit: THREE.Vector3) => string,
  keep: (unit: THREE.Vector3) => boolean,
  rand: () => number,
): THREE.InstancedMesh {
  const hairs = new THREE.InstancedMesh(
    res.geo(new THREE.ConeGeometry(0.035, 0.3, 3)),
    res.mat('#ffffff', { roughness: 1 }),
    count,
  );
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
    // Hairs droop a little, which reads as soft fur.
    normal.y -= 0.35;
    dummy.quaternion.setFromUnitVectors(up, normal.normalize());
    dummy.scale.setScalar(0.65 + rand() * 0.7);
    dummy.updateMatrix();
    hairs.setMatrixAt(i, dummy.matrix);
    hairs.setColorAt(i, color.set(colorAt(unit)));
  }
  return hairs;
}

export interface Bee {
  group: THREE.Group;
  /** Flap the wings and work the jaw. `chew` runs from 0 (closed) to 1 (wide open). */
  animate(elapsed: number, chew: number): void;
}

/** A giant fuzzy bee, upright, facing +Z, dressed in a blue jacket and red tie. */
export function createBee(res: Resources, rand: () => number): Bee {
  const group = new THREE.Group();
  group.name = 'bee';

  const yellow = res.mat(YELLOW);
  const black = res.mat(BLACK);
  const white = res.mat('#ffffff', { roughness: 0.4 });
  const blue = res.mat('#1f4396', { roughness: 0.6, side: THREE.DoubleSide });
  const lapelBlue = res.mat('#16306f', { roughness: 0.45, side: THREE.DoubleSide });
  const shirt = res.mat('#f7f4ee', { roughness: 0.5, side: THREE.DoubleSide });
  const red = res.mat('#d0141f', { roughness: 0.4, emissive: '#3a0004', side: THREE.DoubleSide });
  const gold = res.mat('#f2c14e', { metalness: 0.55, roughness: 0.3 });
  const ball = res.geo(new THREE.SphereGeometry(1, 24, 18));
  const limb = res.geo(new THREE.CylinderGeometry(1, 1, 1, 10));

  // Striped abdomen.
  const stripe = (unitY: number) => (Math.floor((unitY + 1) * 3.2) % 2 ? BLACK : YELLOW);
  const abdomenGeo = res.geo(new THREE.SphereGeometry(1, 28, 36).toNonIndexed());
  const points = abdomenGeo.getAttribute('position');
  const colors = new Float32Array(points.count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < points.count; i += 3) {
    color.set(stripe((points.getY(i) + points.getY(i + 1) + points.getY(i + 2)) / 3));
    for (let k = 0; k < 3; k++) color.toArray(colors, (i + k) * 3);
  }
  abdomenGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const abdomenCenter = new THREE.Vector3(0, -1.5, -0.35);
  const abdomenRadii = new THREE.Vector3(1.15, 1.2, 1.15);
  const abdomen = mesh(abdomenGeo, res.mat('#ffffff', { vertexColors: true }));
  abdomen.position.copy(abdomenCenter);
  abdomen.scale.copy(abdomenRadii);
  group.add(abdomen);
  group.add(fuzz(res, abdomenCenter, abdomenRadii, 900, u => stripe(u.y), u => u.y < 0.55, rand));

  const stinger = mesh(res.geo(new THREE.ConeGeometry(0.2, 0.6, 10)), black, [0, -2.6, -0.85]);
  stinger.rotation.x = Math.PI + 0.5;
  group.add(stinger);

  // Head.
  const headCenter = new THREE.Vector3(0, 1.58, 0.45);
  const headRadius = new THREE.Vector3(1.12, 1.08, 1.1);
  const head = mesh(ball, yellow);
  head.position.copy(headCenter);
  head.scale.copy(headRadius);
  group.add(head);
  // Fur everywhere but the face.
  group.add(fuzz(res, headCenter, headRadius, 520, () => YELLOW, u => u.z < 0.45 || u.y > 0.65, rand));

  for (const side of [-1, 1]) {
    group.add(
      mesh(ball, black, [side * 0.43, 1.8, 1.43], [0.27, 0.35, 0.17]),
      mesh(ball, white, [side * 0.36, 1.93, 1.59], [0.08, 0.09, 0.05]),
    );
    const stalk = new THREE.Mesh(limb, black);
    const tip = new THREE.Vector3(side * 0.85, 3.2, 0.7);
    span(stalk, new THREE.Vector3(side * 0.4, 2.5, 0.55), tip, 0.055);
    group.add(stalk, mesh(ball, black, [tip.x, tip.y, tip.z], [0.19, 0.19, 0.19]));
  }
  const mouth = mesh(ball, res.mat('#4a0d12'), [0, 1.14, 1.47], [0.32, 0.07, 0.12]);
  group.add(mouth);

  // Blue jacket with shirt, lapels, tie, buttons and pocket square.
  const jacket = new THREE.Group();
  jacket.name = 'bee-jacket';
  const profile = JACKET_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  jacket.add(mesh(res.geo(new THREE.LatheGeometry(profile, 40)), blue));
  const opening = (t: number) => 0.04 + 0.6 * t;
  jacket.add(mesh(res.geo(frontPanel(-0.4, 0.76, 0.015, t => [-opening(t), opening(t)])), shirt));
  for (const side of [-1, 1]) {
    jacket.add(mesh(res.geo(frontPanel(-0.4, 0.76, 0.035, t => {
      const inner = side * opening(t);
      const outer = side * (opening(t) + 0.06 + 0.22 * Math.sin(Math.PI * t * 0.85));
      return side < 0 ? [outer, inner] : [inner, outer];
    })), lapelBlue));
    // Collar points.
    const collar = mesh(res.geo(new THREE.ConeGeometry(0.17, 0.42, 3)), shirt, [side * 0.27, 0.68, 0.84]);
    collar.rotation.set(0.2, 0, side * 2.25);
    jacket.add(collar);
  }
  for (const y of [-0.55, -0.8]) {
    jacket.add(mesh(ball, gold, [0, y, jacketRadius(y) + 0.03], [0.09, 0.09, 0.05]));
  }
  jacket.add(mesh(res.geo(frontPanel(0.02, 0.14, 0.05, () => [0.58, 0.78])), shirt));
  group.add(jacket);

  const tie = new THREE.Group();
  tie.name = 'bee-tie';
  // The blade widens downward and ends in a point.
  tie.add(mesh(res.geo(frontPanel(-0.62, 0.58, 0.075, t => {
    const half = t < 0.18 ? (t / 0.18) * 0.19 : 0.19 - 0.12 * ((t - 0.18) / 0.82);
    return [-half, half];
  })), red));
  tie.add(mesh(ball, red, [0, 0.64, jacketRadius(0.64) + 0.08], [0.17, 0.13, 0.1]));
  group.add(tie);

  // Sleeves, cuffs and hands.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Vector3(side * 0.95, 0.3, 0.05);
    const wrist = new THREE.Vector3(side * 1.65, -0.65, 0.65);
    const sleeve = new THREE.Mesh(limb, blue);
    span(sleeve, shoulder, wrist, 0.25);
    const cuff = new THREE.Mesh(limb, shirt);
    span(cuff, wrist, wrist.clone().lerp(shoulder, -0.14), 0.19);
    group.add(
      mesh(ball, blue, [shoulder.x, shoulder.y, shoulder.z], [0.34, 0.34, 0.34]),
      sleeve,
      cuff,
      mesh(ball, black, [side * 1.8, -0.84, 0.77], [0.23, 0.23, 0.23]),
    );
    const leg = new THREE.Mesh(limb, black);
    const foot = new THREE.Vector3(side * 0.72, -2.8, 0.45);
    span(leg, new THREE.Vector3(side * 0.55, -2.0, 0.15), foot, 0.1);
    group.add(leg, mesh(ball, black, [foot.x, foot.y, foot.z], [0.2, 0.14, 0.28]));
  }

  // Wings, each hinged at the back.
  const wingGeo = res.geo(new THREE.CircleGeometry(1, 32));
  const wingMat = res.mat('#dff4ff', {
    transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
    roughness: 0.15, emissive: '#3a5560',
  });
  const wings: Array<{ pivot: THREE.Group; side: number; tilt: number }> = [];
  for (const side of [-1, 1]) {
    for (const [y, length, width, tilt] of [[0.55, 1.7, 0.75, 0.45], [-0.15, 1.15, 0.5, -0.25]]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.45, y, -1.05);
      pivot.add(mesh(wingGeo, wingMat, [side * length, 0, 0], [length, width, 1]));
      group.add(pivot);
      wings.push({ pivot, side, tilt });
    }
  }

  const animate = (elapsed: number, chew: number) => {
    const flap = Math.sin(elapsed * 34) * 0.55;
    for (const wing of wings) {
      wing.pivot.rotation.set(0, wing.side * flap, wing.side * wing.tilt);
    }
    mouth.scale.y = 0.07 + chew * 0.32;
  };
  animate(0, 0);

  return { group, animate };
}
