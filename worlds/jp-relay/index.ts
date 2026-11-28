/**
 * RELAY (`jp-relay`)
 *
 * A mirror-black floor in a dark hall, a matte walkway of square plates down
 * the middle, and ranks of square rack cages standing off in the dark. Each
 * rack holds a stack of platters whose rims are low-resolution LED displays:
 * an orange slashed zero runs round the bottom platter, the platters above join
 * one at a time a glyph behind, then tails of fading echoes grow up the tower.
 * Towers start at their own deterministic times, so the field slowly wakes and
 * sleeps.
 *
 * `cues.ts` is the lighting-console scheduler, `programs.ts` the named
 * programs, `layout.ts` the racks, `shaders.ts` the materials. README.md
 * explains the cue format.
 */
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { abs, color, mix, normalWorldGeometry, smoothstep } from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { breathe } from '@portalverse/core/rooms/kit';
import { createLookScratch, createPlatterFrame, hash01, samplePlatter, towerTiming, type TowerTiming } from './cues';
import { sampleSolo, soloEvent } from './specials';
import { compiledPrograms, programFor } from './programs';
import {
  LID,
  MODULE,
  PLATTER_HEIGHT,
  PLATTER_RADIUS,
  PLINTH,
  POST,
  RACK_HALF,
  RAIL,
  RackCollision,
  SPINDLE_RADIUS,
  platterCenterY,
  rackField,
  railHeights,
  type Rack,
} from './layout';
import {
  createCageMaterial,
  createDisplayMaterial,
  createFloorMaterial,
  createGlyphAtlas,
  createHazeMaterial,
  createPlatterBodyMaterial,
} from './shaders';

/** The faint ember haze of the far field, at the horizon; the fog fades to it. */
const HORIZON = '#100a07';
const ZENITH = '#020202';
const FOG_NEAR = 14;
const FOG_FAR = 150;
/** Sides round a platter: the silhouette is 2.5 mm off a true circle; the LEDs follow the UVs, not the facets. */
const SEGMENTS = 32;

interface RelayLayout {
  racks: Rack[];
  collision: RackCollision;
  /** Platter instances of rack r are platterStart[r] .. platterStart[r + 1] - 1, bottom first. */
  platterStart: Uint32Array;
  platterMatrices: Float32Array;
  boxMatrices: Float32Array;
  /** Boxes of rack r are boxStart[r] .. boxStart[r + 1] - 1. */
  boxStart: Uint32Array;
  /** Per box: rack x, rack z, lowest and highest platter heights. */
  boxAnchors: Float32Array;
  spindleMatrices: Float32Array;
  /** Per rack: x, z, height, a seed in [0, 1). */
  hazePlace: Float32Array;
  program: Uint8Array;
  timing: TowerTiming[];
  wall: THREE.BufferGeometry;
  faces: THREE.BufferGeometry;
  box: THREE.BufferGeometry;
  spindle: THREE.BufferGeometry;
  card: THREE.BufferGeometry;
}

let shared: Promise<RelayLayout> | undefined;

/** Everything that never changes, built once and shared by every mount. */
function relayLayout(): Promise<RelayLayout> {
  shared ??= buildLayout();
  return shared;
}

