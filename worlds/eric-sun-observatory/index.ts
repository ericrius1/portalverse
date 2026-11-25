import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  float,
  uv,
  time,
  sin,
  cos,
  abs,
  mix,
  clamp,
  smoothstep,
  pow,
  positionWorld,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';

/** Rolling golden-rose sea of sunset clouds beneath the floating marble promenade. */
function createCloudSeaMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const cloudFn = Fn(() => {
    const wp = positionWorld;
    const p = vec2(wp.x.mul(0.055), wp.z.mul(0.055));

    const w1 = sin(p.x.mul(1.7).add(time.mul(0.18))).mul(cos(p.y.mul(1.4).sub(time.mul(0.14))));
    const w2 = sin(p.x.mul(3.1).sub(p.y.mul(2.6)).add(time.mul(0.28))).mul(0.5);
    const w3 = cos(p.x.mul(5.4).add(p.y.mul(4.8)).sub(time.mul(0.36))).mul(0.25);
    const billow = clamp(w1.mul(0.55).add(w2).add(w3).mul(0.5).add(0.5), 0.0, 1.0);

    const shadowCol = vec3(0.42, 0.24, 0.44);
    const roseCol = vec3(0.92, 0.48, 0.46);
    const goldCol = vec3(1.0, 0.84, 0.52);
    const sunCrest = vec3(1.0, 0.96, 0.82);

    const mid = mix(shadowCol, roseCol, smoothstep(float(0.15), float(0.62), billow));
    const lit = mix(mid, goldCol, smoothstep(float(0.52), float(0.86), billow));
    const crest = mix(lit, sunCrest, pow(billow, 4.0).mul(0.55));

    const horizonFade = smoothstep(float(32.0), float(115.0), wp.xz.length());
    return mix(crest, vec3(0.98, 0.72, 0.48), horizonFade.mul(0.55));
  });
  material.colorNode = cloudFn();
  return material;
}

/** Sunlit marble promenade with inlaid golden-brass meridian lines. */
function createMarbleDeckMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const deckFn = Fn(() => {
    const wp = positionWorld;
    const tile = abs(sin(wp.x.mul(1.57)).mul(sin(wp.z.mul(0.785))));
    const marble = mix(vec3(0.91, 0.88, 0.84), vec3(0.98, 0.95, 0.91), smoothstep(float(0.1), float(0.85), tile));

    // Inlaid brass meridian center rail + edge trim + subtle distance rings
    const centerInlay = float(1.0).sub(smoothstep(float(0.03), float(0.11), abs(wp.x)));
    const sideInlay = float(1.0).sub(smoothstep(float(0.04), float(0.14), abs(abs(wp.x).sub(3.85))));
    const ringDist = wp.xz.length();
    const centralMedallion = float(1.0).sub(smoothstep(float(0.05), float(0.16), abs(ringDist.sub(4.2))));

    const brass = vec3(0.92, 0.69, 0.24);
    const goldMask = clamp(centerInlay.mul(0.45).add(sideInlay).add(centralMedallion), 0.0, 1.0);
    return mix(marble, brass, goldMask);
  });
  material.colorNode = deckFn();
  return material;
}

/** Smooth sunset sky gradient dome from warm apricot horizon to deep twilight indigo zenith. */
function createSunsetSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.BackSide;
  const skyFn = Fn(() => {
    const h = clamp(uv().y, 0.0, 1.0);
    const horizon = vec3(1.0, 0.71, 0.42);
    const rose = vec3(0.84, 0.42, 0.48);
    const twilight = vec3(0.19, 0.22, 0.46);
    const zenith = vec3(0.07, 0.1, 0.26);

    const low = mix(horizon, rose, smoothstep(float(0.46), float(0.6), h));
    const mid = mix(low, twilight, smoothstep(float(0.58), float(0.76), h));
    return mix(mid, zenith, smoothstep(float(0.74), float(0.96), h));
  });
  material.colorNode = skyFn();
  return material;
}

interface CompassBeacon {
  crystal: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  phase: number;
}

/**
 * GOLDEN CLOUD OBSERVATORY (`eric-sun-observatory`)
 * A floating marble-and-brass celestial promenade suspended above a billowing
 * sunset sea of clouds, crowned by colossal rotating brass armillary rings,
 * orbiting crystal moons, and player-reactive astrolabe beacons.
 */
