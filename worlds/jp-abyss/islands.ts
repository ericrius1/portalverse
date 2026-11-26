import * as THREE from 'three/webgpu';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { buildStoneGeometry, buildWispGeometry, stoneUnderside } from './geometry';
import { looseStoneSurface, type Point, type Stone } from './path';
import { retriggerStep, type TuningUniforms } from './tuning';
import { applyPose, readPose, validPose, type Pose, type EncounterPlacement } from './placement';

export const shapes = ['Slab', 'Shard', 'Crag'] as const;
export const sizes = ['Small', 'Medium', 'Large'] as const;
const scales = [0.7, 1, 1.6];

export interface Island extends Pose {
  shape: typeof shapes[number];
  size: typeof sizes[number];
}

interface Layout { islands: Island[]; encounter?: EncounterPlacement }

export function readPath(value: unknown): Layout | undefined {
  if (!value || typeof value !== 'object' || !('version' in value) || (value.version !== 1 && value.version !== 2) ||
      !('islands' in value) || !Array.isArray(value.islands)) return;
  const islands: Island[] = [];
  for (const row of value.islands) {
    if (!row) return;
    const { shape, size } = row;
    if (!shapes.includes(shape) || !sizes.includes(size) || !validPose(row)) return;
    const { x, y, z, rotation } = row;
    islands.push({ shape, size, x, y, z, rotation });
  }
  const encounter = 'encounter' in value ? value.encounter : undefined;
  if (encounter === undefined) return { islands };
  if (!encounter || typeof encounter !== 'object' || !('chest' in encounter) || !validPose(encounter.chest) ||
      !('shadow' in encounter) || !validPose(encounter.shadow)) return;
  return { islands, encounter: { chest: encounter.chest, shadow: encounter.shadow } };
}

const outlines: Point[][] = [
  [[-1.7,-0.65],[-0.9,-1.35],[1.2,-1.2],[1.75,-0.35],[1.45,0.95],[0.4,1.35],[-1.35,1]],
  [[-1.05,-1.2],[0.2,-1.95],[1.1,-1],[0.85,0.75],[-0.2,2],[-1.15,0.7]],
  [[-1.45,-0.4],[-0.7,-1.55],[0.85,-1.3],[1.6,-0.15],[1.1,1.25],[-0.4,1.6],[-1.5,0.65]],
];
const stones: Stone[] = outlines.map((polygon, i) => ({
  polygon, cx: 0, cz: 0, site: [0, 0], topY: 0, slopeX: 0, slopeZ: 0,
  radius: Math.max(...polygon.map(([x, z]) => Math.hypot(x, z))),
  thickness: [0.4, 0.5, 0.75][i], depth: [1.3, 2.3, 3.6][i], chamfer: 0.08,
  amp: 0, speed: 1, phases: [i, 3*i, 2*i, i], glow: [0.48, 0.32, 0.18][i], seed: [0.44, 0.83, 0.11][i],
}));

let templates: Promise<THREE.BufferGeometry[]> | undefined;
export function islandTemplates() {
  return templates ??= Promise.all(stones.map(async (stone, i) =>
    (await buildStoneGeometry([stone], seededRandom(601 + i))).geometry));
}

// In creation order, the route leads from a faint thread of smoke to a full Abyss ribbon.
const islandSmoke = [
  { width: 0.34, lengthScale: 0.5, opacityScale: 0.3, seed: 0.89 },
  { width: 0.62, lengthScale: 0.75, opacityScale: 0.65, seed: 0.54 },
  { width: 0.9, lengthScale: 1, opacityScale: 1, seed: 0.27 },
];

export class IslandPath {
  readonly entries: { mesh: THREE.Mesh; smoke: THREE.Mesh; shape: Island['shape']; size: Island['size'] }[] = [];
  private grounded: THREE.Mesh | undefined;

  constructor(private root: THREE.Group, private material: THREE.Material, private templates: THREE.BufferGeometry[], private smokeMaterial: THREE.Material) {}

  add(island: Island) {
    const mesh = new THREE.Mesh(this.geometry(island.shape), this.material);
    mesh.name = 'Abyss island';
    applyPose(mesh, island);
    mesh.scale.setScalar(scales[sizes.indexOf(island.size)]);
    const stone = stones[shapes.indexOf(island.shape)];
    const profile = islandSmoke[this.entries.length % islandSmoke.length];
    const ribbon = buildWispGeometry([{ ...profile, stone, origin: new THREE.Vector3(), lengthFraction: profile.seed }]);
    const smoke = new THREE.Mesh(ribbon, this.smokeMaterial);
    smoke.name = 'Island smoke';
    smoke.frustumCulled = false;
    smoke.raycast = () => {};
    smoke.position.copy(stoneUnderside(stone));
    smoke.scale.set(stone.radius, 1, stone.radius);
    smoke.quaternion.copy(mesh.quaternion).invert();
    mesh.add(smoke);
    this.entries.push({ mesh, smoke, shape: island.shape, size: island.size });
    this.root.add(mesh);
    return this.entries.length - 1;
  }

