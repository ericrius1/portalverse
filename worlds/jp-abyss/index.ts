/**
 * ABYSS STEPPING STONES (`jp-abyss`)
 *
 * A crooked path of ancient stones hanging in the dark, high above a chasm. Each
 * stone is a Voronoi cell cut along the path, gapped from its neighbours,
 * chamfered and weathered, with a jagged rock hanging beneath it. They drift
 * gently out of step with each other, glow from below like bioluminescence, and
 * trail smoke that falls away into the void. Far below, layers of fog drift at
 * different heights and speeds, and needle spires rise out of them.
 *
 * Path layout and the walkable height live in `path.ts`; the stone shader repeats
 * `stoneMotion` so what you see and what you stand on move together. Walk off the
 * edge and you fall; the engine dims the view and offers a respawn at the fog.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  bumpMap,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  float,
  instancedBufferAttribute,
  max,
  min,
  mix,
  mx_noise_float,
  mx_noise_vec3,
  normalGeometry,
  normalView,
  normalWorldGeometry,
  positionGeometry,
  positionViewDirection,
  positionWorld,
  pow,
  rotate,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { buildPathStones, buildStrayStones, centreline, distanceToPath, TILT, Walkway } from './path';
import { buildSpikeGeometry, buildStoneGeometry, buildWispGeometry, moteAttributes, stoneUnderside, type Mote, type Wisp } from './geometry';
import { abyssNoisePixels, NOISE_SIZE } from './noise';

type Vec4Node = THREE.Node<'vec4'>;
type Vec3Node = THREE.Node<'vec3'>;
type FloatNode = THREE.Node<'float'>;

const HORIZON = '#2a2940';
const ZENITH = '#05050c';
const GLOW = '#3ff2c8';
const GLOW_VIOLET = '#a68cff';
const MOON = new THREE.Vector3(0.45, 0.34, -0.83).normalize();
/** Bottom of the spires, hidden under the lowest fog. */
const SPIRE_BASE = -190;
const SPIRES = 220;
/** Distance from the eye over which far things fade into the horizon colour; ends inside the 450 m draw distance. */
const HAZE_NEAR = 150;
const HAZE_FAR = 420;

/** Fog banks from the bottom up. The lowest is opaque and sets the colour; the rest drift over it. */
const FOG_LAYERS = [
  { y: -150, cover: 0, opacity: 1, scale: 1 / 220, drift: [0.6, 0.25], lift: 0, base: '#191828', crest: '#29273c' },
  { y: -128, cover: 0.4, opacity: 0.92, scale: 1 / 180, drift: [1.0, 0.35], lift: 9, base: '#262438', crest: '#4a4766' },
  { y: -108, cover: 0.47, opacity: 0.8, scale: 1 / 140, drift: [-0.7, 0.8], lift: 7, base: '#2c2a42', crest: '#57537a' },
  { y: -90, cover: 0.55, opacity: 0.62, scale: 1 / 105, drift: [0.55, -0.6], lift: 5, base: '#312f49', crest: '#646087' },
  { y: -76, cover: 0.64, opacity: 0.42, scale: 1 / 75, drift: [1.3, 0.2], lift: 3, base: '#37354f', crest: '#716d95' },
] as const;
/** The tallest spire reaches halfway from the top of the fog up to the walkway. */
const SPIRE_TOP = FOG_LAYERS[FOG_LAYERS.length - 1].y / 2;

/** TSL twin of the rise in `stoneMotion`. */
function riseNode(clock: FloatNode, motion: Vec4Node, phase: Vec4Node): FloatNode {
  const a = clock.mul(motion.z);
  return sin(a.mul(0.61).add(phase.x)).mul(0.6)
    .add(sin(a.mul(1.13).add(phase.y)).mul(0.3))
    .add(sin(a.mul(2.3).add(phase.z)).mul(0.1))
    .mul(motion.w);
}