/** Write a translate-and-scale matrix (column-major) into slot `i`. */
function place(out: Float32Array, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void {
  const o = i * 16;
  out.fill(0, o, o + 16);
  out[o] = sx;
  out[o + 5] = sy;
  out[o + 10] = sz;
  out[o + 12] = x;
  out[o + 13] = y;
  out[o + 14] = z;
  out[o + 15] = 1;
}

async function buildLayout(): Promise<RelayLayout> {
  const racks = rackField();
  const programs = compiledPrograms();
  const collision = new RackCollision(racks);
  await breathe();

  const platterStart = new Uint32Array(racks.length + 1);
  const boxStart = new Uint32Array(racks.length + 1);
  let platters = 0;
  let boxes = 0;
  racks.forEach((rack, r) => {
    platterStart[r] = platters;
    boxStart[r] = boxes;
    platters += rack.platters;
    boxes += 6 + 4 * railHeights(rack.platters).length;
  });
  platterStart[racks.length] = platters;
  boxStart[racks.length] = boxes;

  const platterMatrices = new Float32Array(platters * 16);
  const boxMatrices = new Float32Array(boxes * 16);
  const boxAnchors = new Float32Array(boxes * 4);
  const spindleMatrices = new Float32Array(racks.length * 16);
  const hazePlace = new Float32Array(racks.length * 4);
  const inset = RACK_HALF - POST / 2;
  const railInset = RACK_HALF - RAIL / 2;
  const railLength = MODULE - 2 * POST;
  let b = 0;
  for (let r = 0; r < racks.length; r++) {
    const { x, z, height, platters: count } = racks[r];
    for (let k = 0; k < count; k++) place(platterMatrices, platterStart[r] + k, x, platterCenterY(k), z);
    const first = b;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) place(boxMatrices, b++, x + sx * inset, height / 2, z + sz * inset, POST, height, POST);
    place(boxMatrices, b++, x, PLINTH / 2, z, MODULE, PLINTH, MODULE);
    place(boxMatrices, b++, x, height - LID / 2, z, MODULE, LID, MODULE);
    for (const y of railHeights(count)) {
      for (const s of [-1, 1]) {
        place(boxMatrices, b++, x, y, z + s * railInset, railLength, RAIL, RAIL);
        place(boxMatrices, b++, x + s * railInset, y, z, RAIL, RAIL, railLength);
      }
    }
    for (let i = first; i < b; i++) {
      boxAnchors.set([x, z, platterCenterY(0), platterCenterY(count - 1)], i * 4);
    }
    place(spindleMatrices, r, x, PLINTH, z, 1, height - LID - PLINTH, 1);
    hazePlace.set([x, z, height, hash01(racks[r].seed, 5)], r * 4);
    if (r % 24 === 23) await breathe();
  }

  const program = Uint8Array.from(racks, rack => programFor(rack.seed));
  const timing = racks.map((rack, r) => towerTiming(programs[program[r]], rack.seed));
  await breathe();

  const top = new THREE.CircleGeometry(PLATTER_RADIUS, SEGMENTS).rotateX(-Math.PI / 2).translate(0, PLATTER_HEIGHT / 2, 0);
  const bottom = new THREE.CircleGeometry(PLATTER_RADIUS, SEGMENTS).rotateX(Math.PI / 2).translate(0, -PLATTER_HEIGHT / 2, 0);
  const faces = mergeGeometries([top, bottom]);
  top.dispose();
  bottom.dispose();
  return {
    racks,
    collision,
    platterStart,
    platterMatrices,
    boxMatrices,
    boxStart,
    boxAnchors,
    spindleMatrices,
    hazePlace,
    program,
    timing,
    wall: new THREE.CylinderGeometry(PLATTER_RADIUS, PLATTER_RADIUS, PLATTER_HEIGHT, SEGMENTS, 1, true),
    faces,
    box: new THREE.BoxGeometry(1, 1, 1),
    spindle: new THREE.CylinderGeometry(SPINDLE_RADIUS, SPINDLE_RADIUS, 1, 10, 1, true).translate(0, 0.5, 0),
    card: new THREE.PlaneGeometry(1, 1),
  };
}

/** This mount's own geometry over shared vertex data, so it uploads and disposes its own GPU copy. */
function copyOf(template: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(template.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize));
  }
  if (template.index) geometry.setIndex(new THREE.BufferAttribute(template.index.array, 1));
  return geometry;
}

const dynamic = (values: Float32Array, size: number) => new THREE.InstancedBufferAttribute(values, size).setUsage(THREE.DynamicDrawUsage);

