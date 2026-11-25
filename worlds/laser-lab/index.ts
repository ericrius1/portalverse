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
  abs,
  fract,
  mix,
  clamp,
  smoothstep,
  pow,
  positionWorld,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';

/** Obsidian stage floor with crisp neon runway edge strips and subtle metric grid. */
function createStageGridMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const gridFn = Fn(() => {
    const wp = positionWorld;
    const cell = fract(vec2(wp.x, wp.z).mul(0.5)).sub(0.5).abs();
    const fine = smoothstep(float(0.46), float(0.495), cell.x).max(smoothstep(float(0.46), float(0.495), cell.y));

    const majorCell = fract(vec2(wp.x, wp.z).mul(0.125)).sub(0.5).abs();
    const major = smoothstep(float(0.485), float(0.5), majorCell.x).max(smoothstep(float(0.485), float(0.5), majorCell.y));

    const runwayEdge = float(1.0).sub(smoothstep(float(0.02), float(0.18), abs(abs(wp.x).sub(4.2))));
    const pulse = sin(wp.z.mul(0.28).sub(time.mul(3.2))).mul(0.35).add(0.65);

    const base = vec3(0.02, 0.015, 0.045);
    const fineCol = vec3(0.14, 0.08, 0.24).mul(fine.mul(0.55));
    const majorCol = vec3(0.45, 0.12, 0.42).mul(major.mul(0.75));
    const stripCol = vec3(1.0, 0.16, 0.52).mul(runwayEdge.mul(pulse).mul(1.35));
    const fade = float(1.0).sub(smoothstep(float(12.0), float(58.0), wp.xz.length()));

    return base.add(fineCol.add(majorCol).mul(fade)).add(stripCol);
  });
  material.colorNode = gridFn();
  return material;
}