/** TSL twin of `stoneTopAt` without the clamp: how far the point `at` on a stone has moved up. */
function driftNode(clock: FloatNode, at: Vec3Node, motion: Vec4Node, phase: Vec4Node): FloatNode {
  const a = clock.mul(motion.z);
  const tilt = motion.w.mul(TILT);
  const sx = sin(a.mul(0.47).add(phase.w)).mul(tilt);
  const sz = cos(a.mul(0.39).add(phase.w.mul(1.3))).mul(tilt);
  return riseNode(clock, motion, phase).add(sx.mul(at.x.sub(motion.x))).add(sz.mul(at.z.sub(motion.y)));
}

interface AbyssLayout {
  walkway: Walkway;
  stones: THREE.BufferGeometry;
  wisps: THREE.BufferGeometry;
  sparkles: ReturnType<typeof moteAttributes>;
  halos: ReturnType<typeof moteAttributes>;
  flatSheet: THREE.BufferGeometry;
  swellSheet: THREE.BufferGeometry;
  spireShapes: THREE.BufferGeometry[];
  spires: THREE.Matrix4[][];
}

let shared: Promise<AbyssLayout> | undefined;

/** Hand control back to the browser so it can draw a frame between the heavy steps. */
const breathe = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/**
 * Everything about the room that never changes: the stones and the walkway, and
 * the vertex data for the stones, smoke, motes, fog sheets and spires. Built once,
 * in steps of a frame or two each, and shared by every mount, so mounting stays
 * quick (the engine mounts rooms while the player walks).
 */
function abyssLayout(): Promise<AbyssLayout> {
  shared ??= buildLayout();
  return shared;
}

async function buildLayout(): Promise<AbyssLayout> {
  abyssNoisePixels();
  await breathe();
  const line = centreline();
  const pathStones = buildPathStones(seededRandom(7), line);
  const stones = [...pathStones, ...buildStrayStones(seededRandom(8), line)];
  await breathe();

  // Sparkles drifting under each stone, and a soft halo of light beneath it.
  const moteRand = seededRandom(11);
  const sparkles: Mote[] = [];
  const halos: Mote[] = [];
  for (const stone of stones) {
    const slabBottom = stone.topY - stone.thickness;
    for (let i = 0, count = stone.walkable ? 5 : 8; i < count; i++) {
      const a = moteRand() * Math.PI * 2;
      const r = Math.sqrt(moteRand()) * stone.radius * 0.9;
      sparkles.push({
        stone,
        x: stone.cx + Math.cos(a) * r,
        y: slabBottom - 0.2 - moteRand() * (stone.depth + 1.6),
        z: stone.cz + Math.sin(a) * r,
        size: 0.05 + moteRand() * 0.09,
        seed: moteRand(),
      });
    }
    halos.push({
      stone,
      x: stone.cx,
      y: slabBottom - stone.depth * 0.55,
      z: stone.cz,
      size: stone.radius * 2.6 * (0.8 + moteRand() * 0.4),
      seed: moteRand(),
    });
  }

  // Smoke hangs from about half the path stones and every loose one.
  const wispRand = seededRandom(12);
  const wisps: Wisp[] = [];
  for (const stone of stones) {
    if (stone.walkable && wispRand() > 0.55) continue;
    wisps.push({
      stone,
      origin: stoneUnderside(stone),
      width: (0.6 + wispRand() * 0.5) * stone.radius,
      length: stone.walkable ? 4 + wispRand() * 6 : 8 + wispRand() * 9,
      seed: wispRand(),
    });
  }

  // Spires: a few close in, more in the middle distance, and most far out toward the haze.
  const rand = seededRandom(13);
  const spireShapes = [0, 1, 2, 3].map(() => buildSpikeGeometry(rand));
  const spires: THREE.Matrix4[][] = spireShapes.map(() => []);
  const rotation = new THREE.Quaternion();
  const euler = new THREE.Euler();
  let placed = 0;
  for (let tries = 0; placed < SPIRES && tries < 8000; tries++) {
    const band = rand();
    const distance = band < 0.15 ? 6 + rand() * 54 : band < 0.5 ? 60 + rand() * 140 : 200 + rand() * 210;
    const angle = rand() * Math.PI * 2;
    const x = Math.sin(angle) * distance;
    const z = Math.cos(angle) * distance;
    if (distanceToPath(line, x, z) < 3) continue;
    const top = band < 0.15 ? SPIRE_TOP - rand() * 35 : band < 0.5 ? SPIRE_TOP - 5 - rand() * 55 : SPIRE_TOP - 8 - rand() * 70;
    const radius = band < 0.15 ? 0.8 + rand() * 1.4 : band < 0.5 ? 1.6 + rand() * 2.4 : 3 + rand() * 4;
    euler.set((rand() - 0.5) * 0.1, rand() * Math.PI * 2, (rand() - 0.5) * 0.1);
    spires[placed % spireShapes.length].push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, SPIRE_BASE, z),
      rotation.setFromEuler(euler),
      new THREE.Vector3(radius, top - SPIRE_BASE, radius),
    ));
    placed++;
  }
  await breathe();
  const stoneGeometry = buildStoneGeometry(stones, seededRandom(9));
  await breathe();

  return {
    walkway: new Walkway(pathStones),
    stones: stoneGeometry,
    wisps: buildWispGeometry(wisps),
    // One set of instance buffers for every mount, so remounting doesn't add GPU buffers.
    sparkles: moteAttributes(sparkles),
    halos: moteAttributes(halos),
    flatSheet: new THREE.PlaneGeometry(1100, 1100).rotateX(-Math.PI / 2),
    swellSheet: new THREE.PlaneGeometry(1100, 1100, 120, 120).rotateX(-Math.PI / 2),
    spireShapes,
    spires,
  };
}

