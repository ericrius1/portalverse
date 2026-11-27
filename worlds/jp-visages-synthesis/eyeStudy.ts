import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, color, dot, float, max, mix, normalView, normalWorld,
  positionViewDirection, positionWorld, pow, reflectVector, vec3,
} from 'three/tsl';
import type { HeadPlacement } from './layout';
import type { RoomCollider } from '@portalverse/core/types';

// Blind answer key. Fixed shuffled order: never display these style names in the scene.
export const EYE_STUDY_KEY = ['claude', 'codex', 'neon', 'synthesis'] as const;
export const EYE_STUDY_LABELS = ['A', 'B', 'C', 'D'] as const;

/** Same model, orientation, weathering seed and height; only eyes vary. */
export const EYE_STUDY_HEADS: HeadPlacement[] = [-12, -4, 4, 12].map((x, index) => ({
  x, y: 1.6, z: 12, yaw: 0, scale: 1.15, index, side: 1,
  seed: 0.417, weeping: 0.55, crackAngle: 1.2, crackDensity: 0.55,
  colliderX: x, colliderZ: 12, colliderRadius: 3.2,
}));

export function eyeStudyCollider(base: RoomCollider): RoomCollider {
  return { move(from, to, radius, height) {
    let [x, z] = base.move(from, to, radius, height);
    if (to[1] > 10) return [x, z];
    for (const h of EYE_STUDY_HEADS) {
      const dx = x - h.x;
      const dz = z - h.z;
      const limit = h.colliderRadius + radius;
      if (Math.abs(dx) < limit && Math.abs(dz) < limit) {
        if (limit - Math.abs(dx) < limit - Math.abs(dz)) x = h.x + (dx < 0 ? -limit : limit);
        else z = h.z + (dz < 0 ? -limit : limit);
      }
    }
    return [x, z];
  } };
}

/** Original Codex reflection panorama, without importing its room module. */
export async function studyReflectionMap(breathe: () => Promise<void>): Promise<THREE.DataTexture> {
  const width = 256, height = 128;
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
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

/** Keep each original treatment's strengths, aligning analytic glints to this room's moon. */
export function studyEyeMaterial(
  style: typeof EYE_STUDY_KEY[number],
  synthesis: THREE.MeshPhysicalNodeMaterial,
  environment: THREE.Texture,
  moon: THREE.Vector3,
  rim: THREE.Vector3,
): THREE.MeshStandardNodeMaterial {
  if (style === 'synthesis') return synthesis;
  if (style === 'codex') return new THREE.MeshPhysicalNodeMaterial({
    color: '#010203', roughness: 0.065, metalness: 0.12,
    clearcoat: 1, clearcoatRoughness: 0.04, envMap: environment, envMapIntensity: 1.9,
  });
  if (style === 'claude') {
    const material = new THREE.MeshStandardNodeMaterial({ color: '#020203', roughness: 0.05, metalness: 0 });
    const dir = reflectVector;
    const sky = mix(color('#1a2026'), color('#0a0c10'), pow(clamp(dir.y, 0, 1), 0.6));
    const toward = max(dot(dir, vec3(moon.x, moon.y, moon.z)), 0);
    const glint = pow(toward, 1200).mul(40).add(pow(toward, 90).mul(0.6)).add(pow(toward, 8).mul(0.05));
    const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
    const fresnel = float(0.06).add(float(0.94).mul(pow(float(1).sub(facing), 5)));
    material.emissiveNode = sky.add(color('#dce6ff').mul(glint)).mul(fresnel);
    return material;
  }
  const material = new THREE.MeshPhysicalNodeMaterial({
    color: '#030407', roughness: 0.035, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.02,
  });
  const view = cameraPosition.sub(positionWorld).normalize();
  const normal = normalWorld.normalize();
  const facing = clamp(dot(normal, view), 0, 1);
  const reflected = normal.mul(dot(normal, view).mul(2)).sub(view).normalize();
  const moonSpec = pow(max(dot(reflected, vec3(moon.x, moon.y, moon.z)), 0), 140).mul(1.65);
  const rimSpec = pow(max(dot(reflected, vec3(rim.x, rim.y, rim.z)), 0), 110).mul(0.95);
  const redSpec = pow(max(dot(reflected, vec3(0, -0.78, 0.62).normalize()), 0), 28).mul(0.32);
  const sheen = pow(float(1).sub(facing), 4.2).mul(0.24);
  material.emissiveNode = color('#dceef7').mul(moonSpec.add(rimSpec).add(sheen))
    .add(color('#b8141c').mul(redSpec));
  return material;
}
