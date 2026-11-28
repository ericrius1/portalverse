import * as THREE from 'three/webgpu';
import { attribute, color, float, fract, mix, positionLocal, positionView, positionWorld, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { bankHeight, FIELD_HALF_LENGTH, createHedgeCollider, pathCenter, pathWidth } from './layout';
import { getJungleSettings, jungleOriginal, layerDepth, layerHeightOffset, layerLeafSize, layerDensity, leafDepthAmplitude, leafDepthSample, sameFoliageShape, observeJungleSettings, type JungleSettings } from './tuning';
import { mountJungleControls } from './controls';
import { mountJungleEyes } from './eyes';

// Quantized directly from JP's supplied painting. See CREDITS.md for regions.
const PALETTE = ['#0b8442', '#196b38', '#175e34', '#1f702e', '#2b5a28', '#6a7911', '#0d4130'];
const BLUE = '#0e273d';
const UP = new THREE.Vector3(0, 1, 0);
const FRONT = new THREE.Vector3(0, 0, 1);

/** One smooth-edged, hanging blade. No radial fingers or shared rosette centre. */
function makeLeaf(): THREE.BufferGeometry {
  const positions: number[] = [];
  const shades: number[] = [];
  const indices: number[] = [];
  for (let step = 0; step <= 10; step++) {
    const t = step / 10;
    const width = Math.sin(Math.PI * t) ** 0.8 * 0.23;
    const curve = Math.sin(t * Math.PI) * 0.18 + t * t * 0.12;
    for (let edge = -1; edge <= 1; edge++) {
      positions.push(curve + edge * width, -t * 1.45,
        Math.sin(t * Math.PI) * 0.025 + (edge === 0 ? 0.012 : 0));
      shades.push((edge === -1 ? 0.88 : edge === 0 ? 1.06 : 0.98) * (0.92 + 0.08 * Math.sin(t * Math.PI)));
    }
  }
  for (let step = 0; step < 10; step++) {
    for (let edge = 0; edge < 2; edge++) {
      const a = step * 3 + edge;
      indices.push(a, a + 3, a + 1, a + 1, a + 3, a + 4);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('leafShade', new THREE.Float32BufferAttribute(shades, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Scalloped crowns read as banks of vegetation; each perforated skin is open. */
function crown(z: number, layer: number, side: number): number {
  return 3.6 + layer * 1.34 + Math.sin(z * 0.37 + side * 1.4 + layer * 0.45) * 0.72
    + Math.sin(z * 0.17 - layer * 0.65) * 0.75;
}

/** Capture the approved random stream at each skin, so taller outer screens
 * cannot reshuffle the foreground or the opposite hedge. Pure data, shared by mounts. */
const layoutSeeds = (() => {
  let state = 625885966;
  const random = seededRandom(state);
  const next = () => { state = (state + 0x6d2b79f5) >>> 0; return random(); };
  const skins = new Map<string, number>();
  for (const side of [-1, 1]) {
    for (let layer = 0; layer < 7; layer++) {
      skins.set(`${side}:${layer}`, state);
      let count = 0;
      for (let column = 0; column < Math.ceil(FIELD_HALF_LENGTH * 2 / 0.66); column++) {
        const z = -FIELD_HALF_LENGTH + column * 0.66 + (layer * 0.618 % 1) * 0.66;
        for (let row = 0; row * 0.82 < crown(z, layer, side); row++) count++;
      }
      for (let i = 0; i < count * 2; i++) next();
      for (let i = 0; i < count; i++) {
        for (let transform = 0; transform < 4; transform++) next();
        if (!(next() < 0.18 && layer < 3)) next();
        next();
      }
    }
  }
  return { skins, litter: state };
})();

function skinX(z: number, y: number, layer: number, side: number): number {
  const depth = layerDepth(layer, jungleOriginal);
  const bow = Math.sin(z * 0.29 + layer * 0.74) * 0.32 + Math.sin(y * 0.65 + z * 0.13) * 0.14;
  return pathCenter(z) + side * (pathWidth(z) + depth + bow);
}

interface FoliageBank {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  settings: JungleSettings;
  dispose(): void;
}

function applySpacing(bank: FoliageBank, settings: JungleSettings): void {
  for (const mesh of bank.meshes) {
    mesh.position.x = mesh.userData.side * (layerDepth(mesh.userData.layer, settings) - layerDepth(mesh.userData.layer, jungleOriginal));
  }
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
    let foliage: FoliageBank | null = null;
    let disposed = false;
    let revision = 0;
    let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => { geometries.add(g); return g; };
    const material = <T extends THREE.Material>(m: T): T => { materials.add(m); return m; };
    ctx.onDispose(() => {
      disposed = true;
      revision++;
      clearTimeout(rebuildTimer);
      unsubscribe();
      foliage?.dispose();
      root.removeFromParent();
      instances.forEach(mesh => mesh.dispose());
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      ctx.scene.background = oldBackground;
      ctx.scene.fog = oldFog;
    });
    ctx.setTerrainHeight(bankHeight);
    let currentSettings = getJungleSettings();
    ctx.setCollider(createHedgeCollider(() => Math.max(0, currentSettings.pathDistance - jungleOriginal.pathDistance)));
    ctx.setWalkBounds({ minX: -38, maxX: 38, minZ: -43, maxZ: 43 });

    const clock = uniform(0);
    ctx.onUpdate((_dt, elapsed) => { clock.value = elapsed; });
    const rand = seededRandom(layoutSeeds.litter);
    const temp = new THREE.Object3D();
    const tint = new THREE.Color();
    const blue = new THREE.Color(BLUE);
    const baseLeaf = geometry(makeLeaf());
    const leafMat = material(new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, toneMapped: false }));
    // Restrained broad brush mottling, without raster assets or alpha overdraw.
    const brush = sin(positionLocal.y.mul(57).add(sin(positionLocal.x.mul(31)).mul(2))).mul(0.025).add(0.975);
    const base = attribute('leafColor', 'vec3').mul(attribute('leafShade', 'float')).mul(brush);
    const distanceBlue = smoothstep(6, 44, positionView.length()).mul(0.95);
    leafMat.colorNode = mix(base, color(BLUE).mul(attribute('leafShade', 'float').mul(0.8).add(0.35)), distanceBlue);
    const breeze = sin(clock.mul(0.65).add(positionWorld.z.mul(0.22)).add(positionWorld.x.mul(0.17)));
    leafMat.positionNode = positionLocal.add(vec3(
      breeze.mul(positionLocal.y.abs()).mul(0.045),
      sin(clock.mul(0.8).add(positionWorld.z.mul(0.3))).mul(positionLocal.y.abs()).mul(0.018),
      float(0),
    ));
    await ctx.breathe();

    // Spacing edits move the existing skins immediately. Height and density build
    // a replacement in small slices, keeping the old bank visible until it is ready.
    async function buildFoliage(
      settings: JungleSettings,
      isCurrent: () => boolean,
    ): Promise<FoliageBank | null> {
      const bank: FoliageBank = {
        group: new THREE.Group(), meshes: [], settings: { ...settings },
        dispose() {
          this.group.removeFromParent();
          for (const mesh of this.meshes) { mesh.dispose(); mesh.geometry.dispose(); }
        },
      };
      bank.group.name = 'Layered foliage';
      let complete = false;
      try {
        for (const side of [-1, 1]) {
          for (let layer = 0; layer < 7; layer++) {
            const random = seededRandom(layoutSeeds.skins.get(`${side}:${layer}`)!);
            const placements: Array<{ z: number; y: number }> = [];
            const density = layerDensity(layer, settings);
            const stepZ = 0.66 / Math.sqrt(density);
            const stepY = 0.82 / Math.sqrt(density);
            for (let column = 0; column < Math.ceil(FIELD_HALF_LENGTH * 2 / stepZ); column++) {
              const z0 = -FIELD_HALF_LENGTH + column * stepZ + (layer * 0.618 % 1) * stepZ;
              const top = crown(z0, layer, side) + layerHeightOffset(layer, settings);
              for (let row = 0; row * stepY < top; row++) {
                const z = z0 + (random() - 0.5) * stepZ * 0.85 + (row % 2) * 0.19;
                const y = row * stepY + 0.85 + (layer * 0.381 % 1) * stepY + (random() - 0.5) * 0.38;
                placements.push({ z, y });
              }
              if (column % 8 === 0) {
                await ctx.breathe();
                if (!isCurrent()) return null;
              }
            }
            const leafGeo = baseLeaf.clone();
            const colors = new Float32Array(placements.length * 3);
            leafGeo.setAttribute('leafColor', new THREE.InstancedBufferAttribute(colors, 3));
            const leaves = new THREE.InstancedMesh(leafGeo, leafMat, placements.length);
            leaves.name = `Foliage skin ${side < 0 ? 'west' : 'east'} ${layer + 1}`;
            leaves.userData.layer = layer;
            leaves.userData.side = side;
            bank.meshes.push(leaves);
            bank.group.add(leaves);
            const normal = new THREE.Vector3();
            for (let i = 0; i < placements.length; i++) {
              const { z, y } = placements[i];
              const x = skinX(z, y, layer, side);
              temp.position.set(x, y, z);
              const slope = (skinX(z + 0.02, y, layer, side) - skinX(z - 0.02, y, layer, side)) / 0.04;
              normal.set(-side, 0, side * slope).normalize();
              const depthSample = leafDepthSample(i, layer, side);
              temp.position.addScaledVector(normal, depthSample * leafDepthAmplitude(layer, settings) / Math.hypot(1, slope));
              // Keep inward-displaced anchors clear of the trail at every bend.
              // Spacing is applied as a mesh translation after building the bank.
              if (layer === 0 && settings.leafDepthVariation > 0) {
                const translation = side * (layerDepth(layer, settings) - layerDepth(layer, jungleOriginal));
                const worldX = temp.position.x + translation;
                const edge = pathCenter(temp.position.z) + side * (pathWidth(temp.position.z) + 0.25);
                if (side * (worldX - edge) < 0) temp.position.x = edge - translation;
              }
              temp.quaternion.setFromUnitVectors(FRONT, normal);
              // Flowing, alternating hangs, with small irregularity rather than a fan.
              temp.rotateZ(Math.sin(z * 0.75 + y * 1.4 + layer) * 0.65 + (random() - 0.5) * 0.8);
              temp.rotateY((random() - 0.5) * 0.18 + depthSample * settings.leafDepthVariation * 0.35);
              temp.scale.set(0.8 + random() * 0.45, 0.78 + random() * 0.42, 1);
              temp.scale.multiplyScalar(layerLeafSize(layer, settings));
              temp.updateMatrix();
              leaves.setMatrixAt(i, temp.matrix);
              const pick = random() < 0.18 && layer < 3 ? 5 : Math.floor(random() * 5);
              tint.set(PALETTE[pick]).lerp(blue, Math.pow(layer / 6, 0.85) * 0.92);
              tint.multiplyScalar(0.86 + random() * 0.22);
              tint.toArray(colors, i * 3);
              if (i % 32 === 0) {
                await ctx.breathe();
                if (!isCurrent()) return null;
              }
            }
            leaves.computeBoundingSphere();
            if (leaves.boundingSphere) leaves.boundingSphere.radius += 0.15;
            await ctx.breathe();
          }
        }

        if (!isCurrent()) return null;
        applySpacing(bank, settings);
        complete = true;
        return bank;
      } finally {
        // Superseded slider drags and disposal during a yield leave no GPU resources.
        if (!complete) bank.dispose();
      }
    }
    foliage = await buildFoliage(getJungleSettings(), () => !disposed);
    if (!foliage) return;
    root.add(foliage.group);

    // Continuous earthen ground. World-space path edges wander and feather into moss.
    const groundGeo = geometry(new THREE.PlaneGeometry(200, 96, 334, 160));
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
    unsubscribe = observeJungleSettings(settings => {
      if (disposed || !foliage) return;
      currentSettings = settings;
      applySpacing(foliage, settings);
      const request = ++revision;
      clearTimeout(rebuildTimer);
      const sameDepthLayout = settings.leafDepthVariation === 0 || (
        settings.pathDistance === foliage.settings.pathDistance && settings.layerGap === foliage.settings.layerGap
        && settings.gapMultiplier === foliage.settings.gapMultiplier && settings.gapCurve === foliage.settings.gapCurve
      );
      if (sameFoliageShape(settings, foliage.settings) && sameDepthLayout) return;
      rebuildTimer = setTimeout(() => {
        const isCurrent = () => !disposed && request === revision;
        void buildFoliage(settings, isCurrent).then(next => {
          if (!next) return;
          if (!isCurrent()) { next.dispose(); return; }
          const previous = foliage;
          foliage = next;
          root.add(next.group);
          previous?.dispose();
        }).catch(error => { if (!disposed) console.error('Jungle foliage update failed', error); });
      }, 80);
    });
    mountJungleEyes(ctx, root);
    ctx.onActivate(mountJungleControls);
  },
});
