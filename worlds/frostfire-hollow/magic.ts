import * as THREE from 'three/webgpu';
import { abs, color, float, mix, normalView, positionLocal, positionWorld, sin, smoothstep, time, uniform, uv } from 'three/tsl';
import { CAVE_RX, CAVE_RZ, CEILING_Y, ISLANDS, LAKE_Y, PATH_HALF_WIDTH, groundAt, pathAt } from './logic';
import type { ClimateUniforms, Resources } from './materials';

const c = (hex: string) => color(new THREE.Color(hex));

/** Each cluster's light colour: a magenta-violet glow by lava, aqua-cyan by ice. */
const CRYSTAL_FIRE = '#d24bff';
const CRYSTAL_ICE = '#4ff4ff';

/**
 * What makes the cave feel enchanted: clusters of glowing crystals (violet by lava light,
 * aqua by ice) that light their corner of the cave, soft shafts of light falling from cracks in
 * the ceiling, and slow wisps of light drifting through the air.
 */
export function createMagic(res: Resources, u: ClimateUniforms, rand: () => number) {
  const group = new THREE.Group();
  group.name = 'magic';

  // ---- Crystal clusters on the walls' feet and the islands.
  const crystalMat = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }));
  const along = smoothstep(float(0), float(1), positionLocal.y);
  const shimmer = sin(time.mul(1.3).add(positionWorld.x.mul(0.7)).add(positionWorld.z.mul(0.5))).mul(0.25).add(0.75);
  const hue = mix(c(CRYSTAL_FIRE), c(CRYSTAL_ICE), u.ice);
  const edge = float(1).sub(abs(normalView.z)).pow(2);
  crystalMat.colorNode = mix(hue.mul(0.5), c('#ffffff'), along.mul(0.35));
  crystalMat.emissiveNode = hue.mul(along.mul(1.6).add(0.4).add(edge.mul(1.2))).mul(shimmer);

  const spots: Array<{ x: number; z: number; y: number }> = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand() * 0.2;
    const x = Math.cos(a) * (CAVE_RX - 4.5);
    const z = Math.sin(a) * (CAVE_RZ - 6);
    if (Math.abs(x) < 6) continue; // keep the portals' ends clear
    spots.push({ x, z, y: groundAt(x, z).y - 0.2 });
  }
  for (const island of ISLANDS) spots.push({ x: island.x, z: island.z, y: groundAt(island.x, island.z).y - 0.1 });

  const crystalGeo = res.geo(new THREE.CylinderGeometry(0.12, 0.28, 1, 6, 1).translate(0, 0.5, 0));
  const shards: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const s of spots) {
    const count = 4 + Math.floor(rand() * 5);
    for (let k = 0; k < count; k++) {
      const h = 0.6 + rand() * 2.2;
      e.set((rand() - 0.5) * 0.9, rand() * 6, (rand() - 0.5) * 0.9);
      m.compose(
        new THREE.Vector3(s.x + (rand() - 0.5) * 1.2, s.y, s.z + (rand() - 0.5) * 1.2),
        q.setFromEuler(e),
        new THREE.Vector3(0.6 + rand() * 0.8, h, 0.6 + rand() * 0.8),
      );
      shards.push(m.clone());
    }
  }
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, shards.length);
  shards.forEach((mat, i) => crystals.setMatrixAt(i, mat));
  crystals.name = 'crystals';

  // A few of the clusters cast real light.
  const fireLight = new THREE.Color(CRYSTAL_FIRE);
  const iceLight = new THREE.Color(CRYSTAL_ICE);
  const lights = spots.filter((_, i) => i % 4 === 0).slice(0, 6).map(s => {
    const light = new THREE.PointLight(CRYSTAL_FIRE, 30, 22, 1.5);
    light.position.set(s.x * 0.92, s.y + 1.8, s.z * 0.92);
    group.add(light);
    return light;
  });

  // ---- Light shafts falling from cracks in the ceiling.
  const shaftMat = res.own(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  const shaftGlow = uniform(1);
  const v = uv().y; // 0 at the floor, 1 at the ceiling
  const facing = abs(normalView.z).pow(1.5);
  const drift = sin(time.mul(0.6).add(positionWorld.y.mul(0.4)).add(positionWorld.x)).mul(0.2).add(0.8);
  shaftMat.colorNode = mix(c('#ffcf8a'), c('#bfe6ff'), u.ice)
    .mul(smoothstep(float(0), float(0.35), v).mul(smoothstep(float(1), float(0.7), v)))
    .mul(facing).mul(drift).mul(shaftGlow).mul(0.16);
  const shaftSpots = [[-9, 26], [8, 10], [-6, -6], [10, -20], [-12, -32], [0, 0]];
  const shaftGeo = res.geo(new THREE.CylinderGeometry(1.1, 3.2, CEILING_Y - LAKE_Y, 20, 1, true).translate(0, (CEILING_Y - LAKE_Y) / 2 + LAKE_Y, 0));
  const shafts = shaftSpots.map(([x, z], i) => {
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.set(x, 0, z);
    shaft.rotation.set((rand() - 0.5) * 0.18, 0, (rand() - 0.5) * 0.18);
    shaft.scale.setScalar(i === 5 ? 1.4 : 0.8 + rand() * 0.5);
    shaft.name = 'light-shaft';
    group.add(shaft);
    return shaft;
  });

  // ---- Wisps: soft orbs of light drifting slowly through the cave.
  const wispMat = res.own(new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const r = uv().sub(0.5).length();
  const glow = smoothstep(float(0.5), float(0.0), r).pow(2.2);
  wispMat.colorNode = mix(c('#ffd27a'), c('#9ff0ff'), u.ice).mul(glow).mul(1.4);
  const wisps = Array.from({ length: 36 }, () => {
    let x = 0;
    let z = 0;
    // Float over the lakes and banks, not in people's faces on the path.
    for (let tries = 0; tries < 20; tries++) {
      x = (rand() * 2 - 1) * (CAVE_RX - 6);
      z = (rand() * 2 - 1) * (CAVE_RZ - 8);
      if (pathAt(x, z).distance > PATH_HALF_WIDTH + 2) break;
    }
    const sprite = new THREE.Sprite(wispMat);
    sprite.scale.setScalar(0.5 + rand() * 0.6);
    group.add(sprite);
    return { sprite, x, z, y: 1.5 + rand() * 7, phase: rand() * 10, speed: 0.15 + rand() * 0.25 };
  });

  group.add(crystals);
  return {
    group,
    update(elapsed: number) {
      const ice = u.ice.value as number;
      lights.forEach((light, i) => {
        light.color.copy(fireLight).lerp(iceLight, ice);
        light.intensity = 26 + 8 * Math.sin(elapsed * 0.9 + i * 1.7);
      });
      shaftGlow.value = 0.8 + 0.4 * ice;
      for (const w of wisps) {
        const t = elapsed * w.speed + w.phase;
        w.sprite.position.set(w.x + Math.sin(t) * 2.5, w.y + Math.sin(t * 1.7) * 0.8, w.z + Math.cos(t * 0.8) * 2.5);
      }
      void shafts;
    },
  };
}