/** Volumetric additive TSL laser beam with soft core falloff & traveling energy pulse. */
function createLaserBeamMaterial(hexColor: string, phaseOffset: number): THREE.MeshBasicNodeMaterial {
  const color = new THREE.Color(hexColor);
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;

  const beamFn = Fn(() => {
    const coord = uv();
    const core = pow(clamp(float(1.0).sub(abs(coord.x.sub(0.5)).mul(2.0)), 0.0, 1.0), 2.4);
    const lengthFade = smoothstep(float(0.0), float(0.06), coord.y).mul(
      float(1.0).sub(smoothstep(float(0.72), float(1.0), coord.y)),
    );
    const travel = sin(coord.y.mul(18.0).sub(time.mul(9.5)).add(float(phaseOffset))).mul(0.22).add(0.88);
    const rgb = vec3(color.r, color.g, color.b).mul(float(1.35).add(core.mul(1.4))).mul(travel);
    const alpha = core.mul(lengthFade).mul(0.82);
    return vec4(rgb, alpha);
  });

  const out = beamFn();
  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

/** Translucent pulsing TSL forcefield barrier wall with scrolling scanlines & edge glow. */
function createForcefieldMaterial(hexA: string, hexB: string): THREE.MeshBasicNodeMaterial {
  const cA = new THREE.Color(hexA);
  const cB = new THREE.Color(hexB);
  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.AdditiveBlending;
  material.side = THREE.DoubleSide;

  const fieldFn = Fn(() => {
    const coord = uv();
    const scan = sin(coord.y.mul(52.0).sub(time.mul(4.5))).mul(0.5).add(0.5);
    const diag = sin(coord.x.mul(36.0).add(coord.y.mul(22.0)).add(time.mul(2.2))).mul(0.5).add(0.5);
    const wave = sin(coord.x.mul(8.0).sub(time.mul(1.9))).mul(0.5).add(0.5);
    const edgeX = smoothstep(float(0.0), float(0.08), coord.x).mul(
      float(1.0).sub(smoothstep(float(0.92), float(1.0), coord.x)),
    );
    const edgeY = smoothstep(float(0.0), float(0.1), coord.y).mul(
      float(1.0).sub(smoothstep(float(0.86), float(1.0), coord.y)),
    );
    const border = float(1.0).sub(edgeX.mul(edgeY));
    const col = mix(vec3(cA.r, cA.g, cA.b), vec3(cB.r, cB.g, cB.b), wave);
    const alpha = clamp(scan.mul(0.12).add(diag.mul(0.09)).add(border.mul(0.55)), 0.0, 0.72);
    return vec4(col.mul(float(0.9).add(border.mul(1.3))), alpha);
  });

  const out = fieldFn();
  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

interface SweepingBeam {
  pivot: THREE.Group;
  baseRotX: number;
  baseRotZ: number;
  ampX: number;
  ampZ: number;
  speed: number;
  phase: number;
}

/**
 * LASER FORCEFIELD ARENA (`laser-lab`)
 * Inspired by JP's `laser` R3F app: a pitch-black architectural light-show hall
 * with overhead gantry laser boxes, sweeping volumetric TSL laser fans, pulsing
 * side forcefield barriers, and hovering refractive prism monoliths.
 */
export default defineRoom('laser-lab', {
  mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#04020a');
    ctx.scene.fog = new THREE.FogExp2('#070312', 0.008);

    const hemi = new THREE.HemisphereLight('#a855f7', '#090414', 0.65);
    const rimA = new THREE.DirectionalLight('#ff2a85', 1.15);
    rimA.position.set(18, 22, 10);
    const rimB = new THREE.DirectionalLight('#ffb703', 0.9);
    rimB.position.set(-18, 18, -14);
    root.add(hemi, rimA, rimB);

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

    // Level obsidian stage floor (Z in [-46, 46], Y = 0)
    const floor = new THREE.Mesh(
      trackGeo(new THREE.PlaneGeometry(90, 104)),
      trackMat(createStageGridMaterial()),
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    ctx.addPlatform({ minX: -45, maxX: 45, minZ: -46, maxZ: 46, topY: 0 });

    // Overhead dark steel truss gantries & matte-black LaserBox emitter housings
    const trussMat = trackMat(new THREE.MeshStandardMaterial({ color: '#14111f', roughness: 0.42, metalness: 0.78 }));
    const boxMat = trackMat(new THREE.MeshStandardMaterial({ color: '#0d0b14', roughness: 0.35, metalness: 0.85 }));
    const ledPinkMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ff2a85' }));
    const ledAmberMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ffb703' }));

    const pillarGeo = trackGeo(new THREE.BoxGeometry(0.55, 11.5, 0.55));
    const beamBarGeo = trackGeo(new THREE.BoxGeometry(24, 0.48, 0.55));
    const emitterGeo = trackGeo(new THREE.BoxGeometry(1.5, 0.65, 0.85));
    const ledGeo = trackGeo(new THREE.BoxGeometry(1.15, 0.1, 0.08));

    const laserPalette = ['#ff2a85', '#ffb703', '#a855f7', '#ff3b30'];
    const beamMats = laserPalette.map((hex, i) => trackMat(createLaserBeamMaterial(hex, i * 1.4)));
    const beamGeo = trackGeo(new THREE.PlaneGeometry(0.36, 26));
    beamGeo.translate(0, -13, 0); // Pivot at emitter origin pointing downward along -Y

    const beams: SweepingBeam[] = [];
    const gantryZs = [-24, -8, 8, 24];

    for (let gi = 0; gi < gantryZs.length; gi++) {
      const gz = gantryZs[gi];
      for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeo, trussMat);
        pillar.position.set(side * 11.8, 5.75, gz);
        root.add(pillar);
      }
      const crossBeam = new THREE.Mesh(beamBarGeo, trussMat);
      crossBeam.position.set(0, 11.2, gz);
      root.add(crossBeam);

      // 3 overhead LaserBoxes per gantry emitting sweeping fan beams
      const boxXs = [-7.8, 0, 7.8];
      for (let bi = 0; bi < boxXs.length; bi++) {
        const bx = boxXs[bi];
        const housing = new THREE.Mesh(emitterGeo, boxMat);
        housing.position.set(bx, 10.65, gz);
        root.add(housing);

        const led = new THREE.Mesh(ledGeo, (gi + bi) % 2 === 0 ? ledPinkMat : ledAmberMat);
        led.position.set(bx, 10.65, gz + 0.45);
        root.add(led);

        // Two crossed planes per laser beam so it reads volumetrically from every angle
        const raysPerBox = bx === 0 ? 2 : 2;
        for (let r = 0; r < raysPerBox; r++) {
          const pivot = new THREE.Group();
          pivot.position.set(bx + (r === 0 ? -0.3 : 0.3), 10.35, gz);
          const bMat = beamMats[(gi + bi + r) % beamMats.length];
          const p1 = new THREE.Mesh(beamGeo, bMat);
          const p2 = new THREE.Mesh(beamGeo, bMat);
          p2.rotation.y = Math.PI / 2;
          pivot.add(p1, p2);
          root.add(pivot);

          // Angle center gantry beams outward so the central walkway stays dramatic & clear
          const outBias = bx === 0 ? (r === 0 ? -0.52 : 0.52) : -Math.sign(bx) * 0.25;
          beams.push({
            pivot,
            baseRotX: (r === 0 ? 0.22 : -0.22),
            baseRotZ: outBias,
            ampX: 0.34,
            ampZ: bx === 0 ? 0.18 : 0.32,
            speed: 0.9 + ((gi + bi) % 3) * 0.28,
            phase: gi * 1.15 + bi * 0.8 + r * Math.PI,
          });
        }
      }
    }

    // Translucent pulsing TSL Forcefield Walls along both flanks (X = ±12.2)
    const fieldGeo = trackGeo(new THREE.PlaneGeometry(66, 7.6));
    const fieldMatLeft = trackMat(createForcefieldMaterial('#ff2a85', '#a855f7'));
    const fieldMatRight = trackMat(createForcefieldMaterial('#ffb703', '#ff2a85'));
    const leftField = new THREE.Mesh(fieldGeo, fieldMatLeft);
    leftField.position.set(-12.2, 3.85, 0);
    leftField.rotation.y = Math.PI / 2;
    const rightField = new THREE.Mesh(fieldGeo, fieldMatRight);
    rightField.position.set(12.2, 3.85, 0);
    rightField.rotation.y = -Math.PI / 2;
    root.add(leftField, rightField);

    // Floating refractive obsidian prism monoliths & orbiting target rings flanking the promenade
    const prismGeo = trackGeo(new THREE.OctahedronGeometry(1.15, 0));
    const prismMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#1b1030',
        emissive: '#a855f7',
        emissiveIntensity: 0.45,
        roughness: 0.14,
        metalness: 0.82,
      }),
    );
    const orbitGeo = trackGeo(new THREE.TorusGeometry(1.75, 0.04, 10, 40));
    const orbitMat = trackMat(new THREE.MeshBasicMaterial({ color: '#ffb703', transparent: true, opacity: 0.75 }));

    const prisms: Array<{ mesh: THREE.Mesh; ring: THREE.Mesh; baseY: number; phase: number }> = [];
    const prismZs = [-20, 0, 20];
    for (let i = 0; i < prismZs.length; i++) {
      for (const side of [-1, 1]) {
        const mesh = new THREE.Mesh(prismGeo, prismMat);
        const baseY = 3.2;
        mesh.position.set(side * 8.2, baseY, prismZs[i]);
        const ring = new THREE.Mesh(orbitGeo, orbitMat);
        ring.position.copy(mesh.position);
        root.add(mesh, ring);
        prisms.push({ mesh, ring, baseY, phase: i * 1.4 + (side > 0 ? 0.7 : 0) });
      }
    }

    ctx.onUpdate((_, elapsed) => {
      for (const b of beams) {
        b.pivot.rotation.x = b.baseRotX + Math.sin(elapsed * b.speed + b.phase) * b.ampX;
        b.pivot.rotation.z = b.baseRotZ + Math.cos(elapsed * b.speed * 0.82 + b.phase) * b.ampZ;
      }
      for (const p of prisms) {
        const y = p.baseY + Math.sin(elapsed * 1.5 + p.phase) * 0.35;
        p.mesh.position.y = y;
        p.mesh.rotation.y = elapsed * 0.65 + p.phase;
        p.mesh.rotation.x = Math.sin(elapsed * 0.8 + p.phase) * 0.25;
        p.ring.position.y = y;
        p.ring.rotation.x = Math.PI * 0.38 + Math.sin(elapsed * 0.9 + p.phase) * 0.4;
        p.ring.rotation.y = -elapsed * 0.9 + p.phase;
      }
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    });
  },
});
