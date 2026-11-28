import * as THREE from 'three/webgpu';
import { clamp, color, dot, float, max, mix, normalView, positionViewDirection, pow, reflectVector, vec3 } from 'three/tsl';

/** Winner A: Claude's black moon-mirror treatment, shared with the preserved blind study. */
export function createWinningEyes(moon: THREE.Vector3): THREE.MeshStandardNodeMaterial {
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
