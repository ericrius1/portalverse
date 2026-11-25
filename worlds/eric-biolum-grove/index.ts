import * as THREE from 'three/webgpu';
import {
  Fn,
  vec2,
  vec3,
  vec4,
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

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mossy stone forest floor with softly pulsing bioluminescent mycelial veins flanking the path. */
function createForestFloorMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const floorFn = Fn(() => {
    const wp = positionWorld;
    const p = vec2(wp.x, wp.z);

    // Subtle mossy stone variation
    const n1 = sin(p.x.mul(0.35).add(p.y.mul(0.28))).mul(cos(p.x.mul(-0.22).add(p.y.mul(0.41))));
    const n2 = sin(p.x.mul(1.15).sub(p.y.mul(0.85))).mul(0.5).add(0.5);

    const pathMask = float(1.0).sub(smoothstep(float(2.9), float(4.6), abs(wp.x)));
    const edgeRibbon = smoothstep(float(2.6), float(3.8), abs(wp.x)).mul(
      float(1.0).sub(smoothstep(float(4.1), float(6.2), abs(wp.x))),
    );

    // Flowing mycelial bioluminescent veins
    const veinWave = sin(p.y.mul(0.42).sub(time.mul(1.25)).add(sin(p.x.mul(0.9)).mul(1.4)));
    const veinSharp = pow(clamp(float(1.0).sub(abs(veinWave)), 0.0, 1.0), 6.0);
    const pulse = sin(p.y.mul(0.18).sub(time.mul(1.8))).mul(0.3).add(0.7);

    const mossBase = mix(vec3(0.03, 0.08, 0.07), vec3(0.05, 0.14, 0.11), n1.mul(0.5).add(0.5));
    const stonePath = mix(vec3(0.07, 0.1, 0.11), vec3(0.11, 0.15, 0.16), n2);
    const base = mix(mossBase, stonePath, pathMask);

    const glowCol = mix(vec3(0.12, 0.88, 0.62), vec3(0.16, 0.78, 0.96), n2);
    const fade = float(1.0).sub(smoothstep(float(20.0), float(64.0), wp.xz.length()));
    const veins = glowCol.mul(veinSharp.mul(edgeRibbon.mul(0.85).add(0.16)).mul(pulse).mul(fade));

    return base.add(veins);
  });
  material.colorNode = floorFn();
  return material;
}

/** Shimmering aurora borealis ribbon curtain arching across the night canopy. */
function createAuroraCurtainMaterial(phaseOffset: number): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;

  const auroraFn = Fn(() => {
    const coord = uv();
    const fold = sin(coord.x.mul(14.0).add(time.mul(0.55)).add(float(phaseOffset)))
      .add(sin(coord.x.mul(27.0).sub(time.mul(0.85)).add(float(phaseOffset * 1.7))).mul(0.45));
    const shimmer = pow(clamp(fold.mul(0.35).add(0.55), 0.0, 1.0), 2.2);

    const vertFade = smoothstep(float(0.0), float(0.24), coord.y).mul(
      float(1.0).sub(smoothstep(float(0.55), float(1.0), coord.y)),
    );
    const edgeFade = smoothstep(float(0.0), float(0.12), coord.x).mul(
      float(1.0).sub(smoothstep(float(0.88), float(1.0), coord.x)),
    );

    const emerald = vec3(0.12, 0.96, 0.65);
    const cyan = vec3(0.14, 0.82, 0.98);
    const violet = vec3(0.62, 0.36, 0.98);
    const grad = mix(mix(emerald, cyan, smoothstep(float(0.15), float(0.6), coord.y)), violet, smoothstep(float(0.55), float(0.95), coord.y));

    const alpha = shimmer.mul(vertFade).mul(edgeFade).mul(0.52);
    return vec4(grad.mul(1.25), alpha);
  });

  const out = auroraFn();
  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

interface GlowingMushroom {
  group: THREE.Group;
  capMat: THREE.MeshStandardMaterial;
  x: number;
  z: number;
  baseScale: number;
  baseEmissive: number;
  phase: number;
}

interface SporeData {
  baseX: number;
  baseY: number;
  baseZ: number;
  radius: number;
  speed: number;
  phase: number;
  scale: number;
}

/**
 * BIOLUMINESCENT REDWOOD GROVE (`eric-biolum-grove`)
 * A nocturnal Pacific Northwest redwood cathedral under shimmering emerald-violet
 * aurora curtains, with glowing mushroom clusters that brighten as you pass
 * and drifting firefly spores along a mossy stone promenade.
 */