/** A geometry of this mount's own over shared vertex data, so each mount uploads and disposes its own copy on the GPU. */
function copyOf(template: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(template.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize));
  }
  if (template.index) geometry.setIndex(new THREE.BufferAttribute(template.index.array, 1));
  if (!template.boundingSphere) template.computeBoundingSphere();
  geometry.boundingSphere = template.boundingSphere!.clone();
  return geometry;
}

export default defineRoom('jp-abyss', {
  async mount(ctx) {
    const layout = await abyssLayout();
    const root = new THREE.Group();
    ctx.scene.add(root);
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const instanced: THREE.InstancedMesh[] = [];
    const own = <T extends THREE.BufferGeometry | THREE.Material>(resource: T): T => {
      if (resource instanceof THREE.Material) materials.push(resource);
      else geometries.push(resource);
      return resource;
    };

    // The stones, and the surface you walk on, follow one shared clock.
    const { walkway } = layout;
    const clock = uniform(0);
    let now = 0;
    ctx.setTerrainHeight((x, z) => walkway.heightAt(x, z, now));
    // Step off the path and you fall; reach the top of the fog and you're offered a respawn.
    ctx.allowFalling({ respawnBelow: FOG_LAYERS[FOG_LAYERS.length - 1].y });

    const noise = new THREE.DataTexture(abyssNoisePixels(), NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
    noise.wrapS = THREE.RepeatWrapping;
    noise.wrapT = THREE.RepeatWrapping;
    noise.magFilter = THREE.LinearFilter;
    noise.minFilter = THREE.LinearMipmapLinearFilter;
    noise.generateMipmaps = true;
    noise.colorSpace = THREE.NoColorSpace;
    noise.needsUpdate = true;

    // Night sky: near-black overhead, fading to the fog's colour at the horizon, with a pale moon.
    {
      const dir = normalWorldGeometry;
      const up = dir.y;
      // Below the horizon it stays the horizon colour, which the fog and spires haze into.
      const sky = mix(color(HORIZON), color(ZENITH), smoothstep(0, 0.6, up));
      const facing = max(dot(dir, vec3(MOON.x, MOON.y, MOON.z)), 0);
      const moon = smoothstep(0.99955, 0.9997, facing).mul(1.6).add(pow(facing, 400).mul(0.5)).add(pow(facing, 16).mul(0.06));
      const stars = smoothstep(0.72, 0.9, mx_noise_float(dir.mul(420))).mul(smoothstep(0.05, 0.4, up)).mul(0.7);
      ctx.scene.backgroundNode = sky
        .add(color('#cfd5ff').mul(moon))
        .add(vec3(0.6, 0.62, 0.8).mul(stars));
    }
    ctx.scene.fog = new THREE.Fog(HORIZON, 70, 440);
    root.add(new THREE.HemisphereLight('#5d6294', '#0d201d', 0.65));
    const moonlight = new THREE.DirectionalLight('#c8ceff', 1.5);
    moonlight.position.copy(MOON).multiplyScalar(100);
    root.add(moonlight);
    const underglow = new THREE.DirectionalLight('#33e6bd', 0.45);
    underglow.position.set(15, -100, 10);
    root.add(underglow);

    // Stones: weathered grey with lichen on top, cracked, worn at the edges, glowing underneath.
    {
      const motion = attribute<'vec4'>('aMotion', 'vec4');
      const phase = attribute<'vec4'>('aPhase', 'vec4');
      const look = attribute<'vec4'>('aLook', 'vec4');
      const rest = positionGeometry;
      const n = normalGeometry;
      const material = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 }));
      material.positionNode = rest.add(vec3(0, driftNode(clock, rest, motion, phase), 0));

      const weights = pow(abs(n), vec3(4));
      const w = weights.div(weights.x.add(weights.y).add(weights.z));
      const offset = vec2(look.y.mul(17.3), look.y.mul(9.1));
      const triplanar = (scale: number) => texture(noise, rest.zy.mul(scale).add(offset)).mul(w.x)
        .add(texture(noise, rest.xz.mul(scale).add(offset)).mul(w.y))
        .add(texture(noise, rest.xy.mul(scale).add(offset)).mul(w.z));
      const broad = triplanar(0.09);
      const fine = triplanar(0.42);
      const tone = broad.r.mul(0.55).add(fine.r.mul(0.45));
      const cracks = float(1).sub(smoothstep(0.03, 0.1, fine.b));
      const topFace = smoothstep(0.55, 0.9, n.y);
      const underFace = smoothstep(0.1, 0.55, n.y.negate());
      const wornEdge = smoothstep(0.2, 0.5, n.y).mul(float(1).sub(smoothstep(0.86, 0.97, n.y)));

      const bare = mix(color('#2b2928'), color('#5f5a53'), tone).add(wornEdge.mul(0.05));
      const mossy = mix(bare, color('#4c5843'), smoothstep(0.56, 0.7, broad.g).mul(topFace).mul(0.85));
      const spotted = mix(mossy, color('#9c9e88'), smoothstep(0.8, 0.88, fine.a).mul(topFace).mul(0.55));
      const shaded = mix(spotted, color('#1c1a1f'), underFace.mul(0.65));
      material.colorNode = shaded.mul(float(1).sub(cracks.mul(0.65)));
      material.normalNode = bumpMap(tone.sub(cracks.mul(0.6)), float(0.04));

      const hue = mix(color(GLOW), color(GLOW_VIOLET), smoothstep(0.78, 0.82, look.y));
      const pulse = sin(time.mul(0.9).add(look.y.mul(40))).mul(0.3).add(0.7);
      const belowSlab = look.z.sub(look.w).sub(rest.y);
      const underGlow = underFace.mul(smoothstep(0, 1.6, belowSlab).mul(0.2).add(0.05));
      const lichenGlow = underFace.mul(smoothstep(0.6, 0.72, fine.g)).mul(0.9).mul(pulse);
      const crackGlow = cracks.mul(look.x).mul(pulse).mul(topFace.add(underFace)).mul(0.7);
      material.emissiveNode = hue.mul(underGlow.add(lichenGlow).add(crackGlow));

      root.add(new THREE.Mesh(own(copyOf(layout.stones)), material));
    }

    // Glowing motes: sparkles drifting under each stone, and a soft halo of light beneath it.
    const addMotes = (buffers: AbyssLayout['sparkles'], shade: (seed: FloatNode, soft: FloatNode) => { tint: Vec3Node; alpha: FloatNode; scale: FloatNode; wander: Vec3Node }) => {
      const rest = instancedBufferAttribute(buffers.rest) as unknown as Vec4Node;
      const motion = instancedBufferAttribute(buffers.motion) as unknown as Vec4Node;
      const phase = instancedBufferAttribute(buffers.phase) as unknown as Vec4Node;
      const soft = pow(float(1).sub(smoothstep(0, 0.5, uv().sub(0.5).length())), 2);
      const { tint, alpha, scale, wander } = shade(phase.w, soft);
      const material = own(new THREE.SpriteNodeMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }));
      material.positionNode = rest.xyz.add(wander).add(vec3(0, riseNode(clock, motion, phase), 0));
      material.scaleNode = rest.w.mul(scale);
      material.colorNode = tint;
      material.opacityNode = alpha;
      const mesh = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), material);
      mesh.count = buffers.rest.count;
      mesh.frustumCulled = false;
      root.add(mesh);
    };
    addMotes(layout.sparkles, (seed, soft) => {
      const twinkle = pow(sin(time.mul(seed.mul(2.5).add(1.2)).add(seed.mul(60))).mul(0.5).add(0.5), 3);
      const orbit = time.mul(seed.mul(0.25).add(0.15)).add(seed.mul(40));
      return {
        tint: mix(mix(color(GLOW), color('#8dffb8'), smoothstep(0.35, 0.65, seed)), color(GLOW_VIOLET), smoothstep(0.82, 0.86, seed)).mul(1.4),
        alpha: soft.mul(twinkle.mul(0.65).add(0.35)),
        scale: twinkle.mul(0.8).add(0.6),
        wander: vec3(cos(orbit).mul(0.35), sin(time.mul(seed.add(0.5)).add(seed.mul(20))).mul(0.25), sin(orbit).mul(0.35)),
      };
    });
    addMotes(layout.halos, (seed, soft) => ({
      tint: mix(color(GLOW), color(GLOW_VIOLET), smoothstep(0.8, 0.84, seed)),
      alpha: soft.mul(soft).mul(0.07).mul(sin(time.mul(0.6).add(seed.mul(30))).mul(0.25).add(0.75)),
      scale: float(1),
      wander: vec3(0, 0, 0),
    }));

    // Smoke falling from beneath the stones, twisting and blown about as it goes (after JP's coffee smoke).
    {
      const origin = attribute<'vec4'>('aOrigin', 'vec4');
      const motion = attribute<'vec4'>('aMotion', 'vec4');
      const phase = attribute<'vec4'>('aPhase', 'vec4');
      const seed = origin.w;
      const along = uv().y;
      const across = uv().x;
      const material = own(new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      }));
      material.positionNode = Fn(() => {
        const shape = positionGeometry.toVar();
        shape.xz.assign(rotate(shape.xz, seed.mul(6.283)));
        const twist = sin(shape.y.mul(0.35).add(time.mul(0.25)).add(seed.mul(9))).mul(1.6);
        shape.xz.assign(rotate(shape.xz, twist));
        // Sample the wind moving upward through the noise, so the smoke's shapes fall.
        const wind = shape.add(origin.xyz.mul(0.13)).add(vec3(0, time.mul(0.45), 0)).mul(0.35);
        shape.addAssign(mx_noise_vec3(wind).mul(along.mul(1.8)));
        return origin.xyz.add(shape).add(vec3(0, driftNode(clock, origin.xyz, motion, phase), 0));
      })();
      const puff = smoothstep(0.4, 0.78, texture(noise, uv().mul(vec2(0.55, 0.3)).add(vec2(seed.mul(3.7), time.mul(-0.05)))).r);
      const edges = clamp(min(min(along.mul(6), float(1).sub(along).mul(1.4)), min(across.mul(4), float(1).sub(across).mul(4))), 0, 1);
      material.colorNode = mix(color(GLOW), color('#8c86c9'), along);
      material.opacityNode = puff.mul(edges).mul(0.32);
      const mesh = new THREE.Mesh(own(copyOf(layout.wisps)), material);
      mesh.frustumCulled = false;
      root.add(mesh);
    }

    // Far things melt into the horizon colour by their true distance from the eye, finishing before the
    // camera's 450 m draw distance can clip them, so the fog has no edge whichever way you look.
    const haze = smoothstep(HAZE_NEAR, HAZE_FAR, positionWorld.sub(cameraPosition).length());

    // Fog far below: an opaque floor and translucent banks drifting over it at their own heights and speeds.
    {
      const flatSheet = own(copyOf(layout.flatSheet));
      const swellSheet = own(copyOf(layout.swellSheet));
      FOG_LAYERS.forEach((layer, i) => {
        const solid = i === 0;
        const flow = positionGeometry.xz.add(vec2(layer.drift[0], layer.drift[1]).mul(time));
        const material = own(new THREE.MeshBasicNodeMaterial({ transparent: !solid, depthWrite: solid, fog: false }));
        let density = texture(noise, flow.mul(layer.scale)).r.mul(0.7)
          .add(texture(noise, flow.mul(layer.scale * 3.3).add(vec2(0.31, 0.67))).g.mul(0.3));
        if (!solid) {
          // Low, slow swells raise the banks into rounded mounds where they're thickest.
          const swell = mx_noise_float(vec3(flow.mul(layer.scale * 0.5), time.mul(0.01))).mul(0.5).add(0.5);
          material.positionNode = positionGeometry.add(vec3(0, smoothstep(0.45, 0.95, swell).mul(layer.lift), 0));
          density = varying(swell).mul(0.45).add(density.mul(0.55));
        }
        const shade = mix(color(layer.base), color(layer.crest), smoothstep(layer.cover, layer.cover + 0.4, density));
        material.colorNode = mix(shade, color(HORIZON), haze);
        if (!solid) {
          material.opacityNode = smoothstep(layer.cover, layer.cover + 0.2, density)
            .mul(layer.opacity)
            .mul(float(1).sub(haze));
        }
        const sheet = new THREE.Mesh(solid ? flatSheet : swellSheet, material);
        sheet.position.y = layer.y;
        sheet.renderOrder = -10 + i;
        sheet.frustumCulled = false;
        root.add(sheet);
      });
    }

    // Needle spires rising out of the fog, fading into it toward their roots and into the haze far off.
    {
      const material = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0.3, fog: false }));
      const sunk = float(1).sub(smoothstep(-140, -60, positionWorld.y));
      const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3);
      material.colorNode = color('#15121c').mul(float(1).sub(sunk)).mul(float(1).sub(haze));
      const glow = color('#3a3656').mul(sunk).add(color('#6d5bd6').mul(rim).mul(0.25).mul(float(1).sub(sunk)));
      material.emissiveNode = mix(glow, color(HORIZON), haze);
      layout.spireShapes.forEach((shape, i) => {
        const spires = new THREE.InstancedMesh(own(copyOf(shape)), material, layout.spires[i].length);
        instanced.push(spires);
        layout.spires[i].forEach((matrix, j) => spires.setMatrixAt(j, matrix));
        spires.computeBoundingSphere();
        root.add(spires);
      });
    }

    ctx.onUpdate((_dt, elapsed) => {
      now = elapsed;
      clock.value = elapsed;
    });

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      ctx.scene.backgroundNode = null;
      ctx.scene.fog = null;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const mesh of instanced) mesh.dispose();
      noise.dispose();
    });
  },
});
