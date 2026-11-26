import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { createFloatingLabel } from '@portalverse/core/engine/signage';
import { SUN_COLOR, SUN_DIR, walkHeight } from './layout';
import { palaceCollider, palaceSurface } from './collide';

/**
 * PALACE LAGOON (`ericrius1`): the first room not drawn by Three.js.
 *
 * Earth's Palace of Fine Arts (github.com/ericrius1/world) across a mirror-still
 * lagoon at golden hour, from a wildflower meadow on its east shore. Drawn with weft,
 * Eric's WebGPU engine, on the device portalverse shares (`ctx.gpu`), and composited
 * with depth under the room's Three.js scene (`ctx.addGpuLayer`), so the portals and
 * the players stand in it like anywhere else. See renderer.ts for the drawing,
 * layout.ts for where things are, palaceMesh.worker.ts for the mesh's loading.
 */
export default defineRoom('eric-palace-lagoon', {
  async mount(ctx) {
    // Three.js lights the players and the portals to match the weft sun and sky.
    const sun = new THREE.DirectionalLight(new THREE.Color(SUN_COLOR[0], SUN_COLOR[1], SUN_COLOR[2]).multiplyScalar(0.36), 1.6);
    sun.position.set(SUN_DIR[0] * 50, SUN_DIR[1] * 50, SUN_DIR[2] * 50);
    const sky = new THREE.HemisphereLight('#9fb8e6', '#4a5228', 1.1);
    ctx.scene.add(sun, sky);
    // The meadow and the lagoon, the Palace's podium and (from above) its tops; its piers and columns to walk round.
    ctx.setTerrainHeight((x, z, fromY) => Math.max(walkHeight(x, z), palaceSurface(x, z, fromY)));
    ctx.setCollider(palaceCollider);
    // Room enough to walk round the whole Palace, the hall behind it and the hills to the east.
    ctx.setWalkBounds({ minX: -250, maxX: 160, minZ: -190, maxZ: 190 });

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
    // Wait for the pipelines and the Palace (fetched and unpacked in a worker, uploaded in slices) so the
    // room is whole when it's first seen; past 15 s it opens without the Palace, which fades in when it comes.
    const ready = lagoon.ready.catch(error => console.warn('[palace-lagoon] partly loaded', error));
    await Promise.race([ready, new Promise(resolve => setTimeout(resolve, 15000))]);
    ctx.addGpuLayer(lagoon.layer);
  },
});
