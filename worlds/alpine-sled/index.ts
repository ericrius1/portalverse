import * as THREE from 'three/webgpu';
import {
  Fn,
  vec3,
  float,
  sin,
  fract,
  mix,
  clamp,
  smoothstep,
  pow,
  max,
  dot,
  normalize,
  positionWorld,
  normalWorld,
  cameraPosition,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flat packed-snow run along |x| <= 4.2, rising gently into snowbanks outside the fences. */
function alpineHeight(x: number, z: number): number {
  const bank = THREE.MathUtils.smoothstep(Math.abs(x), 4.2, 16.0);
  const roll =
    Math.sin(x * 0.14 + z * 0.08) * 1.45 +
    Math.cos(z * 0.11 - x * 0.09) * 1.1 +
    Math.max(0, Math.abs(x) - 10) * 0.24;
  return bank * Math.max(0, roll + 1.2);
}

/** Crisp twilight alpine snow shader with icy shadow tint, alpenglow rim, and crystal glints. */
function createAlpineSnowMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();

  const snowFn = Fn(() => {
    const wp = positionWorld;
    const n = normalize(normalWorld);
    const sunDir = normalize(vec3(-0.55, 0.34, -0.76));
    const ndl = max(dot(n, sunDir), 0.0);

    const shadowSnow = vec3(0.42, 0.52, 0.74);
    const litSnow = vec3(0.95, 0.92, 0.98);
    const alpenglow = vec3(1.0, 0.72, 0.68);
    const base = mix(shadowSnow, litSnow, smoothstep(float(0.05), float(0.75), ndl));
    const warmRim = alpenglow.mul(pow(ndl, 2.5).mul(0.22));

    // View-dependent crystalline snow sparkle
    const cell = wp.xz.mul(3.8).floor();
    const hash = fract(sin(dot(cell, vec3(127.1, 311.7, 0.0).xy)).mul(43758.5453));
    const viewDir = normalize(cameraPosition.sub(wp));
    const angleShift = sin(dot(viewDir, vec3(17.0, 29.0, 13.0)).add(hash.mul(45.0)));
    const glint = smoothstep(float(0.965), float(0.998), hash.mul(0.5).add(angleShift.mul(0.5)));

    // Subtle groomed track tint in the center run
    const onTrack = float(1.0).sub(smoothstep(float(3.2), float(4.5), wp.x.abs()));
    const trackColor = mix(base.add(warmRim), vec3(0.84, 0.89, 0.98), onTrack.mul(0.28));

    return clamp(trackColor.add(vec3(1.0, 0.98, 1.0).mul(glint.mul(0.65))), 0.0, 1.0);
  });

  material.colorNode = snowFn();
  return material;
}

interface FlakeMeta {
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  phase: number;
  scale: number;
}

/**
 * ALPINE SNOW RUN (`alpine-sled`)
 * Inspired by JP's `sled2` & `christmas` worlds: a twilight alpine snow promenade
 * bordered by split-rail timber sled fences, glowing amber lantern posts, frosted
 * fir forests, alpenglow mountain peaks, wooden toboggans, festive gift stacks,
 * and drifting snowfall.
 */
