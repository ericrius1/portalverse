import * as THREE from 'three/webgpu';
import type { WorldModule } from '@portalverse/core/types';
import {
  createEnergyRingMaterial,
  createStudioGridFloorMaterial,
} from '@portalverse/core/shaders/portalShaders';
import { createFloatingLabel, createWallBanner } from '@portalverse/core/engine/signage';

/**
 * ERIC'S PLACEHOLDER ROOM (`ericrius1`)
 * Clear personal workspace with unmistakable signage, holographic drafting table,
 * and portals back to the Portal Hub + directly to JP's Room.
 * Edit this file freely to build your world without conflicting with JP!
 */
const ericWorld: WorldModule = {
  manifest: {
    id: 'eric-world',
    name: "Eric's Room",
    owner: 'ericrius1',
    author: 'Eric (ericrius1)',
    description: "Eric's placeholder studio room — cyan holographic workshop ready to build in worlds/eric-world.",
    accentColor: '#22d3ee',
    kind: 'local',
    allowFlight: true,
    spawns: {
      default: { position: [0, 0, 11], yaw: 0 },
      'from-jp': { position: [8, 0, 2], yaw: 1.35 },
    },
  },
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#04101d');
    ctx.scene.fog = new THREE.FogExp2('#04101d', 0.012);

    const hemi = new THREE.HemisphereLight('#67e8f9', '#082f49', 1.25);
    const key = new THREE.DirectionalLight('#cffafe', 1.6);
    key.position.set(16, 26, 18);
    root.add(hemi, key);

    // Crisp cyan holographic studio floor
    const floorGeo = new THREE.BoxGeometry(36, 0.8, 36);
    const floorMat = createStudioGridFloorMaterial('#061526', '#22d3ee', 2.0);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.4;
    root.add(floor);
    ctx.addPlatform({ minX: -18, maxX: 18, minZ: -18, maxZ: 18, topY: 0 });

    // Open-air architectural studio corner pillars & glowing overhead beam frame
    const pillarGeo = new THREE.BoxGeometry(0.9, 10.5, 0.9);
    const pillarMat = new THREE.MeshStandardMaterial({
      color: '#0e243d',
      roughness: 0.3,
      metalness: 0.72,
    });
    const accentTrimGeo = new THREE.BoxGeometry(0.18, 10.5, 0.18);
    const accentTrimMat = new THREE.MeshBasicMaterial({ color: '#22d3ee' });

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
      const trim = new THREE.Mesh(accentTrimGeo, accentTrimMat);
      trim.position.set(cx - Math.sign(cx) * 0.48, 5.25, cz - Math.sign(cz) * 0.48);
      root.add(trim);
    }

    // Back feature wall behind the hero nameplate so it reads unmistakably as Eric's Room
    const wallGeo = new THREE.BoxGeometry(20, 8.8, 0.5);
    const wallMat = new THREE.MeshStandardMaterial({
      color: '#081b31',
      roughness: 0.4,
      metalness: 0.55,
    });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 4.4, -15.5);
    root.add(backWall);

    // Unmistakable giant room marquee: "ERIC'S ROOM · ericrius1"
    const heroBanner = createWallBanner({
      title: "ERIC'S ROOM",
      subtitle: 'ericrius1 · Placeholder World — worlds/eric-world/index.ts',
      accentColor: '#22d3ee',
      bgColor: 'rgba(4, 18, 34, 0.92)',
      width: 15.5,
    });
    heroBanner.mesh.position.set(0, 5.4, -15.1);
    root.add(heroBanner.mesh);

    // Central placeholder workbench pedestal with spinning cyan hologram crystal
    const pedestalGeo = new THREE.CylinderGeometry(2.3, 2.7, 0.85, 32);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: '#0f2942',
      roughness: 0.25,
      metalness: 0.75,
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.set(0, 0.425, 0);
    root.add(pedestal);

    const crystalGeo = new THREE.IcosahedronGeometry(1.15, 0);
    const crystalMat = new THREE.MeshStandardMaterial({
      color: '#22d3ee',
      emissive: '#06b6d4',
      emissiveIntensity: 0.75,
      roughness: 0.15,
      metalness: 0.35,
      wireframe: false,
    });
    const crystal = new THREE.Mesh(crystalGeo, crystalMat);
    crystal.position.set(0, 2.8, 0);
    root.add(crystal);

    const ringGeo = new THREE.TorusGeometry(2.1, 0.06, 12, 48);
    const { material: ringMat } = createEnergyRingMaterial('#22d3ee', '#818cf8');
    const holoRing = new THREE.Mesh(ringGeo, ringMat);
    holoRing.position.set(0, 2.8, 0);
    root.add(holoRing);

    const workbenchNote = createFloatingLabel({
      title: "Eric's Build Canvas",
      subtitle: 'Placeholder Room · Use Share Link to invite JP here',
      accentColor: '#67e8f9',
      width: 4.8,
    });
    workbenchNote.sprite.position.set(0, 5.05, 0);
    root.add(workbenchNote.sprite);

    // Portals out of Eric's Room
    ctx.addPortal({
      id: 'eric-to-hub',
      label: 'Portal Hub',
      subtitle: 'Back to Shared Metaverse Hub',
      position: [-9.5, 0, -7.5],
      yaw: 0.55,
      targetWorldId: 'hub',
      targetSpawnId: 'default',
      colorA: '#38bdf8',
      colorB: '#818cf8',
    });

    ctx.addPortal({
      id: 'eric-to-jp',
      label: "JP's Room",
      subtitle: 'Direct link to jpwhitaker',
      position: [9.5, 0, -7.5],
      yaw: -0.55,
      targetWorldId: 'jp-world',
      targetSpawnId: 'from-eric',
      colorA: '#f59e0b',
      colorB: '#fb7185',
    });

    ctx.onUpdate((_, elapsed) => {
      crystal.rotation.y = elapsed * 0.75;
      crystal.rotation.x = Math.sin(elapsed * 0.6) * 0.3;
      crystal.position.y = 2.8 + Math.sin(elapsed * 2.0) * 0.22;
      holoRing.rotation.x = Math.PI * 0.42 + Math.sin(elapsed * 0.9) * 0.25;
      holoRing.rotation.y = elapsed * 0.5;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      floorGeo.dispose();
      floorMat.dispose();
      pillarGeo.dispose();
      pillarMat.dispose();
      accentTrimGeo.dispose();
      accentTrimMat.dispose();
      wallGeo.dispose();
      wallMat.dispose();
      pedestalGeo.dispose();
      pedestalMat.dispose();
      crystalGeo.dispose();
      crystalMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      heroBanner.dispose();
      workbenchNote.dispose();
    });
  },
};

export default ericWorld;
