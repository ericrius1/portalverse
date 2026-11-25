import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  float,
  time,
  sin,
  cos,
  mix,
  clamp,
  smoothstep,
  pow,
  max,
  dot,
  normalize,
  positionWorld,
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

/** Animated WebGPU TSL Hawaiian coastal lagoon water with turquoise shallows & caustics. */
function createLagoonWaterMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.opacity = 0.88;

  const waterFn = Fn(() => {
    const wp = positionWorld;
    const p = vec2(wp.x, wp.z);

    // Dual crossing trade-wind swell ripples
    const w1 = sin(p.x.mul(0.52).add(p.y.mul(0.34)).add(time.mul(1.7)));
    const w2 = cos(p.x.mul(-0.38).add(p.y.mul(0.61)).sub(time.mul(1.35)));
    const w3 = sin(p.x.mul(1.15).sub(p.y.mul(0.95)).add(time.mul(2.4)));
    const ripple = w1.mul(0.45).add(w2.mul(0.35)).add(w3.mul(0.2));

    // Shallow turquoise near boardwalk & sandbars, deeper cobalt farther out
    const distFromCenter = wp.x.abs();
    const depthMix = smoothstep(float(4.5), float(34.0), distFromCenter);
    const shallow = vec3(0.11, 0.78, 0.76);
    const mid = vec3(0.05, 0.56, 0.68);
    const deep = vec3(0.03, 0.28, 0.48);
    const base = mix(mix(shallow, mid, smoothstep(float(0.0), float(0.55), depthMix)), deep, depthMix);

    // Shimmering sunlight caustic web
    const c1 = sin(p.x.mul(1.6).add(w2.mul(1.1)).add(time.mul(1.8)));
    const c2 = sin(p.y.mul(1.5).sub(w1.mul(1.1)).sub(time.mul(1.5)));
    const caustic = pow(clamp(c1.mul(c2).mul(0.5).add(0.5), 0.0, 1.0), 4.0);

    // Sun specular sparkle along perturbed wave normal
    const normal = normalize(vec3(w1.mul(0.14).add(w3.mul(0.06)), float(1.0), w2.mul(0.14).sub(w3.mul(0.06))));
    const viewDir = normalize(cameraPosition.sub(wp));
    const sunDir = normalize(vec3(0.52, 0.62, -0.58));
    const halfVec = normalize(sunDir.add(viewDir));
    const spec = pow(max(dot(normal, halfVec), 0.0), 42.0);
    const fresnel = pow(clamp(float(1.0).sub(max(dot(normal, viewDir), 0.0)), 0.0, 1.0), 3.0);

    const skyTint = vec3(0.68, 0.91, 1.0);
    const col = mix(base, skyTint, fresnel.mul(0.42))
      .add(vec3(0.32, 0.88, 0.85).mul(caustic.mul(0.28)).mul(float(1.0).sub(depthMix.mul(0.65))))
      .add(vec3(1.0, 0.96, 0.84).mul(spec.mul(0.95)))
      .add(vec3(0.05, 0.14, 0.16).mul(ripple.mul(0.12)));

    return col;
  });

  material.colorNode = waterFn();
  return material;
}

interface PalmCluster {
  crown: THREE.Group;
  phase: number;
}

interface FishMeta {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  speed: number;
  phase: number;
  y: number;
  scale: number;
}

/**
 * KĀNEʻOHE FISHPOND (`fishpond`)
 * Inspired by JP's `water-pro-fishpond` & `ahupuaa` worlds: a sunlit Hawaiian
 * coastal loko iʻa with a timber-and-basalt kuapā promenade across turquoise TSL
 * waters, volcanic stone fishpond walls, swaying coconut palms, darting reef
 * fish, and emerald fluted Koʻolau cliffs.
 */
