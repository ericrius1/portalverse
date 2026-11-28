import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, mix, positionLocal, positionView, positionWorld, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { bankHeight, FIELD_HALF_LENGTH, hedgeCollider, pathCenter, pathWidth } from './layout';

// Quantized directly from JP's supplied painting. See CREDITS.md for regions.
const PALETTE = ['#0b8442', '#196b38', '#175e34', '#1f702e', '#2b5a28', '#6a7911', '#0d4130'];
const BLUE = '#0e273d';
const SHADOW = '#0e1818';
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);

/** Seven tapering, bent blades share one growth point, like the painted sprays. */
function makeSpray(): THREE.BufferGeometry {
  const positions: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  for (let leaf = 0; leaf < 7; leaf++) {
    const angle = -2.05 + leaf * 0.68;
    const length = 0.78 + 0.28 * Math.sin(leaf * 2.7 + 0.6) ** 2;
    const start = positions.length / 3;
    for (let step = 0; step <= 5; step++) {
      const t = step / 5;
      const width = Math.sin(Math.PI * t) ** 0.85 * 0.115;
      const bend = Math.sin(t * Math.PI) * 0.15;
      for (let edge = -1; edge <= 1; edge++) {
        const u = edge * width + bend;
        const v = t * length;
        positions.push(
          Math.sin(angle) * v + Math.cos(angle) * u,
          Math.cos(angle) * v - Math.sin(angle) * u - t * t * 0.48,
          Math.sin(t * Math.PI) * 0.14 - t * t * 0.12 + (edge === 0 ? 0.035 : 0),
        );
        shades.push((edge === -1 ? 0.72 : edge === 0 ? 1.12 : 0.93) * (0.85 + 0.15 * Math.sin(t * Math.PI)));
      }
    }
    for (let step = 0; step < 5; step++) {
      for (let edge = 0; edge < 2; edge++) {
        const a = start + step * 3 + edge;
        indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('leafShade', new THREE.Float32BufferAttribute(shades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export default defineRoom('jp-jungle-path', {
  async mount(ctx) {
    const root = new THREE.Group();
    root.name = 'Jungle Path';
    ctx.scene.add(root);
    const oldBackground = ctx.scene.background;
    const oldFog = ctx.scene.fog;
    ctx.scene.background = new THREE.Color('#101f2a');
    ctx.scene.fog = new THREE.Fog('#10263c', 30, 110);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const instances: THREE.InstancedMesh[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.add(g); return g; };
    const material = <T extends THREE.Material>(m: T): T => { materials.add(m); return m; };
    ctx.onDispose(() => {
      root.removeFromParent();
      instances.forEach(mesh => mesh.dispose());
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      ctx.scene.background = oldBackground;
      ctx.scene.fog = oldFog;
    });
    ctx.setTerrainHeight(bankHeight);
    ctx.setCollider(hedgeCollider);
    ctx.setWalkBounds({ minX: -38, maxX: 38, minZ: -43, maxZ: 43 });

    const clock = uniform(0);
    ctx.onUpdate((_dt, elapsed) => { clock.value = elapsed; });
    const rand = seededRandom(625885966);
    const temp = new THREE.Object3D();
    const tint = new THREE.Color();
    const blue = new THREE.Color(BLUE);
    const baseSpray = geometry(makeSpray());
    const leafMat = material(new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false }));
    // Restrained broad brush mottling, without raster assets or alpha overdraw.
    const brush = sin(positionLocal.y.mul(57).add(sin(positionLocal.x.mul(31)).mul(2))).mul(0.055).add(0.945);
    const base = attribute('sprayColor', 'vec3').mul(attribute('leafShade', 'float')).mul(brush);
    const distanceBlue = smoothstep(6, 44, positionView.length()).mul(0.95);
    leafMat.colorNode = mix(base, color(BLUE).mul(attribute('leafShade', 'float').mul(0.8).add(0.35)), distanceBlue);
    const breeze = sin(clock.mul(0.65).add(positionWorld.z.mul(0.22)).add(positionWorld.x.mul(0.17)));
    leafMat.positionNode = positionLocal.add(vec3(
      breeze.mul(positionLocal.y.abs()).mul(0.045),
      sin(clock.mul(0.8).add(positionWorld.z.mul(0.3))).mul(positionLocal.y.abs()).mul(0.018),
      float(0),
    ));
    const heartMat = material(new THREE.MeshBasicNodeMaterial({ color: SHADOW, toneMapped: false }));
    heartMat.colorNode = mix(color(SHADOW), color('#0c2530'), smoothstep(8, 65, positionView.length()));
    const heartGeo = geometry(new THREE.SphereGeometry(1, 14, 10));
    // Break the smooth sphere silhouette into rounded, unequal lobes.
    const hp = heartGeo.getAttribute('position');
    for (let i = 0; i < hp.count; i++) {
      const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
      const r = 1 + 0.055 * Math.sin(x * 8 + y * 3) * Math.cos(z * 7 - y * 5);
      hp.setXYZ(i, x * r, y * r, z * r);
    }
    heartGeo.computeBoundingSphere();
    await ctx.breathe();

    // Staggered low shrubs, middle thickets, and towering rear crowns.
    // Each row is one instanced draw; opaque hearts prevent see-through bushes.
    for (const side of [-1, 1]) {
      for (let tier = 0; tier < 3; tier++) {
        const bushCount = 23;
        const spraysPerBush = [112, 145, 165][tier];
        const sprayGeo = geometry(baseSpray.clone());
        const count = bushCount * spraysPerBush;
        const colors = new Float32Array(count * 3);
        sprayGeo.setAttribute('sprayColor', new THREE.InstancedBufferAttribute(colors, 3));
        const leaves = new THREE.InstancedMesh(sprayGeo, leafMat, count);
        const hearts = new THREE.InstancedMesh(heartGeo, heartMat, bushCount);
        leaves.name = `Leaf sprays ${side < 0 ? 'west' : 'east'} tier ${tier}`;
        hearts.name = 'Dense shrub interiors';
        instances.push(leaves, hearts);
        root.add(hearts, leaves);
        for (let bush = 0; bush < bushCount; bush++) {
          const z = -FIELD_HALF_LENGTH + bush * 4 + (tier % 2) * 1.6 + (rand() - 0.5) * 1.1;
          const rx = [2.15, 3.4, 4.8][tier] * (0.85 + rand() * 0.3);
          const ry = [2.5, 4.5, 6.6][tier] * (0.73 + rand() * 0.5);
          const rz = 2.9 + rand() * 0.9;
          let x = pathCenter(z) + side * (pathWidth(z) + [2.65, 6.2, 12.1][tier]);
          // The entire dark core stays outside the trail, including at tight bends.
          for (let dz = -rz * 1.06; dz <= rz * 1.06; dz += 0.2) {
            const edge = side * pathCenter(z + dz) + pathWidth(z + dz) + 0.3 + rx * 1.06;
            x = side * Math.max(side * x, edge);
          }
          const y = ry * 0.72 + [0, 0.4, 1.3][tier];
          temp.position.set(x, y, z);
          temp.quaternion.identity();
          temp.scale.set(rx * 0.96, ry * 0.96, rz * 0.96);
          temp.updateMatrix();
          hearts.setMatrixAt(bush, temp.matrix);
          const normal = new THREE.Vector3();
          for (let spray = 0; spray < spraysPerBush; spray++) {
            // Golden-angle distribution avoids visibly regular rows of leaves.
            const ny = 1 - 2 * (spray + 0.5) / spraysPerBush;
            const azimuth = spray * 2.399963 + bush * 1.71;
            const ring = Math.sqrt(1 - ny * ny);
            const nx = Math.cos(azimuth) * ring;
            const nz = Math.sin(azimuth) * ring;
            const shell = 1.015 + rand() * 0.07;
            temp.position.set(x + nx * rx * shell, Math.max(0.15, y + ny * ry * shell), z + nz * rz * shell);
            // Preserve the complete curving corridor even where bushes overlap bends.
            const boundary = pathWidth(temp.position.z) + 0.75;
            if (side * (temp.position.x - pathCenter(temp.position.z)) < boundary) {
              temp.position.x = pathCenter(temp.position.z) + side * boundary;
            }
            normal.set(nx / rx, ny / ry, nz / rz).normalize();
            temp.quaternion.setFromUnitVectors(FRONT, normal);
            temp.rotateZ((rand() - 0.5) * 1.6);
            const size = (0.72 + rand() * 0.5) * [1, 1.15, 1.4][tier];
            temp.scale.setScalar(size);
            temp.updateMatrix();
            const id = bush * spraysPerBush + spray;
            leaves.setMatrixAt(id, temp.matrix);
            // Most growth is emerald, with sparse olive crowns and cool inner ranks.
            const pick = ny > 0.32 && rand() > 0.58 ? 5 : Math.floor(rand() * 5);
            tint.set(PALETTE[pick]).lerp(blue, tier * 0.19 + (ny < -0.3 ? 0.1 : 0));
            tint.multiplyScalar(0.8 + rand() * 0.35);
            tint.toArray(colors, id * 3);
            if (spray % 32 === 0) await ctx.breathe();
          }
          await ctx.breathe();
        }
        leaves.computeBoundingSphere();
        // Shader wind moves tips by < 0.1 m beyond their CPU bounds.
        if (leaves.boundingSphere) leaves.boundingSphere.radius += 0.15;
        hearts.computeBoundingSphere();
        await ctx.breathe();
      }
    }

    // Continuous earthen ground. World-space path edges wander and feather into moss.
    const groundGeo = geometry(new THREE.PlaneGeometry(90, 96, 150, 160));
    groundGeo.rotateX(-Math.PI / 2);
    const gp = groundGeo.getAttribute('position');
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      gp.setY(i, bankHeight(x, z) - 0.015);
      if (i % 256 === 0) await ctx.breathe();
    }
    const groundMat = material(new THREE.MeshBasicNodeMaterial({ toneMapped: false }));
    const grain = fract(sin(positionWorld.x.mul(127.1).add(positionWorld.z.mul(311.7))).mul(43758.5453));
    const patches = sin(positionWorld.x.mul(1.2).add(sin(positionWorld.z.mul(0.9)))).mul(sin(positionWorld.z.mul(1.9)));
    // Same analytic centreline as collision; per-pixel edges avoid a visible grid.
    const pathT = positionWorld.z.add(33).div(66).clamp(0, 1);
    const center = sin(pathT.mul(Math.PI * 3)).mul(sin(pathT.mul(Math.PI)).pow(2)).mul(6.7);
    const width = sin(positionWorld.z.mul(0.23)).pow(2).mul(0.22).add(2.45);
    const roughEdge = sin(positionWorld.z.mul(3.1).add(positionWorld.x.mul(4.2))).mul(0.08)
      .add(sin(positionWorld.z.mul(8)).mul(0.045));
    const verge = smoothstep(width.sub(0.36), width.add(0.55), positionWorld.x.sub(center).abs().add(roughEdge));
    groundMat.colorNode = mix(color('#806849'), color('#183025'), verge)
      .mul(grain.mul(0.12).add(0.88)).mul(patches.mul(0.07).add(0.93));
    root.add(new THREE.Mesh(groundGeo, groundMat));
    await ctx.breathe();

    // Small dry leaf litter lives at the margins, leaving the walking line readable.
    const fallenLeaf = new THREE.Shape();
    fallenLeaf.moveTo(0, -0.2);
    fallenLeaf.quadraticCurveTo(-0.12, 0.04, 0.035, 0.23);
    fallenLeaf.quadraticCurveTo(0.12, 0.01, 0, -0.2);
    const litterGeo = geometry(new THREE.ShapeGeometry(fallenLeaf, 4));
    const litterMat = material(new THREE.MeshBasicNodeMaterial({ color: '#746532', side: THREE.DoubleSide, toneMapped: false }));
    const litter = new THREE.InstancedMesh(litterGeo, litterMat, 850);
    instances.push(litter);
    root.add(litter);
    for (let i = 0; i < litter.count; i++) {
      const z = (rand() - 0.5) * 84;
      const side = rand() < 0.5 ? -1 : 1;
      const x = pathCenter(z) + side * (pathWidth(z) * (0.73 + rand() * 0.29));
      temp.position.set(x, bankHeight(x, z) + 0.006, z);
      temp.quaternion.setFromAxisAngle(UP, rand() * Math.PI * 2);
      temp.rotateX(-Math.PI / 2);
      temp.scale.set(0.6 + rand(), 0.5 + rand(), 1);
      temp.updateMatrix();
      litter.setMatrixAt(i, temp.matrix);
      tint.set(['#887044', '#4e5129', '#a08a57'][i % 3]);
      litter.setColorAt(i, tint);
      if (i % 64 === 0) await ctx.breathe();
    }
    litter.computeBoundingSphere();
  },
});