export default defineRoom('jp-relay', {
  async mount(ctx) {
    const layout = await relayLayout();
    const programs = compiledPrograms();
    const { racks, platterStart, boxStart } = layout;
    const root = new THREE.Group();
    ctx.scene.add(root);

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const meshes: THREE.InstancedMesh[] = [];
    const own = <T extends THREE.BufferGeometry | THREE.Material>(resource: T): T => {
      if (resource instanceof THREE.Material) materials.push(resource);
      else geometries.push(resource);
      return resource;
    };
    const atlas = createGlyphAtlas();
    ctx.onDispose(() => {
      ctx.scene.remove(root);
      ctx.scene.backgroundNode = null;
      ctx.scene.fog = null;
      for (const mesh of meshes) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      atlas.dispose();
    });

    // A dark hall: black overhead and underfoot, a faint ember haze at the horizon. It's symmetric
    // about the horizon, so the sky seen through the mirror floor matches the sky above.
    const fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);
    ctx.scene.fog = fog;
    ctx.scene.backgroundNode = mix(color(HORIZON), color(ZENITH), smoothstep(0, 0.4, abs(normalWorldGeometry.y)));
    // Dim cool light from above for the walkway and visitors; an ember glow from below, like the floor's reflections.
    const fill = new THREE.HemisphereLight('#77746f', '#2a1206', 3);
    root.add(fill);
    const key = new THREE.DirectionalLight('#a4abbb', 0.55);
    key.position.set(-20, 60, 15);
    root.add(key);
    // The floor: walkable everywhere at y = 0 except where a rack stands; flat on the racks' lids.
    const floor = new THREE.Mesh(own(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2)), own(createFloorMaterial(fog)));
    floor.renderOrder = -1;
    floor.frustumCulled = false;
    root.add(floor);
    ctx.setTerrainHeight(layout.collision.heightAt);
    ctx.setCollider({ move: layout.collision.move });
    await ctx.breathe();

    /** An instanced mesh, or its reflection: the same instances mirrored through the floor. */
    const instances = (geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.InstancedBufferAttribute, mirrored: boolean) => {
      const mesh = new THREE.InstancedMesh(geometry, material, matrices.count);
      mesh.instanceMatrix = matrices;
      mesh.frustumCulled = false;
      if (mirrored) mesh.scale.y = -1;
      meshes.push(mesh);
      root.add(mesh);
      return mesh;
    };

    // Platters: the LED rims, and their dark faces.
    const platterCount = platterStart[racks.length];
    const chase = dynamic(new Float32Array(platterCount * 4), 4);
    const style = dynamic(new Float32Array(platterCount * 4), 4);
    const white = dynamic(new Float32Array(platterCount), 1);
    const wall = own(copyOf(layout.wall));
    wall.setAttribute('aChase', chase);
    wall.setAttribute('aStyle', style);
    wall.setAttribute('aWhite', white);
    const platterMatrices = new THREE.InstancedBufferAttribute(layout.platterMatrices, 16);
    const body = own(createPlatterBodyMaterial());
    const faces = own(copyOf(layout.faces));
    for (const mirrored of [false, true]) {
      instances(wall, own(createDisplayMaterial(atlas)), platterMatrices, mirrored);
      instances(faces, body, platterMatrices, mirrored);
    }
    await ctx.breathe();

    // Racks: posts, plinth, lid and rail frames, lit from inside; a spindle through each stack.
    const glow = dynamic(new Float32Array(boxStart[racks.length] * 3), 3);
    const box = own(copyOf(layout.box));
    box.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(layout.boxAnchors, 4));
    box.setAttribute('aGlow', glow);
    const boxMatrices = new THREE.InstancedBufferAttribute(layout.boxMatrices, 16);
    const spindle = own(copyOf(layout.spindle));
    const spindleMatrices = new THREE.InstancedBufferAttribute(layout.spindleMatrices, 16);
    for (const mirrored of [false, true]) {
      instances(box, own(createCageMaterial(mirrored)), boxMatrices, mirrored);
      instances(spindle, body, spindleMatrices, mirrored);
    }
    await ctx.breathe();

    // Haze round each working tower, above the floor and in its reflection.
    const hazePlace = new THREE.InstancedBufferAttribute(layout.hazePlace, 4);
    const hazeState = dynamic(new Float32Array(racks.length * 4), 4);
    const card = own(copyOf(layout.card));
    for (const mirrored of [false, true]) {
      const haze = new THREE.Mesh(card, own(createHazeMaterial(fog, hazePlace, hazeState, mirrored)));
      haze.count = racks.length;
      haze.frustumCulled = false;
      haze.renderOrder = mirrored ? -2 : 1;
      root.add(haze);
    }

    // Each frame, sample every platter's cue state from the shared clock.
    const frame = createPlatterFrame();
    const scratch = createLookScratch();
    const chaseValues = chase.array as Float32Array;
    const styleValues = style.array as Float32Array;
    const hazeValues = hazeState.array as Float32Array;
    const glowValues = glow.array as Float32Array;
    const whiteValues = white.array as Float32Array;
    // The inner ranks beside the promenade make occasional solos easy to spot.
    const soloCandidates = racks.flatMap((rack, i) => Math.abs(rack.x) < 13 && Math.abs(rack.z) < 30 ? [i] : []);
    const platterCounts = racks.map(rack => rack.platters);
    const update = (time: number) => {
      const solo = soloEvent(time, soloCandidates, platterCounts);
      let styleChanged = false;
      let glowChanged = false;
      for (let r = 0; r < racks.length; r++) {
        const program = programs[layout.program[r]];
        const timing = layout.timing[r];
        const count = racks[r].platters;
        const isSolo = solo?.rack === r;
        let brightness = 0;
        let litTop = -1;
        for (let k = 0; k < count; k++) {
          samplePlatter(program, timing, time, k, count, frame, scratch);
          if (isSolo) sampleSolo(solo!, k, count, frame);
          whiteValues[platterStart[r] + k] = isSolo ? 1 : 0;
          const o = (platterStart[r] + k) * 4;
          chaseValues[o] = frame.head;
          chaseValues[o + 1] = frame.tail;
          chaseValues[o + 2] = frame.intensity;
          chaseValues[o + 3] = frame.dir;
          if (styleValues[o] !== frame.glyph || styleValues[o + 1] !== frame.heads || styleValues[o + 2] !== Math.fround(frame.falloff) || styleValues[o + 3] !== frame.spacing) {
            styleValues[o] = frame.glyph;
            styleValues[o + 1] = frame.heads;
            styleValues[o + 2] = frame.falloff;
            styleValues[o + 3] = frame.spacing;
            styleChanged = true;
          }
          brightness += frame.intensity * (1 + 0.05 * Math.min(frame.tail, 9));
          if (frame.intensity > 0.02) litTop = k;
        }
        brightness /= count;
        const top = litTop < 0 ? -1 : platterCenterY(litTop) + PLATTER_HEIGHT / 2;
        hazeValues[r * 4] = brightness;
        hazeValues[r * 4 + 1] = top;
        hazeValues[r * 4 + 2] = isSolo ? 1 : 0;
        // A rack's cage only needs rewriting while its glow is changing (not through holds and rests).
        const first = boxStart[r] * 3;
        const tint = isSolo ? 1 : 0;
        if (glowValues[first] !== Math.fround(brightness) || glowValues[first + 1] !== Math.fround(top) || glowValues[first + 2] !== tint) {
          for (let i = first, end = boxStart[r + 1] * 3; i < end; i += 3) {
            glowValues[i] = brightness;
            glowValues[i + 1] = top;
            glowValues[i + 2] = tint;
          }
          glowChanged = true;
        }
      }
      chase.needsUpdate = true;
      white.needsUpdate = true;
      hazeState.needsUpdate = true;
      if (glowChanged) glow.needsUpdate = true;
      if (styleChanged) style.needsUpdate = true;
    };
    // The engine's clock is shared by every room it draws, so a preview and the room itself agree.
    ctx.onUpdate((_dt, elapsed) => update(elapsed));
    update(0);
  },
});
