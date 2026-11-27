import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { createTwilightSkyMaterial, createWetPromenadeMaterial } from './shaders';
import { buildStationScenery, createResourceBag } from './scenery';
import { buildStationInteractions } from './interactions';
import { createStationCollider, stationHeight } from './terrain';

/**
 * MIDNIGHT CASSETTE STATION (`doug-cassette-station`)
 * A nostalgic, calming blue-hour rain-washed cyber-tramway & glowing moss conservatory:
 * glossy neon-reflecting rain puddles with falling drop rings and footstep splashes,
 * floating holographic koi swimming through twilight mist, a giant spinning cassette
 * archway, warm paper lanterns, a cozy waiting gazebo with a sleeping calico cat and
 * retro departure board, glowing Japanese vending machines, a steaming 24H tea & ramen
 * stall, a channel-switching 1990s CRT shrine, a singing red payphone booth, recessed
 * lo-fi Rhodes synth tiles, an elevated twilight commuter train, and 5 hidden mixtapes.
 */
export default defineRoom('doug-cassette-station', {
  async mount(ctx) {
    const root = new THREE.Group();
    root.name = 'doug-cassette-station-root';
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#141730');
    ctx.scene.fog = new THREE.FogExp2('#1a1d38', 0.0115);
    ctx.setTerrainHeight(stationHeight);

    const res = createResourceBag();

    // Soft electric blue-hour moonlight + warm amber lantern bounce
    const moonDir = new THREE.Vector3(-0.38, 0.56, -0.73).normalize();
    const hemi = new THREE.HemisphereLight('#8cb8f5', '#2a1d33', 1.15);
    const moon = new THREE.DirectionalLight('#b4d2ff', 1.35);
    moon.position.copy(moonDir).multiplyScalar(65);
    const warmBounce = new THREE.DirectionalLight('#ffba75', 0.85);
    warmBounce.position.set(16, 14, 18);
    root.add(hemi, moon, warmBounce);

    // Fog-exempt blue-hour twilight sky dome with crescent moon, stars & rose dusk clouds
    const skyMat = res.mat(createTwilightSkyMaterial(moonDir));
    const skyDome = new THREE.Mesh(res.geo(new THREE.SphereGeometry(142, 32, 20)), skyMat);
    skyDome.name = 'cassette-twilight-sky';
    root.add(skyDome);

    await ctx.breathe();

    const promenade = createWetPromenadeMaterial();
    res.mat(promenade.material);

    const scenery = await buildStationScenery(root, res, promenade.material);
    ctx.setCollider(createStationCollider(scenery.solids.boxes, scenery.solids.cylinders));

    await ctx.breathe();

    const interactions = buildStationInteractions(root, res, scenery, promenade);

    // Active-only gentle procedural rain + lo-fi Rhodes synth + glassmorphic toast
    ctx.onActivate(() => interactions.activate());

    // Initial pose for portal snapshots & previews
    interactions.update(0, 0, null);

    ctx.onUpdate((dt, elapsed) => {
      interactions.update(dt, elapsed, ctx.player?.position ?? null);
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      res.dispose();
    });
  },
});