export default defineRoom('eric-biolum-grove', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#040d14');
    ctx.scene.fog = new THREE.FogExp2('#05141c', 0.0115);

    const hemi = new THREE.HemisphereLight('#5eead4', '#06201c', 1.15);
    const moon = new THREE.DirectionalLight('#99f6e4', 1.35);
    moon.position.set(-18, 34, -22);
    const warmBounce = new THREE.DirectionalLight('#a78bfa', 0.55);
    warmBounce.position.set(22, 16, 18);
    root.add(hemi, moon, warmBounce);

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

    const rand = mulberry32(4219);

    // Level forest floor & central promenade collider (Y = 0, Z in [-46, 46])
    const floor = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(140, 140)),
      trackMat(createForestFloorMaterial()),
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    ctx.addPlatform({ minX: -48, maxX: 48, minZ: -46, maxZ: 46, topY: 0 });

    // Subtle stone curb borders flanking the central trail (outside |X| = 4.2)
    const stoneMat = trackMat(new THREE.MeshStandardMaterial({ color: '#1b2b2c', roughness: 0.88, metalness: 0.06 }));
    const curbGeo = trackGeo(new THREE.BoxGeometry(0.45, 0.16, 1.8));
    const curbCount = 72;
    const curbs = new THREE.InstancedMesh(curbGeo, stoneMat, curbCount);
    const dummy = new THREE.Object3D();
    let curbIdx = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 36; i++) {
        const z = -34 + i * 1.95;
        dummy.position.set(side * (4.15 + (rand() - 0.5) * 0.18), 0.06, z);
        dummy.rotation.set(0, (rand() - 0.5) * 0.12, 0);
        dummy.scale.set(1, 0.8 + rand() * 0.4, 0.85 + rand() * 0.3);
        dummy.updateMatrix();
        curbs.setMatrixAt(curbIdx++, dummy.matrix);
      }
    }
    curbs.instanceMatrix.needsUpdate = true;
    root.add(curbs);

    // Towering redwood trunks flanking the corridor (|X| >= 7.5 so the center stays completely open)
    const barkMat = trackMat(new THREE.MeshStandardMaterial({ color: '#2b1914', roughness: 0.94 }));
    const foliageMat = trackMat(new THREE.MeshStandardMaterial({ color: '#0c3b2e', roughness: 0.82 }));
    const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.75, 1.38, 34, 10));
    const canopyGeo = trackGeo(new THREE.ConeGeometry(5.6, 11, 8));

    const treePositions: Array<[number, number, number]> = [];
    for (const side of [-1, 1]) {
      for (let z = -38; z <= 38; z += 9.5) {
        treePositions.push([side * (8.2 + rand() * 3.8), z + (rand() - 0.5) * 2.5, 0.92 + rand() * 0.45]);
        treePositions.push([side * (16.5 + rand() * 14.0), z + (rand() - 0.5) * 4.5, 0.85 + rand() * 0.6]);
      }
    }
    const trunks = new THREE.InstancedMesh(trunkGeo, barkMat, treePositions.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, foliageMat, treePositions.length * 2);
    for (let i = 0; i < treePositions.length; i++) {
      const [tx, tz, scale] = treePositions[i];
      dummy.position.set(tx, 16.5 * scale, tz);
      dummy.rotation.set((rand() - 0.5) * 0.04, rand() * Math.PI * 2, (rand() - 0.5) * 0.04);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);

      // Two high canopy tiers well above player headroom
      for (let tier = 0; tier < 2; tier++) {
        const y = (16 + tier * 6.5) * scale;
        const cs = scale * (1.25 - tier * 0.25);
        dummy.position.set(tx, y, tz);
        dummy.rotation.set(0, rand() * Math.PI * 2, 0);
        dummy.scale.set(cs, cs, cs);
        dummy.updateMatrix();
        canopies.setMatrixAt(i * 2 + tier, dummy.matrix);
      }
    }
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    root.add(trunks, canopies);

    // Interactive bioluminescent mushroom clusters lining both sides of the promenade
    const stemGeo = trackGeo(new THREE.CylinderGeometry(0.11, 0.19, 1.0, 8));
    const capGeo = trackGeo(new THREE.SphereGeometry(0.68, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.58));
    const stemMat = trackMat(new THREE.MeshStandardMaterial({ color: '#c7f9ea', roughness: 0.55 }));
    const mushroomPalette = ['#34d399', '#22d3ee', '#a78bfa', '#2dd4bf'];
    const mushrooms: GlowingMushroom[] = [];

    for (const side of [-1, 1]) {
      for (let z = -30; z <= 30; z += 6.0) {
        const mx = side * (5.2 + rand() * 2.4);
        const mz = z + (rand() - 0.5) * 1.8;
        const hex = mushroomPalette[Math.floor(rand() * mushroomPalette.length)];
        const baseScale = 0.72 + rand() * 0.85;
        const baseEmissive = 0.85 + rand() * 0.35;

        const capMat = trackMat(
          new THREE.MeshStandardMaterial({
            color: hex,
            emissive: hex,
            emissiveIntensity: baseEmissive,
            roughness: 0.28,
            metalness: 0.08,
          }),
        );

        const cluster = new THREE.Group();
        cluster.position.set(mx, 0, mz);
        cluster.scale.setScalar(baseScale);

        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = 0.5;
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 0.92;
        cap.scale.set(1.15, 0.72, 1.15);
        cluster.add(stem, cap);

        // Smaller companion sprout next to the main mushroom
        const babyStem = new THREE.Mesh(stemGeo, stemMat);
        babyStem.position.set(0.42 * -side, 0.26, 0.28);
        babyStem.scale.setScalar(0.52);
        const babyCap = new THREE.Mesh(capGeo, capMat);
        babyCap.position.set(0.42 * -side, 0.48, 0.28);
        babyCap.scale.set(0.58, 0.38, 0.58);
        cluster.add(babyStem, babyCap);

        root.add(cluster);
        mushrooms.push({
          group: cluster,
          capMat,
          x: mx,
          z: mz,
          baseScale,
          baseEmissive,
          phase: rand() * Math.PI * 2,
        });
      }
    }

    // Overhead aurora borealis ribbons framing the sky along the promenade
    const auroraGeo = trackGeo(new THREE.PlaneGeometry(76, 18, 28, 1));
    const auroraPos = auroraGeo.attributes.position;
    for (let i = 0; i < auroraPos.count; i++) {
      const x = auroraPos.getX(i);
      const waveZ = Math.sin(x * 0.11) * 6.5;
      auroraPos.setZ(i, waveZ);
    }
    auroraGeo.computeVertexNormals();

    const auroraConfigs: Array<[number, number, number, number, number]> = [
      [0, 26, -24, 0.18, 0.0],
      [-10, 29, 4, -0.22, 2.1],
      [12, 27, 22, 0.32, 4.3],
    ];
    for (const [ax, ay, az, rotY, phase] of auroraConfigs) {
      const ribbon = new THREE.Mesh(auroraGeo, trackMat(createAuroraCurtainMaterial(phase)));
      ribbon.position.set(ax, ay, az);
      ribbon.rotation.y = rotY;
      root.add(ribbon);
    }

    // Starry sky dots high overhead
    const starGeo = trackGeo(new THREE.OctahedronGeometry(0.18, 0));
    const starMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ccfbf1' }));
    const starCount = 120;
    const stars = new THREE.InstancedMesh(starGeo, starMat, starCount);
    for (let i = 0; i < starCount; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = 0.2 + rand() * 0.95;
      const r = 82 + rand() * 25;
      dummy.position.set(Math.cos(theta) * Math.sin(phi) * r, Math.cos(phi) * r + 12, Math.sin(theta) * Math.sin(phi) * r);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0.6 + rand() * 1.1);
      dummy.updateMatrix();
      stars.setMatrixAt(i, dummy.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
    root.add(stars);

    // Drifting bioluminescent firefly spores
    const sporeCount = 110;
    const sporeGeo = trackGeo(new THREE.SphereGeometry(0.085, 6, 6));
    const sporeMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: '#6ee7b7',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const spores = new THREE.InstancedMesh(sporeGeo, sporeMat, sporeCount);
    const sporeData: SporeData[] = [];
    for (let i = 0; i < sporeCount; i++) {
      const side = rand() < 0.5 ? -1 : 1;
      sporeData.push({
        baseX: side * (1.8 + rand() * 11.5),
        baseY: 0.7 + rand() * 7.5,
        baseZ: -38 + rand() * 76,
        radius: 0.45 + rand() * 1.1,
        speed: 0.45 + rand() * 0.9,
        phase: rand() * Math.PI * 2,
        scale: 0.55 + rand() * 0.95,
      });
    }
    root.add(spores);

    ctx.onUpdate((_, elapsed) => {
      const playerPos = ctx.player?.position;

      // Mushrooms breathe softly and glow brighter as the player walks nearby
      for (const m of mushrooms) {
        let boost = 0;
        if (playerPos) {
          const dist = Math.hypot(playerPos.x - m.x, playerPos.z - m.z);
          boost = Math.max(0, 1 - dist / 9.5);
        }
        const breath = Math.sin(elapsed * 1.8 + m.phase) * 0.04;
        m.group.scale.setScalar(m.baseScale * (1 + breath + boost * 0.14));
        m.capMat.emissiveIntensity = m.baseEmissive + Math.sin(elapsed * 2.2 + m.phase) * 0.18 + boost * 1.35;
      }

      // Animate firefly spores swirling through the grove
      for (let i = 0; i < sporeCount; i++) {
        const s = sporeData[i];
        const t = elapsed * s.speed + s.phase;
        dummy.position.set(
          s.baseX + Math.sin(t) * s.radius,
          s.baseY + Math.sin(t * 1.35 + 1.1) * 0.55,
          s.baseZ + Math.cos(t * 0.8) * s.radius,
        );
        const twinkle = 0.65 + 0.35 * Math.sin(elapsed * 3.1 + s.phase);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(s.scale * twinkle);
        dummy.updateMatrix();
        spores.setMatrixAt(i, dummy.matrix);
      }
      spores.instanceMatrix.needsUpdate = true;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    });
  },
});