export default defineRoom('alpine-sled', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#1d2a4d');
    ctx.scene.fog = new THREE.Fog('#3b365c', 68, 195);
    ctx.setTerrainHeight(alpineHeight);
    ctx.addPlatform({ minX: -4.2, maxX: 4.2, minZ: -46, maxZ: 46, topY: 0 });

    const hemi = new THREE.HemisphereLight('#c7d2fe', '#334155', 1.15);
    const duskSun = new THREE.DirectionalLight('#ffb899', 1.65);
    duskSun.position.set(-45, 28, -60);
    root.add(hemi, duskSun);

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

    // Sculpted alpine valley snow terrain
    const terrainGeo = trackGeo(new THREE.PlaneGeometry(160, 140, 88, 76));
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);
      posAttr.setY(i, alpineHeight(x, z));
    }
    terrainGeo.computeVertexNormals();
    const terrain = new THREE.Mesh(terrainGeo, trackMat(createAlpineSnowMaterial()));
    root.add(terrain);

    // Split-rail timber sled fences & warm lantern posts flanking the snow run (X = ±4.7)
    const woodMat = trackMat(new THREE.MeshStandardMaterial({ color: '#6b4226', roughness: 0.86 }));
    const lanternGlassMat = trackMat(new THREE.MeshBasicMaterial({ color: '#fde68a' }));
    const postGeo = trackGeo(new THREE.BoxGeometry(0.22, 1.35, 0.22));
    const railGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.14, 7.6));
    const lanternPostGeo = trackGeo(new THREE.BoxGeometry(0.24, 3.3, 0.24));
    const lanternArmGeo = trackGeo(new THREE.BoxGeometry(0.85, 0.14, 0.14));
    const lanternBoxGeo = trackGeo(new THREE.BoxGeometry(0.36, 0.46, 0.36));

    for (const side of [-1, 1]) {
      for (let z = -30; z <= 30; z += 7.5) {
        const py = alpineHeight(side * 4.7, z);
        const post = new THREE.Mesh(postGeo, woodMat);
        post.position.set(side * 4.7, py + 0.65, z);
        root.add(post);

        if (z < 30) {
          for (const ry of [0.48, 0.98]) {
            const rail = new THREE.Mesh(railGeo, woodMat);
            rail.position.set(side * 4.7, py + ry, z + 3.75);
            root.add(rail);
          }
        }
      }

      // Cozy glowing alpine trail lanterns
      for (const lz of [-22, 0, 22]) {
        const ly = alpineHeight(side * 5.2, lz);
        const tallPost = new THREE.Mesh(lanternPostGeo, woodMat);
        tallPost.position.set(side * 5.2, ly + 1.65, lz);
        const arm = new THREE.Mesh(lanternArmGeo, woodMat);
        arm.position.set(side * 4.85, ly + 3.1, lz);
        const glass = new THREE.Mesh(lanternBoxGeo, lanternGlassMat);
        glass.position.set(side * 4.5, ly + 2.8, lz);
        root.add(tallPost, arm, glass);

        if (lz === 0 || side === -1) {
          const lamp = new THREE.PointLight('#fbbf24', 5.5, 18, 1.5);
          lamp.position.set(side * 4.5, ly + 2.75, lz);
          root.add(lamp);
        }
      }
    }

    // Instanced snow-dusted multi-tiered fir trees along the valley slopes
    const rand = mulberry32(12252026);
    const TREE_COUNT = 136;
    const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.34, 1.8, 7));
    const tier1Geo = trackGeo(new THREE.ConeGeometry(2.1, 3.2, 7));
    const tier2Geo = trackGeo(new THREE.ConeGeometry(1.55, 2.8, 7));
    const capGeo = trackGeo(new THREE.ConeGeometry(0.95, 1.8, 7));

    const pineMat = trackMat(new THREE.MeshStandardMaterial({ color: '#1b4332', roughness: 0.85, flatShading: true }));
    const snowCapMat = trackMat(new THREE.MeshStandardMaterial({ color: '#e2e8f0', roughness: 0.75, flatShading: true }));

    const trunks = new THREE.InstancedMesh(trunkGeo, woodMat, TREE_COUNT);
    const tier1 = new THREE.InstancedMesh(tier1Geo, pineMat, TREE_COUNT);
    const tier2 = new THREE.InstancedMesh(tier2Geo, pineMat, TREE_COUNT);
    const caps = new THREE.InstancedMesh(capGeo, snowCapMat, TREE_COUNT);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < TREE_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (7.8 + rand() * 28.0);
      const z = (rand() - 0.5) * 92;
      const y = alpineHeight(x, z);
      const sc = 0.78 + rand() * 0.95;
      const rot = rand() * Math.PI * 2;

      dummy.rotation.set(0, rot, 0);
      dummy.scale.setScalar(sc);
      dummy.position.set(x, y + 0.9 * sc, z);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y + 2.7 * sc, z);
      dummy.updateMatrix();
      tier1.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y + 4.4 * sc, z);
      dummy.updateMatrix();
      tier2.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y + 5.7 * sc, z);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    }
    trunks.instanceMatrix.needsUpdate = true;
    tier1.instanceMatrix.needsUpdate = true;
    tier2.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    root.add(trunks, tier1, tier2, caps);

    // Towering alpenglow mountain peaks framing the horizon
    const mountainGeo = trackGeo(new THREE.ConeGeometry(18, 40, 6));
    const mountainMat = trackMat(new THREE.MeshStandardMaterial({ color: '#475569', roughness: 0.9, flatShading: true }));
    const peakSnowGeo = trackGeo(new THREE.ConeGeometry(7.2, 16, 6));
    const peakSnowMat = trackMat(new THREE.MeshStandardMaterial({ color: '#fbcfe8', roughness: 0.72, flatShading: true }));

    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const mx = side * (54 + rand() * 14);
        const mz = -56 + i * 22 + (rand() - 0.5) * 6;
        const h = 0.85 + rand() * 0.6;
        const m = new THREE.Mesh(mountainGeo, mountainMat);
        m.position.set(mx, 17 * h, mz);
        m.scale.set(1.0 + rand() * 0.4, h, 1.0 + rand() * 0.4);
        m.rotation.y = rand() * Math.PI;
        root.add(m);

        const cap = new THREE.Mesh(peakSnowGeo, peakSnowMat);
        cap.position.set(mx, 29.2 * h, mz);
        cap.scale.copy(m.scale);
        cap.rotation.copy(m.rotation);
        root.add(cap);
      }
    }

    // Playful sled2 props: wooden toboggans & ribbon-wrapped gift stacks beside the fences
    const redMat = trackMat(new THREE.MeshStandardMaterial({ color: '#dc2626', roughness: 0.45 }));
    const goldMat = trackMat(new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.35, metalness: 0.45 }));
    const emeraldMat = trackMat(new THREE.MeshStandardMaterial({ color: '#10b981', roughness: 0.45 }));

    const giftGeo = trackGeo(new THREE.BoxGeometry(1.0, 1.0, 1.0));
    const ribbonGeoA = trackGeo(new THREE.BoxGeometry(1.04, 1.04, 0.16));
    const ribbonGeoB = trackGeo(new THREE.BoxGeometry(0.16, 1.04, 1.04));

    const giftClusters: Array<[number, number]> = [
      [-6.2, -11],
      [6.4, 8],
      [-6.0, 16],
    ];
    for (let c = 0; c < giftClusters.length; c++) {
      const [gx, gz] = giftClusters[c];
      const gy = alpineHeight(gx, gz);
      const boxes: Array<[number, number, number, number, THREE.Material]> = [
        [0, 0.55, 0, 1.1, redMat],
        [0.95, 0.42, 0.35, 0.84, emeraldMat],
        [0.12, 1.4, -0.05, 0.68, goldMat],
      ];
      for (const [ox, oy, oz, sc, mat] of boxes) {
        const g = new THREE.Group();
        g.position.set(gx + ox, gy + oy, gz + oz);
        g.rotation.y = c * 0.7 + ox;
        g.scale.setScalar(sc);
        g.add(
          new THREE.Mesh(giftGeo, mat),
          new THREE.Mesh(ribbonGeoA, mat === goldMat ? redMat : goldMat),
          new THREE.Mesh(ribbonGeoB, mat === goldMat ? redMat : goldMat),
        );
        root.add(g);
      }
    }

    // Stylized wooden sleds parked on the snowbank
    const deckGeo = trackGeo(new THREE.BoxGeometry(1.1, 0.1, 2.3));
    const runnerGeo = trackGeo(new THREE.BoxGeometry(0.1, 0.28, 2.5));
    for (const [sx, sz, rotY] of [
      [6.2, -16, -0.45],
      [-6.5, 4, 0.52],
    ] as const) {
      const sled = new THREE.Group();
      sled.position.set(sx, alpineHeight(sx, sz) + 0.25, sz);
      sled.rotation.y = rotY;
      const deck = new THREE.Mesh(deckGeo, redMat);
      deck.position.y = 0.2;
      const rL = new THREE.Mesh(runnerGeo, woodMat);
      rL.position.set(-0.42, 0.05, 0);
      const rR = new THREE.Mesh(runnerGeo, woodMat);
      rR.position.set(0.42, 0.05, 0);
      sled.add(deck, rL, rR);
      root.add(sled);
    }

    // High overhead timber alpine banner arch at midpoint (well above portals & camera)
    const archPillarGeo = trackGeo(new THREE.CylinderGeometry(0.28, 0.34, 8.2, 10));
    const archTopGeo = trackGeo(new THREE.BoxGeometry(11.6, 0.55, 0.55));
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(archPillarGeo, woodMat);
      p.position.set(side * 5.4, 4.1, 0);
      root.add(p);
    }
    const archBeam = new THREE.Mesh(archTopGeo, woodMat);
    archBeam.position.set(0, 7.9, 0);
    root.add(archBeam);

    // 450 gently drifting snowflakes
    const FLAKE_COUNT = 450;
    const flakeGeo = trackGeo(new THREE.OctahedronGeometry(0.08, 0));
    const flakeMat = trackMat(new THREE.MeshBasicMaterial({ color: '#f8fafc', transparent: true, opacity: 0.85 }));
    const flakes = new THREE.InstancedMesh(flakeGeo, flakeMat, FLAKE_COUNT);
    const flakeMeta: FlakeMeta[] = [];
    for (let i = 0; i < FLAKE_COUNT; i++) {
      flakeMeta.push({
        x: (rand() - 0.5) * 64,
        y: rand() * 20,
        z: (rand() - 0.5) * 86,
        speed: 1.1 + rand() * 1.4,
        drift: 0.4 + rand() * 0.8,
        phase: rand() * Math.PI * 2,
        scale: 0.65 + rand() * 0.9,
      });
    }
    root.add(flakes);

    ctx.onUpdate((dt, elapsed) => {
      for (let i = 0; i < FLAKE_COUNT; i++) {
        const f = flakeMeta[i];
        f.y -= f.speed * dt;
        if (f.y < 0.2) f.y = 20;
        const x = f.x + Math.sin(elapsed * f.drift + f.phase) * 0.95;
        const z = f.z + Math.cos(elapsed * f.drift * 0.8 + f.phase) * 0.75;
        dummy.position.set(x, f.y, z);
        dummy.rotation.set(elapsed + f.phase, elapsed * 0.7, 0);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        flakes.setMatrixAt(i, dummy.matrix);
      }
      flakes.instanceMatrix.needsUpdate = true;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    });
  },
});
