import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { createArchwayPortal } from '@portalverse/core/engine/PortalMesh';
import { createFloatingLabel } from '@portalverse/core/engine/signage';
import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import alhambraDomeUrl from './assets/alhambra-dome.jpg?url';
import {
  DEFAULT_SPAWN_POS,
  ENTRANCE_ARRIVAL_YAW,
  ENTRANCE_POS,
  ENTRANCE_PORTAL_YAW,
  ENTRANCE_Z,
  duskAt,
  walkHeight,
} from './layout';
import { timeOfDay } from './timeOfDay';
import { palaceCollider, palaceSurface } from './collide';
import { pathCollider, pathSurface } from './path/curve';
import { createDomePortal, type DomePortalHandle } from './domePortal';
import { TREE_TRUNKS } from './trees';

/**
 * PALACE LAGOON (`ericrius1`): a magical Palace of Fine Arts, drawn with weft (Eric's WebGPU engine) on the device
 * portalverse shares (`ctx.gpu`), composited with depth under the room's Three.js scene (`ctx.addGpuLayer`).
 *
 * You arrive in the sunlit courtyard behind the monumental north colonnade portico, stroll through the classical
 * arches across the wildflower meadow and over the reflecting lagoon boardwalk, enter the rotunda's north arch,
 * and glide up a single fluid handcrafted Spanish-cedar spiral right into a Granada Alhambra ceramic dome portal.
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
    lightFor(ENTRANCE_Z, 0);

    // Spawn just inside the sunlit courtyard behind the north colonnade portico looking straight through the arches.
    ctx.configureSpawn({
      position: [DEFAULT_SPAWN_POS[0], DEFAULT_SPAWN_POS[1], DEFAULT_SPAWN_POS[2]],
      yaw: ENTRANCE_ARRIVAL_YAW,
      pitch: 0,
    });

    // Place the entrance portal back behind the monumental 4-column north colonnade portico for a grand ground walk.
    ctx.customizeRouteGate?.('entrance', gate => {
      const handle = createArchwayPortal(
        {
          ...gate,
          position: [ENTRANCE_POS[0], ENTRANCE_POS[1], ENTRANCE_POS[2]],
          yaw: ENTRANCE_PORTAL_YAW,
          oneWay: true,
        },
        { passage: true, routeGate: true },
      );
      handle.arrivalSpawn = {
        position: [ENTRANCE_POS[0], ENTRANCE_POS[1], ENTRANCE_POS[2]],
        yaw: ENTRANCE_ARRIVAL_YAW,
        pitch: 0,
      };
      return handle;
    });

    // Load the Granada / Alhambra Spanish ceramic dome texture in parallel with the room's WebGPU assets.
    let mosaicTexture: THREE.Texture | null = null;
    const mosaicReady = new THREE.TextureLoader()
      .loadAsync(alhambraDomeUrl)
      .then(tex => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        mosaicTexture = tex;
      })
      .catch(error => {
        console.warn('[palace-lagoon] Alhambra dome texture failed to load', error);
      });
    ctx.onDispose(() => {
      mosaicTexture?.dispose();
      mosaicTexture = null;
    });

    // Replace the default exit ring with the giant Alhambra Spanish-tile dome portal + summit threshold ring.
    // (RoomInstance runs routeGateBuilders right after mount() resolves, so mosaicTexture is already loaded.)
    let domePortal: DomePortalHandle | null = null;
    ctx.customizeRouteGate?.('exit', gate => {
      domePortal = createDomePortal(gate, mosaicTexture);
      return domePortal;
    });

    // The meadow and the lagoon, the Palace's podium and tops (once its mesh is loaded), and the boardwalk + wooden spiral.
    let palaceLoaded = () => false;
    ctx.setTerrainHeight((x, z, fromY) => Math.max(
      walkHeight(x, z),
      palaceLoaded() ? palaceSurface(x, z, fromY) : -Infinity,
      pathSurface(x, z, fromY),
    ));
    ctx.setCollider(composeColliders(() => palaceLoaded(), palaceCollider, pathCollider));
    // Room enough to walk round the whole Palace, the lagoon and the hall behind it.
    ctx.setWalkBounds({ minX: -140, maxX: 150, minZ: -165, maxZ: 140 });

    const gpu = ctx.gpu;
    if (!gpu) {
      await mosaicReady;
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
    palaceLoaded = () => lagoon.hasPalace;
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
    // Wait for every pipeline, the Palace mesh, and the Alhambra dome mosaic so slow connections arrive whole.
    await Promise.all([
      lagoon.ensureReady().catch(error => console.warn('[palace-lagoon] partly loaded', error)),
      mosaicReady,
    ]);
    ctx.addGpuLayer(lagoon.layer);
  },
});

/** Compose the Palace solids (when visible), the path handrails, and the trees' trunks. */
function composeColliders(
  palaceReady: () => boolean,
  palace: RoomCollider,
  path: RoomCollider,
): RoomCollider {
  return {
    move(from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, r: number, height: number): [number, number] {
      let [x, z] = palaceReady() ? palace.move(from, to, r, height) : [to[0], to[2]];
      [x, z] = path.move(from, [x, to[1], z], r, height);
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
