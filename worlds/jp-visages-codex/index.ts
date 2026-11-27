import * as THREE from 'three/webgpu';
import {
  bumpMap, color, float, mix, mx_noise_float, mx_noise_vec3, mx_worley_noise_vec2,
  positionWorld, sin, smoothstep, time, vec3,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import headUrl from './assets/head.glb?url';
import distantHeadUrl from './assets/head-distant.glb?url';
import { collideHeads, HEAD_STATIONS, ROW_X, WALK_BOUNDS } from './layout';

/** Weathered limestone, with branching joints, fine pores and vertical mineral runs. */
function stoneMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.98, metalness: 0 });
  const p = positionWorld;
  const mottling = mx_noise_float(p.mul(0.36)).mul(0.5).add(0.5);
  const grit = mx_noise_float(p.mul(16)).mul(0.5).add(0.5);
  const warped = p.mul(0.25).add(mx_noise_vec3(p.mul(2.7)).mul(0.045));
  const cells = mx_worley_noise_vec2(warped);
  const joints = float(1).sub(smoothstep(0.009, 0.031, cells.y.sub(cells.x)))
    .mul(smoothstep(0.18, 0.45, mottling));
  const runs = mx_noise_float(vec3(p.x.mul(1.8), p.y.mul(0.045), p.z.mul(1.8))).mul(0.5).add(0.5);
  const patina = smoothstep(0.54, 0.83, runs).mul(0.36);
  const foot = float(1).sub(smoothstep(0.2, 6, p.y));
  material.colorNode = mix(color('#657675'), color('#bcc9c3'), mottling)
    .mul(float(1).sub(joints.mul(0.7)).sub(patina).sub(foot.mul(0.4)))
    .mul(grit.mul(0.14).add(0.86));
  material.normalNode = bumpMap(grit.mul(0.045).add(mottling.mul(0.12)).sub(joints.mul(0.08)), float(1));
  return material;
}

function floorMaterial() {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld;
  const grain = mx_noise_float(p.mul(21)).mul(0.5).add(0.5);
  const rock = mx_noise_float(p.mul(1.6)).mul(0.5).add(0.5);
  const dirt = mx_noise_float(p.mul(0.09)).mul(0.5).add(0.5);
  material.colorNode = mix(color('#303939'), color('#77817b'), dirt.mul(0.55).add(rock.mul(0.3)))
    .mul(grain.mul(0.3).add(0.7));
  material.normalNode = bumpMap(grain.mul(0.06).add(rock.mul(0.1)), float(1));
  return material;
}

/** A small HDR reflection sky gives the black eyes and red pools real specular contrast. */
async function reflectionSky(breathe: () => Promise<void>) {
  const width = 256;
  const height = 128;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const v = y / height;
      const strip = (Math.exp(-Math.pow((v - 0.55) / 0.021, 2)) * 2.8 +
        Math.exp(-Math.pow((v - 0.72) / 0.075, 2)) * 4) *
        (Math.pow(Math.max(0, Math.cos(u * Math.PI * 6)), 18) + 0.035);
      const i = (y * width + x) * 4;
      data[i] = 0.012 + strip * 0.66;
      data[i + 1] = 0.017 + strip * 0.88;
      data[i + 2] = 0.022 + strip;
      data[i + 3] = 1;
    }
    if (y % 8 === 0) await breathe();
  }
  const map = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  map.mapping = THREE.EquirectangularReflectionMapping;
  map.needsUpdate = true;
  return map;
}

