import * as THREE from 'three/webgpu';

/**
 * Shared high-detail sculpted 3D geometry builders (cached per mount via ResourceBag)
 * producing smooth-shaded, anatomically proportioned humans/bio-hybrids, Akira-inspired
 * curved cyber-scooters, and beveled rounded-roof Electro-Punk Trolley hulls — all built
 * with LatheGeometry, beveled ExtrudeGeometry, and TubeGeometry for life-like silhouettes
 * and clean triangulated polygon-wireframe dissolve shells!
 */

/** Anatomically tapered human cranium + jawline + chin via LatheGeometry. */
export function createSculptedHeadGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.145), // chin bottom
    new THREE.Vector2(0.058, -0.132), // jawline
    new THREE.Vector2(0.105, -0.088), // lower cheeks
    new THREE.Vector2(0.125, -0.025), // cheekbones
    new THREE.Vector2(0.132, 0.045),  // temples
    new THREE.Vector2(0.122, 0.108),  // forehead
    new THREE.Vector2(0.082, 0.148),  // upper crown
    new THREE.Vector2(0.001, 0.162),  // top of head
  ];
  const geo = new THREE.LatheGeometry(pts, 18);
  geo.scale(0.92, 1.0, 1.06); // natural oval skull depth
  geo.computeVertexNormals();
  return geo;
}

/** Tailored anatomical torso + high-collared cyber-jacket silhouette via LatheGeometry. */
export function createSculptedTorsoGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.28),
    new THREE.Vector2(0.185, -0.27), // flared jacket hem
    new THREE.Vector2(0.155, -0.13), // tapered waist
    new THREE.Vector2(0.18, 0.04),   // ribcage
    new THREE.Vector2(0.225, 0.21),  // broad tailored shoulders
    new THREE.Vector2(0.14, 0.28),   // collar base
    new THREE.Vector2(0.075, 0.3),   // neck opening
    new THREE.Vector2(0.001, 0.3),
  ];
  const geo = new THREE.LatheGeometry(pts, 16);
  geo.scale(1.12, 1.0, 0.68);
  geo.computeVertexNormals();
  return geo;
}

/** High samurai-tech popped storm collar wrapping smoothly around the neck. */
export function createStormCollarGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.135, 0.0),
    new THREE.Vector2(0.155, 0.06),
    new THREE.Vector2(0.165, 0.125),
    new THREE.Vector2(0.145, 0.135),
  ];
  const geo = new THREE.LatheGeometry(pts, 16, Math.PI * 0.28, Math.PI * 1.44);
  geo.computeVertexNormals();
  return geo;
}

/** Sculpted anatomical leg (thigh -> knee contour -> tapered calf -> ankle). */
export function createSculptedLegGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.76),
    new THREE.Vector2(0.052, -0.74), // ankle
    new THREE.Vector2(0.068, -0.52), // calf muscle
    new THREE.Vector2(0.062, -0.37), // knee
    new THREE.Vector2(0.088, -0.14), // upper thigh
    new THREE.Vector2(0.095, 0.0),   // hip
    new THREE.Vector2(0.001, 0.01),
  ];
  const geo = new THREE.LatheGeometry(pts, 12);
  geo.computeVertexNormals();
  return geo;
}

/** Sculpted anatomical arm (shoulder deltoid -> bicep -> elbow -> tapered forearm -> wrist). */
export function createSculptedArmGeo(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.001, -0.58),
    new THREE.Vector2(0.042, -0.56), // gloved wrist
    new THREE.Vector2(0.054, -0.36), // forearm
    new THREE.Vector2(0.052, -0.26), // elbow
    new THREE.Vector2(0.068, -0.1),  // bicep
    new THREE.Vector2(0.078, 0.0),   // shoulder cap
    new THREE.Vector2(0.001, 0.02),
  ];
  const geo = new THREE.LatheGeometry(pts, 10);
  geo.computeVertexNormals();
  return geo;
}

/** Curved wrap-around cyberpunk LED visor glasses. */
export function createCurvedVisorGeo(): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(0.138, 0.136, 0.062, 16, 1, true, -Math.PI * 0.38, Math.PI * 0.76);
  geo.computeVertexNormals();
  return geo;
}

/** Sinuous organic S-curved animal tail (for kitsune, neko, okami bio-hybrids). */
export function createOrganicTailGeo(length: number, baseRadius: number, curl: number): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, -0.06, -length * 0.32),
    new THREE.Vector3(curl * 0.1, 0.05, -length * 0.68),
    new THREE.Vector3(-curl * 0.08, 0.22, -length),
  ]);
  const geo = new THREE.TubeGeometry(curve, 14, baseRadius, 8, false);
  // Taper thickness along Z from lush mid-tail to soft pointed tip
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const center = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = Math.max(0, Math.min(1, -v.z / Math.max(0.01, length)));
    curve.getPoint(t, center);
    const scale = Math.sin(t * Math.PI * 0.85) * 0.95 + 0.28 * (1 - t);
    v.sub(center).multiplyScalar(scale).add(center);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Curved Akira / Neo-Tokyo Cyber-Scooter monocoque body shell via beveled ExtrudeGeometry. */
export function createScooterFairingGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Side profile in XY (X = forward +Z after rotation, Y = height)
  shape.moveTo(-0.88, 0.34); // rear tail
  shape.lineTo(-0.56, 0.68); // raised pillion tail
  shape.lineTo(-0.08, 0.62); // contoured rider saddle
  shape.lineTo(0.28, 0.38);  // foot floorboard dip
  shape.lineTo(0.62, 0.86);  // swept aero windscreen nose
  shape.lineTo(0.92, 0.52);  // pointed headlight beak
  shape.lineTo(0.76, 0.28);  // lower chin spoiler
  shape.lineTo(-0.74, 0.24); // under-chassis belly
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: true,
    bevelThickness: 0.08,
    bevelSize: 0.06,
    bevelSegments: 3,
  });
  geo.translate(0, 0, -0.21);
  // Rotate so forward nose points along +X (matching perpendicular East-West lanes cleanly)
  geo.computeVertexNormals();
  return geo;
}

/**
 * Beveled, smooth-roofed Electro-Punk Trolley body shell (oriented along X for East-West rails!).
 * Features chamfered curved corners, sloped panoramic front & rear windshields, and recessed body profile.
 */
export function createTrolleyHullGeo(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  // Cross-section in YZ (width 2.3m, height 2.55m with rounded chamfered roof!)
  const hw = 1.16;
  shape.moveTo(-hw + 0.14, 0.38);
  shape.lineTo(hw - 0.14, 0.38);
  shape.lineTo(hw, 0.56);
  shape.lineTo(hw, 2.38);
  shape.quadraticCurveTo(hw, 2.74, hw - 0.38, 2.78);
  shape.lineTo(-hw + 0.38, 2.78);
  shape.quadraticCurveTo(-hw, 2.74, -hw, 2.38);
  shape.lineTo(-hw, 0.56);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 8.6,
    bevelEnabled: true,
    bevelThickness: 0.22,
    bevelSize: 0.12,
    bevelSegments: 3,
  });
  // Center along Z, then rotate so length runs cleanly along X (East–West rails!)
  geo.translate(0, 0, -4.3);
  geo.rotateY(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
