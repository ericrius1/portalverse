import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { createFloatingLabel } from '@portalverse/core/engine/signage';
import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import { duskAt, walkHeight } from './layout';
import { timeOfDay } from './timeOfDay';
import { palaceCollider, palaceSurface } from './collide';
import { pathSurface } from './path/curve';
import { createDomePortal, type DomePortalHandle } from './domePortal';
import { TREE_TRUNKS } from './trees';

/**
 * PALACE LAGOON (`ericrius1`): a magical Palace of Fine Arts, drawn with weft (Eric's WebGPU engine) on the device
 * portalverse shares (`ctx.gpu`), composited with depth under the room's Three.js scene (`ctx.addGpuLayer`).
 *
 * Earth's Palace (github.com/ericrius1/world) stands across the portal path: you arrive on the lawn at sunset, walk up
 * onto the rotunda's podium, in through its north arch, under the dome, and out through the exit portal standing in
 * its south arch, the light going from sunset to night as you walk (the moon up, the aurora over everything). A fleet
 * of drones projects light onto the stone as the dark comes (packages/core/src/rooms/projection: real projectors, a
 * module for projection mapping anywhere). Trees, creatures, lanterns. See renderer.ts for the drawing, layout.ts for
 * where things are, timeOfDay.ts for the walk's light, show.ts for the drones.
 */
export default defineRoom('eric-palace-lagoon', {
  async mount(ctx) {
    // Three.js lights the players and the portals to match the weft light, which changes along the walk.
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    const sky = new THREE.HemisphereLight('#9fb8e6', '#4a5228', 1.1);
    const lamp = new THREE.PointLight('#ffb070', 0, 18, 1.6);
    ctx.scene.add(sun, sky, lamp);
    const lightFor = (z: number, y = 0) => {
      const tod = timeOfDay(duskAt(z, y));
      const k = tod.keyColor;
      sun.color.setRGB(k[0], k[1], k[2]).multiplyScalar(0.36);
      sun.position.set(tod.keyDir[0] * 50, tod.keyDir[1] * 50, tod.keyDir[2] * 50);
      // (a floor under the sky's light, so a player is never lost in the dark)
      sky.color.setRGB(tod.ambSky[0] * 3 + 0.05, tod.ambSky[1] * 3 + 0.06, tod.ambSky[2] * 3 + 0.1);
      sky.groundColor.setRGB(tod.ambGround[0] * 3 + 0.02, tod.ambGround[1] * 3 + 0.02, tod.ambGround[2] * 3 + 0.02);
      lamp.intensity = tod.night * 6;
    };
    lightFor(36, 0);

    // Replace the default exit ring with the giant Arabic-mosaic dome-roof portal spanning the rotunda's inner dome.
    let domePortal: DomePortalHandle | null = null;
    ctx.customizeRouteGate?.('exit', gate => {
      domePortal = createDomePortal(gate);
      return domePortal;
    });

    // The meadow and the lagoon, the Palace's podium and tops, and the boardwalk + ascending celestial sky-path.
    ctx.setTerrainHeight((x, z, fromY) => Math.max(walkHeight(x, z), palaceSurface(x, z, fromY), pathSurface(x, z, fromY)));
    ctx.setCollider(withTrunks(palaceCollider));
    // Room enough to walk round the whole Palace, the lagoon and the hall behind it.
    ctx.setWalkBounds({ minX: -140, maxX: 150, minZ: -165, maxZ: 140 });

    const gpu = ctx.gpu;
    if (!gpu) {
      // No WebGPU here (Three.js is on WebGL): a plain meadow and a note, so the loop still walks through.
      ctx.scene.background = new THREE.Color('#e9c79a');
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#4b6a24' }));
      const label = createFloatingLabel({ title: 'PALACE LAGOON', subtitle: 'This room needs WebGPU', accentColor: '#f5d29a' });
      label.sprite.position.set(0, 3, -6);
      ctx.scene.add(ground, label.sprite);
      ctx.onDispose(() => {
        ground.geometry.dispose();
        (ground.material as THREE.Material).dispose();
        label.dispose();
      });
      return;
    }

    // weft and the room's shaders load with the room, not before.
    const { lagoonRenderer } = await import('./renderer');
    const lagoon = lagoonRenderer(gpu);
    ctx.onUpdate(() => {
      const p = ctx.player?.position ?? null;
      domePortal?.setPlayerPosition(p);
      if (!p) return;
      lagoon.player = [p.x, p.y, p.z];
      lightFor(p.z, p.y);
      lamp.position.set(p.x, p.y + 2.2, p.z + 1.5);
    });
    // (the player's feet only while this mount is the room they're in: a preview of it has none)
    ctx.onActivate(() => () => {
      lagoon.player = null;
      domePortal?.setPlayerPosition(null);
    });
    // Wait for the pipelines and the Palace (fetched and unpacked in a worker, uploaded in slices) so the
    // room is whole when it's first seen; past 15 s it opens without the Palace, which fades in when it comes.
    const ready = lagoon.ready.catch(error => console.warn('[palace-lagoon] partly loaded', error));
    await Promise.race([ready, new Promise(resolve => setTimeout(resolve, 15000))]);
    ctx.addGpuLayer(lagoon.layer);
  },
});

/** The Palace's collider, with the trees' trunks to walk round too. */
function withTrunks(inner: RoomCollider): RoomCollider {
  if (!TREE_TRUNKS.length) return inner;
  return {
    move(from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, r: number, height: number): [number, number] {
      let [x, z] = inner.move(from, to, r, height);
      // (only the trunks near the step; the trees are tall enough that a flier above them is past them)
      for (const [tx, tz, tr] of TREE_TRUNKS) {
        const dx = x - tx, dz = z - tz;
        const reach = tr + r;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        const d = Math.hypot(dx, dz);
        if (d < reach && to[1] < 8) {
          x = d > 1e-6 ? tx + (dx * reach) / d : tx + reach;
          z = d > 1e-6 ? tz + (dz * reach) / d : tz;
        }
      }
      return [x, z];
    },
  };
}