export default defineRoom('jp-visages-codex', {
  async mount(ctx) {
    const root = new THREE.Group();
    root.name = 'The Unending Witnesses — Codex';
    ctx.scene.add(root);
    ctx.scene.background = new THREE.Color('#020405');
    ctx.scene.fog = new THREE.Fog('#020405', 58, 250);
    ctx.setTerrainHeight(() => 0);
    ctx.setWalkBounds(WALK_BOUNDS);
    ctx.setCollider({ move: collideHeads });

    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    const instances: THREE.InstancedMesh[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T) => { geometries.add(g); return g; };
    const material = <T extends THREE.Material>(m: T) => { materials.add(m); return m; };
    ctx.onDispose(() => {
      root.removeFromParent();
      for (const mesh of instances) mesh.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    });

    const environment = await reflectionSky(ctx.breathe);
    textures.add(environment);
    const stone = material(stoneMaterial());
    const eye = material(new THREE.MeshPhysicalNodeMaterial({
      color: '#010203', roughness: 0.065, metalness: 0.12,
      clearcoat: 1, clearcoatRoughness: 0.04, envMap: environment, envMapIntensity: 1.9,
    }));
    const ground = new THREE.Mesh(geometry(new THREE.PlaneGeometry(180, 860)), material(floorMaterial()));
    ground.rotation.x = -Math.PI / 2;
    root.add(ground);

    const sky = new THREE.HemisphereLight('#a8d2df', '#171018', 0.85);
    const moon = new THREE.DirectionalLight('#b4dfe9', 2.8);
    moon.position.set(-12, 36, 18);
    const rim = new THREE.DirectionalLight('#7495b4', 1.1);
    rim.position.set(20, 20, -35);
    const redBounce = new THREE.DirectionalLight('#9c1828', 0.28);
    redBounce.position.set(0, 3, 20);
    root.add(sky, moon, rim, redBounce);
    await ctx.breathe();

    // Two LOD batches: original face detail around both gates, clustered meshes in
    // the deep procession. All geometry/material ownership belongs to this mount.
    for (const [url, near] of [[headUrl, true], [distantHeadUrl, false]] as const) {
      const model = await loadGLB(url);
      const stations = HEAD_STATIONS.filter(z => (Math.abs(z) <= 80) === near);
      const parts: THREE.Mesh[] = [];
      model.scene.traverse(object => {
        if (object instanceof THREE.Mesh) parts.push(object);
      });
      for (const part of parts) {
        geometry(part.geometry);
        const originals = Array.isArray(part.material) ? part.material : [part.material];
        const isEye = originals.some(m => m.name === 'Black eyes');
        for (const m of originals) m.dispose();
        const mesh = new THREE.InstancedMesh(part.geometry, isEye ? eye : stone, stations.length * 2);
        mesh.name = `${near ? 'Near' : 'Distant'} ${isEye ? 'eyes' : 'heads'}`;
        const transform = new THREE.Object3D();
        let i = 0;
        for (const z of stations) {
          for (const side of [-1, 1]) {
            transform.position.set(side * ROW_X, -0.16, z);
            // The normalized face points +Z; rotate to look inward, with no tilt.
            transform.rotation.set(0, -side * Math.PI / 2, 0);
            transform.updateMatrix();
            mesh.setMatrixAt(i++, transform.matrix);
          }
          await ctx.breathe();
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        root.add(mesh);
        instances.push(mesh);
      }
      await ctx.breathe();
    }

    // Broken chips and larger angular fragments gather at the feet. The centre
    // two metres stay free of raised stones, including through the route gates.
    const random = seededRandom(0x71face);
    const rubbleGeo = geometry(new THREE.IcosahedronGeometry(1, 0));
    const rubbleMat = material(new THREE.MeshStandardNodeMaterial({ color: '#68736e', roughness: 1, flatShading: true }));
    const rubble = new THREE.InstancedMesh(rubbleGeo, rubbleMat, 2200);
    const transform = new THREE.Object3D();
    const shade = new THREE.Color();
    for (let i = 0; i < rubble.count; i++) {
      const side = random() < 0.5 ? -1 : 1;
      const x = side * (2 + Math.pow(random(), 0.7) * 22);
      const z = (random() - 0.5) * 660;
      const s = 0.09 + Math.pow(random(), 3) * (Math.abs(x) > 7 ? 1.7 : 0.4);
      transform.position.set(x, s * 0.22, z);
      transform.rotation.set(random() * 2, random() * Math.PI, random() * 2);
      transform.scale.set(s * (0.7 + random()), s * 0.6, s * (0.7 + random()));
      transform.updateMatrix();
      rubble.setMatrixAt(i, transform.matrix);
      shade.setScalar(0.42 + random() * 0.65);
      rubble.setColorAt(i, shade);
      if (i % 64 === 0) await ctx.breathe();
    }
    rubble.instanceMatrix.needsUpdate = true;
    rubble.computeBoundingSphere();
    instances.push(rubble);
    root.add(rubble);

    const liquid = material(new THREE.MeshPhysicalNodeMaterial({
      color: '#8f0714', roughness: 0.075, metalness: 0.18,
      clearcoat: 1, clearcoatRoughness: 0.06, envMap: environment, envMapIntensity: 0.55,
    }));
    const p = positionWorld;
    const ripple = sin(p.x.mul(5).add(p.z.mul(2)).add(time.mul(0.85)))
      .mul(0.025).add(sin(p.z.mul(8).sub(time.mul(0.65))).mul(0.012));
    liquid.normalNode = bumpMap(ripple, float(1));
    liquid.clearcoatNormalNode = liquid.normalNode;
    liquid.colorNode = mix(color('#41030a'), color('#b0091a'),
      mx_noise_float(p.mul(0.75)).mul(0.5).add(0.5));
    liquid.emissiveNode = color('#68000a').mul(0.1);

    for (let i = 0; i < 76; i++) {
      const shape = new THREE.Shape();
      const rx = 0.6 + random() * 1.65;
      const rz = 1.1 + random() * 4;
      const phase = random() * 6.28;
      for (let j = 0; j <= 56; j++) {
        const angle = j / 56 * Math.PI * 2;
        const radius = 1 + Math.sin(angle * 3 + phase) * 0.15 + Math.cos(angle * 7 - phase) * 0.075;
        const x = Math.cos(angle) * radius * rx;
        const y = Math.sin(angle) * radius * rz;
        if (j === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      const pool = new THREE.Mesh(geometry(new THREE.ShapeGeometry(shape)), liquid);
      pool.rotation.x = -Math.PI / 2;
      pool.position.set((i % 2 ? -1 : 1) * (3.7 + random() * 3.2), 0.026 + (i % 3) * 0.002,
        -300 + i / 75 * 600 + (random() - 0.5) * 4);
      pool.name = 'Crimson liquid';
      root.add(pool);
      await ctx.breathe();
    }
  },
});
