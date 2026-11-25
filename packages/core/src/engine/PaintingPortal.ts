import * as THREE from 'three/webgpu';
import type { PortalDefinition, PortalVisualHandle } from '../types';
import { GATE_HEIGHT, GATE_WIDTH } from '../portal/roomLayout';
import { createFloatingLabel } from './signage';

/** A flush threshold with a gilt picture frame. Local +Z faces the gallery. */
export function createPaintingPortal(portal: PortalDefinition): PortalVisualHandle {
  const group = new THREE.Group();
  group.position.fromArray(portal.position);
  group.rotation.y = portal.yaw ?? 0;
  const opening = new THREE.PlaneGeometry(GATE_WIDTH, GATE_HEIGHT);
  const backing = new THREE.MeshBasicMaterial({ color: '#223442' });
  const aperture = new THREE.Mesh(opening, backing);
  aperture.userData.routeGate = true;
  aperture.position.y = GATE_HEIGHT / 2;
  group.add(aperture);

  const molding = new THREE.BoxGeometry(1, 1, 1);
  const walnut = new THREE.MeshStandardMaterial({ color: '#513324', roughness: 0.55 });
  const brass = new THREE.MeshStandardMaterial({ color: '#e2ba72', metalness: 0.46, roughness: 0.36 });
  for (const [rim, mat] of [[0.24, walnut], [0.065, brass]] as const) {
    const z = mat === brass ? 0.11 : 0;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(molding, mat);
      post.scale.set(rim, GATE_HEIGHT + rim * 2, 0.16);
      post.position.set(side * (GATE_WIDTH + rim) / 2, GATE_HEIGHT / 2, z);
      const rail = new THREE.Mesh(molding, mat);
      rail.scale.set(GATE_WIDTH + 2 * rim, rim, 0.16);
      rail.position.set(0, side > 0 ? GATE_HEIGHT + rim / 2 : -rim / 2, z);
      group.add(post, rail);
    }
  }
  const label = createFloatingLabel({ title: portal.label, subtitle: portal.subtitle,
    accentColor: portal.colorA, width: 4.2 });
  label.sprite.position.y = GATE_HEIGHT + 1;
  group.add(label.sprite);
  return { portal, group, aperture, passage: true, hitTargets: [aperture], triggerRadius: 2.5,
    triggerCenter: new THREE.Vector3().fromArray(portal.position).add(new THREE.Vector3(0, GATE_HEIGHT / 2, 0)),
    dispose() {
      opening.dispose(); backing.dispose(); molding.dispose(); walnut.dispose(); brass.dispose(); label.dispose();
    } };
}
