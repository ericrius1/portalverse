import * as THREE from 'three/webgpu';
import type { WorldModule } from '@portalverse/core/types';
import {
  createEnergyRingMaterial,
  createStudioGridFloorMaterial,
} from '@portalverse/core/shaders/portalShaders';
import { createFloatingLabel, createWallBanner } from '@portalverse/core/engine/signage';

/**
 * JP'S PLACEHOLDER ROOM (`jpwhitaker`)
 * Warm sunlit amber-and-brass architectural studio clearly marked as JP's personal
 * build space, with portals back to the Portal Hub + directly to Eric's Room.
 * Edit this file freely to build your world without conflicting with Eric!
 */
const jpWorld: WorldModule = {
  manifest: {
    id: 'jp-world',
    name: "JP's Room",
    owner: 'jpwhitaker',
    author: 'JP (jpwhitaker)',
    description: "JP's placeholder studio room — warm amber solar workshop ready to build in worlds/jp-world.",
    accentColor: '#f59e0b',
    kind: 'local',
    allowFlight: true,
    spawns: {
      default: { position: [0, 0, 11], yaw: 0 },
      'from-eric': { position: [-8, 0, 2], yaw: -1.35 },
    },
  },
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#1a1006');
    ctx.scene.fog = new THREE.FogExp2('#1a1006', 0.0115);

    const hemi = new THREE.HemisphereLight('#fde68a', '#451a03', 1.3);
    const key = new THREE.DirectionalLight('#ffedd5', 1.8);
    key.position.set(-16, 28, 18);
    root.add(hemi, key);

    // Warm obsidian-amber architectural floor
    const floorGeo = new THREE.BoxGeometry(36, 0.8, 36);
    const floorMat = createStudioGridFloorMaterial('#1c1208', '#f59e0b', 2.0);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.4;
    root.add(floor);
    ctx.addPlatform({ minX: -18, maxX: 18, minZ: -18, maxZ: 18, topY: 0 });

    // Warm sandstone & brass corner studio columns
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 10.5, 16);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: '#422813',
      roughness: 0.45,
      metalness: 0.4,
    });
    const capGeo = new THREE.CylinderGeometry(0.85, 0.65, 0.45, 16);
    const capMat = new THREE.MeshStandardMaterial({
      color: '#f59e0b',
      emissive: '#d97706',
      emissiveIntensity: 0.55,
      roughness: 0.25,
      metalness: 0.85,
    });

    const corners: Array<[number, number]> = [
      [-15, -15],
      [15, -15],
      [-15, 15],
      [15, 15],
    ];
    for (const [cx, cz] of corners) {
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(cx, 5.25, cz);
      root.add(pillar);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(cx, 10.5, cz);
      root.add(cap);
    }

    // Back studio monument wall
    const wallGeo = new THREE.BoxGeometry(20, 8.8, 0.5);
    const wallMat = new THREE.MeshStandardMaterial({
      color: '#2b190b',
      roughness: 0.5,
      metalness: 0.35,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 4.4, -15.5);
    root.add(backWall);

    // Unmistakable giant room marquee: "JP'S ROOM · jpwhitaker"
    const heroBanner = createWallBanner({
      title: "JP'S ROOM",
      subtitle: 'jpwhitaker · Placeholder World — worlds/jp-world/index.ts',
      accentColor: '#f59e0b',
      bgColor: 'rgba(30, 16, 4, 0.92)',
      width: 15.5,
    });
    heroBanner.mesh.position.set(0, 5.4, -15.1);
    root.add(heroBanner.mesh);

    // Central sunlit drafting pedestal with rotating golden astrolabe sculpture
    const pedestalGeo = new THREE.CylinderGeometry(2.3, 2.7, 0.85, 32);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: '#3b210e',
      roughness: 0.35,
      metalness: 0.6,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.set(0, 0.425, 0);
    root.add(pedestal);

    const sunOrbGeo = new THREE.SphereGeometry(0.88, 24, 24);
    const sunOrbMat = new THREE.MeshStandardMaterial({
      color: '#fef08a',
      emissive: '#f59e0b',
      emissiveIntensity: 1.15,
      roughness: 0.2,
    });
    const sunOrb = new THREE.Mesh(sunOrbGeo, sunOrbMat);
    sunOrb.position.set(0, 2.9, 0);
    root.add(sunOrb);

    const astrolabeOuterGeo = new THREE.TorusGeometry(2.15, 0.07, 12, 48);
    const astrolabeInnerGeo = new THREE.TorusGeometry(1.55, 0.055, 12, 48);
    const { material: astroMat } = createEnergyRingMaterial('#f59e0b', '#fb7185');
    const outerRing = new THREE.Mesh(astrolabeOuterGeo, astroMat);
    outerRing.position.set(0, 2.9, 0);
    const innerRing = new THREE.Mesh(astrolabeInnerGeo, astroMat);
    innerRing.position.set(0, 2.9, 0);
    root.add(outerRing, innerRing);

    const workbenchNote = createFloatingLabel({
      title: "JP's Build Canvas",
      subtitle: 'Placeholder Room · Use Share Link to invite Eric here',
      accentColor: '#fbbf24',
      bgColor: 'rgba(30, 16, 4, 0.88)',
      width: 4.8,
    });
    workbenchNote.sprite.position.set(0, 5.25, 0);
    root.add(workbenchNote.sprite);

    // Portals out of JP's Room
    ctx.addPortal({
      id: 'jp-to-hub',
      label: 'Portal Hub',
      subtitle: 'Back to Shared Metaverse Hub',
      position: [9.5, 0, -7.5],
      yaw: -0.55,
      targetWorldId: 'hub',
      targetSpawnId: 'default',
      colorA: '#38bdf8',
      colorB: '#818cf8',
    });

    ctx.addPortal({
      id: 'jp-to-eric',
      label: "Eric's Room",
      subtitle: 'Direct link to ericrius1',
      position: [-9.5, 0, -7.5],
      yaw: 0.55,
      targetWorldId: 'eric-world',
      targetSpawnId: 'from-jp',
      colorA: '#22d3ee',
      colorB: '#3b82f6',
    });

    ctx.onUpdate((_, elapsed) => {
      sunOrb.position.y = 2.9 + Math.sin(elapsed * 1.9) * 0.18;
      outerRing.rotation.x = elapsed * 0.45;
      outerRing.rotation.y = elapsed * 0.32;
      innerRing.rotation.y = -elapsed * 0.65;
      innerRing.rotation.z = elapsed * 0.4;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      floorGeo.dispose();
      floorMat.dispose();
      pillarGeo.dispose();
      pillarMat.dispose();
      capGeo.dispose();
      capMat.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      pedestalGeo.dispose();
      pedestalMat.dispose();
      sunOrbGeo.dispose();
      sunOrbMat.dispose();
      astrolabeOuterGeo.dispose();
      astrolabeInnerGeo.dispose();
      astroMat.dispose();
      heroBanner.dispose();
      workbenchNote.dispose();
    });
  },
};

export default jpWorld;
