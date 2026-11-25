import * as THREE from 'three/webgpu';
import type { PortalDefinition, PortalVisualHandle } from '../types';
import { PORTAL_CENTER_Y, PORTAL_RADIUS } from '../portal/roomLayout';
import { createEnergyRingMaterial, createPortalVortexMaterial } from '../shaders/portalShaders';

export interface ArchwayPortalOptions {
  passage?: boolean;
  /** Engine-owned entrance/exit gate. Route gates are always one-way. */
  routeGate?: boolean;
}

/** Whether a portal only accepts travellers through its front (+Z) face. */
export function isOneWay(handle: Pick<PortalVisualHandle, 'aperture'>): boolean {
  return handle.aperture.userData.oneWay === true;
}

/**
 * Circular glowing starlight ring portal used for route gates, manifest links,
 * and dynamically spawned portals. Generously sized so both the character and
 * 3rd-person chase camera glide seamlessly through the circular aperture.
 */
export function createArchwayPortal(
  portal: PortalDefinition,
  options: ArchwayPortalOptions = {},
): PortalVisualHandle {
  const group = new THREE.Group();
  group.position.set(portal.position[0], portal.position[1], portal.position[2]);
  group.rotation.y = portal.yaw ?? 0;

  const colorA = portal.colorA ?? '#22d3ee';
  const colorB = portal.colorB ?? '#a855f7';
  const radius = PORTAL_RADIUS;
  const centerY = PORTAL_CENTER_Y;

  // Sculpted circular outer portal frame
  const outerRingGeo = new THREE.TorusGeometry(radius, 0.17, 20, 72);
  const { material: ringMat, hover: ringHover } = createEnergyRingMaterial(colorA, colorB);
  const outerRing = new THREE.Mesh(outerRingGeo, ringMat);
  outerRing.position.y = centerY;
  group.add(outerRing);

  // Secondary rotating luminous outer halo
  const haloGeo = new THREE.TorusGeometry(radius + 0.30, 0.048, 12, 72);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorA),
    transparent: true,
    opacity: 0.72,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.y = centerY;
  group.add(halo);

  // Grounded obsidian side anchors + flush threshold sill (leaves Y=0 center path unobstructed)
  const sillGeo = new THREE.BoxGeometry(radius * 2.08, 0.05, 0.42);
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.32,
    metalness: 0.72,
  });
  const sill = new THREE.Mesh(sillGeo, baseMat);
  sill.position.y = 0.025;
  group.add(sill);

  const plinthGeo = new THREE.CylinderGeometry(0.28, 0.42, 0.72, 16);
  for (const side of [-1, 1]) {
    const plinth = new THREE.Mesh(plinthGeo, baseMat);
    plinth.position.set(side * (radius - 0.14), 0.36, 0);
    group.add(plinth);
  }

  // Circular WebGPU TSL portal aperture (live destination window replaces this material)
  const vortexGeo = new THREE.CircleGeometry(radius - 0.08, 64);
  const { material: vortexMat, uniforms: vortexUniforms } = createPortalVortexMaterial(colorA, colorB);
  const oneWay = options.routeGate === true || portal.oneWay === true;
  // A one-way opening is see-through from behind, so walking past its back shows the room.
  if (oneWay) vortexMat.side = THREE.FrontSide;
  const vortex = new THREE.Mesh(vortexGeo, vortexMat);
  vortex.position.y = centerY;
  vortex.userData.portalId = portal.id;
  vortex.userData.oneWay = oneWay;
  if (options.routeGate) vortex.userData.routeGate = true;
  group.add(vortex);

  // Soft local point light
  const light = new THREE.PointLight(new THREE.Color(colorA), 3.4, 15, 1.5);
  light.position.set(0, centerY, 1.0);
  group.add(light);

  // Generous clickable target aligned with the circular opening
  const hitGeo = new THREE.CircleGeometry(radius + 0.15, 32);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide });
  const hitMesh = new THREE.Mesh(hitGeo, hitMat);
  hitMesh.position.y = centerY;
  group.add(hitMesh);

  let targetHover = 0;
  let currentHover = 0;

  return {
    portal,
    group,
    passage: options.passage ?? true,
    aperture: vortex,
    hitTargets: [hitMesh, vortex, outerRing],
    triggerCenter: new THREE.Vector3(portal.position[0], portal.position[1] + centerY, portal.position[2]),
    triggerRadius: portal.triggerRadius ?? radius,
    setHovered: (h) => {
      targetHover = h ? 1 : 0;
    },
    setProximity: (p) => {
      vortexUniforms.proximity.value = p;
    },
    update: (dt, elapsed) => {
      currentHover += (targetHover - currentHover) * Math.min(1, dt * 8);
      vortexUniforms.hover.value = currentHover;
      ringHover.value = currentHover;
      halo.rotation.z = elapsed * 0.55;
      halo.rotation.y = Math.sin(elapsed * 0.9) * 0.14;
      halo.scale.setScalar(1 + currentHover * 0.06);
      light.intensity = 3.2 + currentHover * 2.5 + Math.sin(elapsed * 3.1) * 0.4;
    },
    dispose: () => {
      outerRingGeo.dispose();
      ringMat.dispose();
      haloGeo.dispose();
      haloMat.dispose();
      sillGeo.dispose();
      plinthGeo.dispose();
      baseMat.dispose();
      vortexGeo.dispose();
      vortexMat.dispose();
      hitGeo.dispose();
      hitMat.dispose();
    },
  };
}