export default defineRoom('fishpond', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#7dd3fc');
    ctx.scene.fog = new THREE.Fog('#bae6fd', 76, 215);

    const sunDir = new THREE.Vector3(0.52, 0.62, -0.58).normalize();
    const hemi = new THREE.HemisphereLight('#e0f7ff', '#115e59', 1.35);
    const sun = new THREE.DirectionalLight('#fff5d6', 2.25);
    sun.position.copy(sunDir).multiplyScalar(75);
    root.add(hemi, sun);

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

    // Warm tropical sun disc
    const sunDisc = new THREE.Mesh(
      trackGeo(new THREE.SphereGeometry(5.8, 24, 24)),
      trackMat(new THREE.MeshBasicMaterial({ color: '#fffbeb' })),
    );
    sunDisc.position.copy(sunDir).multiplyScalar(150);
    root.add(sunDisc);

    // Sandy turquoise seabed below the water so shallow areas glow softly
    const seabed = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(180, 180)),
      trackMat(new THREE.MeshStandardMaterial({ color: '#c7b897', roughness: 0.92 })),
    );
    seabed.rotation.x = -Math.PI / 2;
    seabed.position.y = -1.65;
    root.add(seabed);

    // Animated WebGPU TSL lagoon surface
    const water = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(180, 180, 1, 1)),
      trackMat(createLagoonWaterMaterial()),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.36;
    root.add(water);

    // Level central boardwalk / basalt kuapā promenade (Y = 0, Z in [-46, 46])
    const basaltMat = trackMat(new THREE.MeshStandardMaterial({ color: '#3b3c40', roughness: 0.86, metalness: 0.08 }));
    const timberMat = trackMat(new THREE.MeshStandardMaterial({ color: '#9c7146', roughness: 0.78 }));
    const darkTimberMat = trackMat(new THREE.MeshStandardMaterial({ color: '#6b492c', roughness: 0.82 }));
    const ropeMat = trackMat(new THREE.MeshStandardMaterial({ color: '#d4b886', roughness: 0.9 }));

    const causewayBase = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.8, 1.4, 94)), basaltMat);
    causewayBase.position.set(0, -0.78, 0);
    root.add(causewayBase);

    const deckMesh = new THREE.Mesh(trackGeo(new THREE.BoxGeometry(7.2, 0.14, 92)), timberMat);
    deckMesh.position.set(0, -0.07, 0);
    root.add(deckMesh);

    // Plank seam strips along the boardwalk for rich visual texture
    const plankGeo = trackGeo(new THREE.BoxGeometry(7.24, 0.03, 0.14));
    const plankCount = 74;
    const planks = new THREE.InstancedMesh(plankGeo, darkTimberMat, plankCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < plankCount; i++) {
      dummy.position.set(0, -0.005, -44 + i * 1.2);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      planks.setMatrixAt(i, dummy.matrix);
    }
    planks.instanceMatrix.needsUpdate = true;
    root.add(planks);

    // Walkable promenade collider
    ctx.addPlatform({ minX: -3.7, maxX: 3.7, minZ: -46, maxZ: 46, topY: 0 });

    // Timber bollards & sagging rope rails flanking the boardwalk (outside |X| = 3.65)
    const postGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.13, 1.35, 10));
    const postPositions: number[] = [];
    for (let z = -32; z <= 32; z += 8) {
      postPositions.push(z);
    }
    const postMesh = new THREE.InstancedMesh(postGeo, darkTimberMat, postPositions.length * 2);
    let postIdx = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < postPositions.length; i++) {
        const z = postPositions[i];
        dummy.position.set(side * 3.62, 0.48, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        postMesh.setMatrixAt(postIdx++, dummy.matrix);

        if (i < postPositions.length - 1) {
          const zNext = postPositions[i + 1];
          const curve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(side * 3.62, 0.94, z),
            new THREE.Vector3(side * 3.62, 0.66, (z + zNext) * 0.5),
            new THREE.Vector3(side * 3.62, 0.94, zNext),
          ]);
          const rope = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, 10, 0.032, 6, false)), ropeMat);
          root.add(rope);
        }
      }
    }
    postMesh.instanceMatrix.needsUpdate = true;
    root.add(postMesh);

    // Curved volcanic basalt kuapā rock walls enclosing left & right fishpond basins
    const rand = mulberry32(8082026);
    const rockGeo = trackGeo(new THREE.DodecahedronGeometry(1.0, 0));
    const rockTransforms: Array<{ x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number }> = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i <= 34; i++) {
        const t = i / 34;
        const z = -38 + t * 76;
        const arc = Math.sin(t * Math.PI);
        const x = side * (11.5 + arc * 14.5);
        for (let k = 0; k < 2; k++) {
          rockTransforms.push({
            x: x + (rand() - 0.5) * 1.4,
            y: -0.35 + k * 0.52 + (rand() - 0.5) * 0.18,
            z: z + (rand() - 0.5) * 1.3,
            sx: 1.0 + rand() * 0.9,
            sy: 0.65 + rand() * 0.45,
            sz: 1.0 + rand() * 0.9,
            ry: rand() * Math.PI * 2,
          });
        }
      }
    }
    const rocks = new THREE.InstancedMesh(rockGeo, basaltMat, rockTransforms.length);
    for (let i = 0; i < rockTransforms.length; i++) {
      const r = rockTransforms[i];
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(rand() * 0.25, r.ry, rand() * 0.25);
      dummy.scale.set(r.sx, r.sy, r.sz);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;
    root.add(rocks);

    // Warm cream coral sandbars nestled along the outer fishpond banks
    const sandMat = trackMat(new THREE.MeshStandardMaterial({ color: '#ede0c4', roughness: 0.92 }));
    const sandbarGeo = trackGeo(new THREE.CylinderGeometry(8.5, 11.5, 1.2, 24));
    const sandbarCoords: Array<[number, number, number]> = [
      [-23, -18, 1.1],
      [-26, 14, 1.25],
      [24, -12, 1.2],
      [22, 20, 1.05],
    ];
    for (const [sx, sz, sc] of sandbarCoords) {
      const bar = new THREE.Mesh(sandbarGeo, sandMat);
      bar.position.set(sx, -0.58, sz);
      bar.scale.set(sc, 0.75, sc * 1.35);
      root.add(bar);
    }

    // Swaying coconut palms anchored on the sandbars
    const trunkMat = trackMat(new THREE.MeshStandardMaterial({ color: '#7c5d41', roughness: 0.88 }));
    const frondMat = trackMat(new THREE.MeshStandardMaterial({ color: '#2f8545', roughness: 0.65, side: THREE.DoubleSide }));
    const frondGeo = trackGeo(new THREE.PlaneGeometry(0.95, 4.4, 2, 6));
    const fPos = frondGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < fPos.count; i++) {
      const y = fPos.getY(i) + 2.2; // 0..4.4
      const t = y / 4.4;
      const taper = Math.sin(Math.pow(t, 0.7) * Math.PI);
      fPos.setX(i, fPos.getX(i) * (0.25 + 0.85 * taper));
      fPos.setY(i, y);
      fPos.setZ(i, -t * t * 1.35);
    }
    frondGeo.computeVertexNormals();

    const palms: PalmCluster[] = [];
    const palmSpots: Array<[number, number, number, number]> = [
      [-19.5, -19, 8.8, 0.4],
      [-24.5, -14, 10.2, 0.9],
      [-22.0, 12, 9.4, 2.2],
      [-26.5, 18, 11.0, 1.5],
      [20.5, -14, 9.6, -2.1],
      [25.5, -8, 8.4, -1.6],
      [19.5, 18, 10.5, -0.8],
      [24.5, 24, 8.9, -2.6],
    ];
    for (let i = 0; i < palmSpots.length; i++) {
      const [px, pz, height, leanAngle] = palmSpots[i];
      const leanX = Math.cos(leanAngle) * 2.1;
      const leanZ = Math.sin(leanAngle) * 2.1;
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(px, -0.3, pz),
        new THREE.Vector3(px + leanX * 0.35, height * 0.38, pz + leanZ * 0.35),
        new THREE.Vector3(px + leanX * 0.78, height * 0.74, pz + leanZ * 0.78),
        new THREE.Vector3(px + leanX, height, pz + leanZ),
      ]);
      const trunk = new THREE.Mesh(trackGeo(new THREE.TubeGeometry(curve, 12, 0.24, 8, false)), trunkMat);
      root.add(trunk);

      const crown = new THREE.Group();
      crown.position.set(px + leanX, height, pz + leanZ);
      for (let f = 0; f < 7; f++) {
        const frond = new THREE.Mesh(frondGeo, frondMat);
        frond.rotation.y = (f / 7) * Math.PI * 2 + (i % 3) * 0.25;
        frond.rotation.x = 0.72 + (f % 2) * 0.22;
        crown.add(frond);
      }
      root.add(crown);
      palms.push({ crown, phase: i * 1.1 });
    }

    // Fluted emerald Koʻolau mountain cliffs rising on both horizons
    const ridgeMat = trackMat(new THREE.MeshStandardMaterial({ color: '#1d5c48', roughness: 0.9, flatShading: true }));
    const ridgeGeo = trackGeo(new THREE.ConeGeometry(16, 36, 7));
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const peak = new THREE.Mesh(ridgeGeo, ridgeMat);
        const z = -54 + i * 22 + (rand() - 0.5) * 6;
        const hScale = 0.78 + rand() * 0.65;
        const wScale = 0.9 + rand() * 0.45;
        peak.position.set(side * (56 + rand() * 12), 14 * hScale - 2, z);
        peak.scale.set(wScale, hScale, wScale * 1.15);
        peak.rotation.y = rand() * Math.PI;
        root.add(peak);
      }
    }

    // Animated schools of shimmering reef fish swimming just beneath the lagoon surface
    const FISH_COUNT = 90;
    const fishGeo = trackGeo(new THREE.ConeGeometry(0.11, 0.52, 5));
    fishGeo.rotateX(Math.PI / 2);
    const fishMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#e2f8ff',
        emissive: '#38bdf8',
        emissiveIntensity: 0.28,
        roughness: 0.22,
        metalness: 0.7,
      }),
    );
    const fishMesh = new THREE.InstancedMesh(fishGeo, fishMat, FISH_COUNT);
    const fishMeta: FishMeta[] = [];
    const schoolCenters: Array<[number, number]> = [
      [-10, -14],
      [-11, 12],
      [10, -8],
      [11, 16],
    ];
    for (let i = 0; i < FISH_COUNT; i++) {
      const [scx, scz] = schoolCenters[i % schoolCenters.length];
      fishMeta.push({
        cx: scx + (rand() - 0.5) * 4.5,
        cz: scz + (rand() - 0.5) * 6.0,
        rx: 2.2 + rand() * 3.8,
        rz: 3.0 + rand() * 4.5,
        speed: (0.45 + rand() * 0.45) * (i % 2 === 0 ? 1 : -1),
        phase: rand() * Math.PI * 2,
        y: -0.62 - rand() * 0.45,
        scale: 0.75 + rand() * 0.65,
      });
    }
    root.add(fishMesh);

    ctx.onUpdate((_, elapsed) => {
      for (const palm of palms) {
        palm.crown.rotation.z = Math.sin(elapsed * 1.1 + palm.phase) * 0.07;
        palm.crown.rotation.x = Math.cos(elapsed * 0.85 + palm.phase) * 0.05;
      }
      for (let i = 0; i < FISH_COUNT; i++) {
        const f = fishMeta[i];
        const a = elapsed * f.speed + f.phase;
        const x = f.cx + Math.cos(a) * f.rx;
        const z = f.cz + Math.sin(a) * f.rz;
        const dx = -Math.sin(a) * f.rx * f.speed;
        const dz = Math.cos(a) * f.rz * f.speed;
        dummy.position.set(x, f.y + Math.sin(elapsed * 2.2 + f.phase) * 0.05, z);
        dummy.rotation.set(0, Math.atan2(dx, dz), 0);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        fishMesh.setMatrixAt(i, dummy.matrix);
      }
      fishMesh.instanceMatrix.needsUpdate = true;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    });
  },
});
