import * as THREE from 'three/webgpu';

/** Creates geometries and materials that are all disposed together. */
export function createResources() {
  const owned: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  const geo = <T extends THREE.BufferGeometry>(geometry: T): T => own(geometry);
  const mat = (
    color: THREE.ColorRepresentation,
    options: THREE.MeshStandardMaterialParameters = {},
  ): THREE.MeshStandardMaterial => {
    return own(new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...options }));
  };
  return { own, geo, mat, dispose: () => owned.forEach(resource => resource.dispose()) };
}

export type Resources = ReturnType<typeof createResources>;

export function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.scale.set(...scale);
  return result;
}

const up = new THREE.Vector3(0, 1, 0);

/** Stand a unit-height, Y-aligned object between two points. */
export function span(object: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, thickness = 1): void {
  const direction = to.clone().sub(from);
  const length = direction.length();
  object.position.copy(from).addScaledVector(direction, 0.5);
  object.quaternion.setFromUnitVectors(up, direction.normalize());
  object.scale.set(thickness, length, thickness);
}