  private geometry(shape: Island['shape']) {
    const geometry = this.templates[shapes.indexOf(shape)].clone();
    const times = new Float32Array(geometry.getAttribute('position').count).fill(-1e6);
    geometry.setAttribute('aStepTime', new THREE.BufferAttribute(times, 1));
    return geometry;
  }

  reshape(index: number, shape: Island['shape'], size: Island['size']) {
    const entry = this.entries[index];
    if (shape !== entry.shape) {
      entry.mesh.geometry.dispose();
      entry.mesh.geometry = this.geometry(shape);
      entry.shape = shape;
      const stone = stones[shapes.indexOf(shape)];
      entry.smoke.position.copy(stoneUnderside(stone));
      entry.smoke.scale.set(stone.radius, 1, stone.radius);
    }
    entry.size = size;
    entry.mesh.scale.setScalar(scales[sizes.indexOf(size)]);
  }

  remove(index: number) {
    const [{ mesh, smoke }] = this.entries.splice(index, 1);
    smoke.geometry.dispose();
    mesh.removeFromParent();
    mesh.geometry.dispose();
    if (this.grounded === mesh) this.grounded = undefined;
  }

  clear() {
    while (this.entries.length) this.remove(this.entries.length - 1);
  }

  snapshot(encounter?: EncounterPlacement) {
    return { version: 2, encounter, islands: this.entries.map(({ shape, size, mesh }) => ({
      shape, size, ...readPose(mesh),
    })) };
  }

  private readonly ray = new THREE.Ray();
  private readonly inverse = new THREE.Quaternion();
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly c = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();

  private rotatedTop(mesh: THREE.Mesh, stone: Stone, x: number, z: number, originY: number) {
    const p = mesh.position;
    const scale = mesh.scale.x;
    this.inverse.copy(mesh.quaternion).invert();
    this.ray.origin.set(x - p.x, originY - p.y, z - p.z).applyQuaternion(this.inverse).divideScalar(scale);
    this.ray.direction.set(0, -1, 0).applyQuaternion(this.inverse);
    // buildStoneGeometry emits the top fan and upper bevel before the sides and underside.
    const vertices = mesh.geometry.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < stone.polygon.length * 9; i += 3) {
      this.a.fromBufferAttribute(vertices, i);
      this.b.fromBufferAttribute(vertices, i + 1);
      this.c.fromBufferAttribute(vertices, i + 2);
      if (this.ray.intersectTriangle(this.a, this.b, this.c, true, this.hit)) {
        top = Math.max(top, originY - this.hit.distanceTo(this.ray.origin) * scale);
      }
    }
    return top;
  }

  private contact(x: number, z: number, fromY: number) {
    let height = -Infinity;
    let surface: THREE.Mesh | undefined;
    for (const { mesh, shape } of this.entries) {
      const p = mesh.position;
      const scale = mesh.scale.x;
      const stone = stones[shapes.indexOf(shape)];
      const reach = (stone.radius + stone.chamfer) * scale;
      if (Math.abs(x - p.x) > reach || Math.abs(z - p.z) > reach) continue;
      const top = mesh.quaternion.w === 1
        ? p.y + scale * looseStoneSurface(stone, (x - p.x) / scale, (z - p.z) / scale, 0)
        : this.rotatedTop(mesh, stone, x, z, Math.min(p.y + reach + 1, fromY + 0.35));
      if (top > height && top <= fromY + 0.35) {
        height = top;
        surface = mesh;
      }
    }
    return { height, surface };
  }

  // Placement follows the underside, while gravity keeps the ribbon hanging down after a gizmo rotation.
  updateSmoke() {
    for (const { mesh, smoke } of this.entries) smoke.quaternion.copy(mesh.quaternion).invert();
  }

  heightAt(x: number, z: number, fromY = Infinity) {
    return this.contact(x, z, fromY).height;
  }

  step(feet: THREE.Vector3 | undefined, time: number, tune: TuningUniforms, walked: boolean) {
    const hit = feet && this.contact(feet.x, feet.z, feet.y);
    const mesh = hit && feet && Math.abs(hit.height - feet.y) < 0.015 ? hit.surface : undefined;
    if (mesh && (mesh !== this.grounded || walked)) {
      const times = mesh.geometry.getAttribute('aStepTime') as THREE.BufferAttribute;
      times.array.fill(retriggerStep(time, times.array[0], tune.stepFadeIn.value, tune.stepSeconds.value, tune.stepFalloff.value));
      times.needsUpdate = true;
    }
    this.grounded = mesh;
    return !!mesh;
  }
}