export default defineRoom('eric-sun-observatory', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#f59e0b');
    ctx.scene.fog = new THREE.Fog('#f4a261', 85, 220);

    const sunDir = new THREE.Vector3(0.45, 0.34, -0.82).normalize();
    const hemi = new THREE.HemisphereLight('#fde68a', '#6d3b5e', 1.35);
    const sun = new THREE.DirectionalLight('#fff1c2', 2.3);
    sun.position.copy(sunDir).multiplyScalar(80);
    const fill = new THREE.DirectionalLight('#f472b6', 0.65);
    fill.position.set(-24, 14, 28);
    root.add(hemi, sun, fill);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    };

    // Sunset sky dome + glowing golden sun disc
    const skyDome = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(210, 32, 20)),
      trackMat(createSunsetSkyMaterial()),
    );
    root.add(skyDome);

    const sunDisc = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(9.5, 24, 24)),
      trackMat(new THREE.MeshBasicMaterial({ color: '#fffbeb' })),
    );
    sunDisc.position.copy(sunDir).multiplyScalar(168);
    root.add(sunDisc);

    // Rolling TSL sea of clouds below the floating bridge
    const cloudSea = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(260, 260)),
      trackMat(createCloudSeaMaterial()),
    );
    cloudSea.rotation.x = -Math.PI / 2;
    cloudSea.position.y = -4.6;
    root.add(cloudSea);

    // Floating marble-and-brass promenade deck (Y = 0, Z in [-46, 46])
    const marbleMat = trackMat(new THREE.MeshStandardMaterial({ color: '#f3ede4', roughness: 0.38, metalness: 0.08 }));
    const brassMat = trackMat(new THREE.MeshStandardMaterial({ color: '#e5a93c', roughness: 0.24, metalness: 0.86 }));
    const warmGlowMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#fef3c7',
        emissive: '#f59e0b',
        emissiveIntensity: 1.4,
        roughness: 0.2,
      }),
    );

    const deck = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(9.2, 0.5, 94)),
      trackMat(createMarbleDeckMaterial()),
    );
    deck.position.y = -0.25;
    root.add(deck);

    // Sculpted underside cornice so the bridge looks architectural in flight / preview
    const underDeck = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.8, 0.9, 92)), marbleMat);
    underDeck.position.y = -0.95;
    root.add(underDeck);

    // Central circular observation plaza widening around Z = 0
    const plaza = new THREE.Mesh(trackGeo(new THREE.CylinderGeometry(9.6, 8.6, 0.52, 40)), marbleMat);
    plaza.position.set(0, -0.27, 0);
    root.add(plaza);

    const plazaTrim = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(9.55, 0.12, 10, 48)), brassMat);
    plazaTrim.rotation.x = Math.PI / 2;
    plazaTrim.position.y = 0.02;
    root.add(plazaTrim);

    ctx.addPlatform({ minX: -4.8, maxX: 4.8, minZ: -46, maxZ: 46, topY: 0 });
    ctx.addPlatform({ minX: -9.5, maxX: 9.5, minZ: -9.5, maxZ: 9.5, topY: 0 });

    // Classical marble columns & floating astrolabe beacons flanking the promenade (outside |X| = 4.5)
    const colGeo = trackGeo(new THREE.CylinderGeometry(0.32, 0.38, 6.2, 14));
    const capGeo = trackGeo(new THREE.BoxGeometry(0.98, 0.34, 0.98));
    const crystalGeo = trackGeo(new THREE.OctahedronGeometry(0.42, 0));
    const beaconRingGeo = trackGeo(new THREE.TorusGeometry(0.62, 0.04, 8, 24));

    const beacons: CompassBeacon[] = [];
    const colZs = [-28, -18, -10, 10, 18, 28];
    for (let i = 0; i < colZs.length; i++) {
      const z = colZs[i];
      for (const side of [-1, 1]) {
        const cx = side * 4.55;
        const col = new THREE.Mesh(colGeo, marbleMat);
        col.position.set(cx, 3.1, z);
        const cap = new THREE.Mesh(capGeo, brassMat);
        cap.position.set(cx, 6.3, z);
        const base = new THREE.Mesh(capGeo, marbleMat);
        base.position.set(cx, 0.17, z);
        root.add(col, cap, base);

        const bMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: '#fde68a',
            emissive: '#f59e0b',
            emissiveIntensity: 0.9,
            roughness: 0.18,
            metalness: 0.35,
          }),
        );
        const crystal = new THREE.Mesh(crystalGeo, bMat);
        crystal.position.set(cx, 7.35, z);
        const miniRing = new THREE.Mesh(beaconRingGeo, brassMat);
        crystal.add(miniRing);
        root.add(crystal);

        beacons.push({ crystal, mat: bMat, x: cx, z, phase: i * 0.9 + (side > 0 ? 1.4 : 0) });
      }
    }

    // Colossal rotating brass armillary sphere arching high around the central plaza
    const armillaryRoot = new THREE.Group();
    armillaryRoot.position.set(0, 13.5, 0);
    root.add(armillaryRoot);

    const ringOuter = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(18.5, 0.34, 14, 72)), brassMat);
    const ringMid = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(15.2, 0.28, 14, 64)), brassMat);
    const ringInner = new THREE.Mesh(trackGeo(new THREE.TorusGeometry(11.8, 0.22, 12, 56)), brassMat);
    ringOuter.rotation.set(0.32, 0.2, 0.15);
    ringMid.rotation.set(-0.55, 0.8, 0.4);
    ringInner.rotation.set(0.9, -0.45, -0.35);
    armillaryRoot.add(ringOuter, ringMid, ringInner);

    // Orbiting celestial crystal moons mounted on the armillary rings
    const moonGeo = trackGeo(new THREE.IcosahedronGeometry(0.95, 1));
    const moonSpecs: Array<[THREE.Object3D, number, number, string]> = [
      [ringOuter, 18.5, 0.4, '#fef08a'],
      [ringOuter, 18.5, 3.54, '#fdba74'],
      [ringMid, 15.2, 1.8, '#fbcfe8'],
      [ringInner, 11.8, 5.1, '#93c5fd'],
    ];
    for (const [parentRing, radius, angle, hex] of moonSpecs) {
      const moonMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: hex,
          emissive: hex,
          emissiveIntensity: 0.75,
          roughness: 0.15,
          metalness: 0.25,
        }),
      );
      const moon = new THREE.Mesh(moonGeo, moonMat);
      moon.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      parentRing.add(moon);
    }

    // Warm golden solar core floating high at the center of the armillary sphere
    const solarCore = new THREE.Mesh(trackGeo(new THREE.IcosahedronGeometry(1.65, 1)), warmGlowMat);
    armillaryRoot.add(solarCore);

    // Floating distant marble obelisk islands drifting in the cloud sea
    const islandGeo = trackGeo(new THREE.ConeGeometry(4.2, 8.5, 6));
    const obeliskGeo = trackGeo(new THREE.BoxGeometry(0.9, 6.4, 0.9));
    const islandCoords: Array<[number, number, number, number]> = [
      [-26, 2.5, -22, 1.15],
      [28, 4.2, -16, 0.95],
      [-24, 3.8, 20, 1.05],
      [27, 2.0, 24, 1.2],
    ];
    const islands: Array<{ group: THREE.Group; baseY: number; phase: number }> = [];
    for (let i = 0; i < islandCoords.length; i++) {
      const [ix, iy, iz, s] = islandCoords[i];
      const g = new THREE.Group();
      g.position.set(ix, iy, iz);
      g.scale.setScalar(s);
      const cone = new THREE.Mesh(islandGeo, marbleMat);
      cone.rotation.x = Math.PI;
      cone.position.y = -4.25;
      const spire = new THREE.Mesh(obeliskGeo, marbleMat);
      spire.position.y = 3.2;
      const tip = new THREE.Mesh(crystalGeo, warmGlowMat);
      tip.position.y = 7.2;
      g.add(cone, spire, tip);
      root.add(g);
      islands.push({ group: g, baseY: iy, phase: i * 1.6 });
    }

    ctx.onUpdate((dt, elapsed) => {
      const playerPos = ctx.player?.position;

      // Subtle boost to the armillary glow when the player stands under the central observatory
      let centerBoost = 0;
      if (playerPos) {
        const dCenter = Math.hypot(playerPos.x, playerPos.z);
        centerBoost = Math.max(0, 1 - dCenter / 14);
      }

      const speedMul = 1 + centerBoost * 0.9;
      ringOuter.rotation.y += dt * 0.14 * speedMul;
      ringOuter.rotation.z += dt * 0.06 * speedMul;
      ringMid.rotation.x += dt * 0.19 * speedMul;
      ringMid.rotation.y -= dt * 0.11 * speedMul;
      ringInner.rotation.z -= dt * 0.24 * speedMul;
      ringInner.rotation.x += dt * 0.12 * speedMul;

      solarCore.rotation.y = elapsed * 0.55;
      solarCore.scale.setScalar(1 + Math.sin(elapsed * 2.1) * 0.06 + centerBoost * 0.14);
      warmGlowMat.emissiveIntensity = 1.35 + centerBoost * 0.9;

      for (const b of beacons) {
        let boost = 0;
        if (playerPos) {
          const dist = Math.hypot(playerPos.x - b.x, playerPos.z - b.z);
          boost = Math.max(0, 1 - dist / 10);
        }
        b.crystal.rotation.y = elapsed * (0.9 + boost * 1.4) + b.phase;
        b.crystal.position.y = 7.35 + Math.sin(elapsed * 2.0 + b.phase) * 0.18 + boost * 0.25;
        b.mat.emissiveIntensity = 0.85 + boost * 1.4;
      }

      for (const isl of islands) {
        isl.group.position.y = isl.baseY + Math.sin(elapsed * 0.65 + isl.phase) * 0.45;
      }
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    });
  },
});
