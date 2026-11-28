/**
 * TSL materials for the relay: the LED rims of the platters, the mirror-black
 * floor and its matte walkway, the racks' cages lit from inside, and a faint
 * haze round each working tower.
 *
 * Reflections are drawn as a mirrored copy of the racks under the floor. The
 * floor is a translucent layer over them whose opacity is one minus its
 * Fresnel reflectance, so it reflects little at your feet and a lot toward the
 * horizon. Fixed-function blending keeps the flat reflection free of framebuffer copies.
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  cameraPosition,
  clamp,
  color,
  dot,
  exp,
  float,
  floor,
  fract,
  fwidth,
  instancedBufferAttribute,
  instancedDynamicBufferAttribute,
  int,
  ivec2,
  length,
  max,
  min,
  mix,
  normalWorld,
  normalize,
  output,
  positionGeometry,
  positionWorld,
  pow,
  rangeFogFactor,
  reference,
  renderGroup,
  sin,
  smoothstep,
  step,
  textureLoad,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { GLYPH_PIXELS, RING_PIXELS } from './cues';
import { GLYPH_COUNT, glyphAtlasPixels } from './glyphs';
import { FLOOR_PLATE, MODULE, WALKWAY_HALF_LENGTH, WALKWAY_HALF_WIDTH } from './layout';

type FloatNode = THREE.Node<'float'>;
type Vec2Node = THREE.Node<'vec2'>;
type Vec3Node = THREE.Node<'vec3'>;
type Vec4Node = THREE.Node<'vec4'>;

/** The one colour of light in the room. */
export const ORANGE = '#ff5a0a';
/** A lead glyph burns a little hotter than its tail. */
const ORANGE_HOT = '#ff8424';
/** Linear brightness of a fully lit LED; the engine's ACES tone mapping rolls it off. */
const LED_GAIN = 3.4;
/** Unlit LEDs: just enough to show the matrix when you stand close. */
const LED_OFF = 0.014;
/** Average lit area of one LED cell (the dot plus its soft halo), for far-away pixels. */
const LED_COVERAGE = 0.6;

/** A sine hash for plate tones and seam variation. */
function hash21(p: Vec2Node): FloatNode {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
}

/** Positive remainder, for wrapping round the ring. */
function wrap(x: FloatNode, n: FloatNode | number): FloatNode {
  return x.sub(floor(x.div(n)).mul(n));
}

/** Live fog settings: the engine moves near and far while it draws a room through a portal. */
function sceneFog(fog: THREE.Fog): { color: Vec3Node; factor: FloatNode } {
  const near = reference('near', 'float', fog).setGroup(renderGroup) as unknown as FloatNode;
  const far = reference('far', 'float', fog).setGroup(renderGroup) as unknown as FloatNode;
  return {
    color: reference('color', 'color', fog).setGroup(renderGroup) as unknown as Vec3Node,
    factor: rangeFogFactor(near, far),
  };
}

/** A thin line `half` wide either side of distance 0, filtered for a pixel `w` wide. */
function line(distance: FloatNode, half: FloatNode | number, w: FloatNode): FloatNode {
  const h = typeof half === 'number' ? float(half) : half;
  return float(1).sub(smoothstep(h.sub(w), h.add(w), distance)).mul(clamp(h.mul(2).div(w), 0, 1));
}

/** The glyph atlas for one mount (the pixels are shared). */
export function createGlyphAtlas(): THREE.DataTexture {
  const atlas = new THREE.DataTexture(glyphAtlasPixels(), 8, 8 * GLYPH_COUNT, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.magFilter = THREE.NearestFilter;
  atlas.minFilter = THREE.NearestFilter;
  atlas.generateMipmaps = false;
  atlas.colorSpace = THREE.NoColorSpace;
  atlas.needsUpdate = true;
  return atlas;
}

/**
 * The rim of a platter: 32 modules of 8 × 8 LEDs. Per platter (instanced):
 * `aChase` = (head pixel, tail echoes, dimmer, direction ±1) and
 * `aStyle` = (glyph, heads, echo falloff, echo spacing), from the cue sampler.
 */
export function createDisplayMaterial(atlas: THREE.DataTexture): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  const chase = attribute<'vec4'>('aChase', 'vec4');
  const style = attribute<'vec4'>('aStyle', 'vec4');
  const white = attribute<'float'>('aWhite', 'float');
  const head = floor(chase.x);
  const tail = chase.y;
  const dimmer = chase.z;
  const dir = chase.w;
  const glyph = style.x;
  const ring = float(RING_PIXELS).div(style.y);
  const falloff = style.z;
  const spacing = style.w;

  // LED coordinates: px round the ring (0..256), py up the rim (0..8).
  const px = uv().x.mul(RING_PIXELS);
  const py = uv().y.mul(GLYPH_PIXELS);
  // How many LEDs one screen pixel covers, measured before any wobble.
  const fwc = max(fwidth(px), 0.0001);
  const fwr = max(fwidth(py), 0.0001);
  const blur = max(fwc, fwr);
  const column = floor(px);
  const row = clamp(floor(py), 0, 7);
  const forward = dir.greaterThan(0);

  // Pixels behind the lead glyph's front edge, in its direction of travel.
  const front = forward.select(head.add(7), head);
  const behind = wrap(dir.mul(front.sub(column)), ring);
  const echo = floor(behind.div(spacing));
  const inside = behind.sub(echo.mul(spacing));
  const inGlyph = step(inside, float(7.5));
  const glyphColumn = clamp(forward.select(float(7).sub(inside), inside), 0, 7);
  const texel = textureLoad(atlas, ivec2(int(glyphColumn), int(glyph.mul(8).add(float(7).sub(row)))));
  const lastEcho = floor(ring.div(spacing)).sub(1);
  const echoGain = echo.equal(0).select(
    float(1),
    pow(falloff, echo).mul(clamp(tail.sub(echo).add(1), 0, 1)),
  ).mul(step(echo, lastEcho));
  const near = texel.r.mul(inGlyph).mul(echoGain);

  // One LED: a rounded square with a soft halo, blurred to its average when it's smaller than a pixel.
  const cell = vec2(fract(px), fract(py)).sub(0.5);
  const soft = blur.mul(0.7);
  const shape = length(max(abs(cell).sub(0.17), 0));
  const dot01 = float(1).sub(smoothstep(float(0.2).sub(soft), float(0.2).add(soft), shape));
  const led = dot01.add(exp(length(cell).mul(-7)).mul(0.28));
  const farAway = smoothstep(0.55, 1.5, blur);

  // Far away, LEDs are smaller than pixels: use how much of the pixel the lit run covers instead.
  const run = wrap(dir.mul(forward.select(head.add(8), head).sub(px)), ring);
  const half = fwc.mul(0.5);
  const covers = (a: FloatNode | number, b: FloatNode) => clamp(min(run.add(half), b).sub(max(run.sub(half), a)).div(fwc), 0, 1);
  const tailEnd = spacing.mul(min(tail, lastEcho).add(1));
  const far = texel.g.mul(LED_COVERAGE).mul(
    covers(0, float(8)).add(covers(spacing, tailEnd).mul(pow(falloff, max(run.div(spacing), 1))).mul(float(8).div(spacing))),
  );

  const lit = mix(near.mul(led), far, farAway).mul(dimmer);
  const tint = mix(mix(color(ORANGE_HOT), color(ORANGE), clamp(run.div(8).sub(0.4), 0, 1)), color('#ffffff'), white);
  const unlit = mix(color(ORANGE), color('#ffffff'), white).mul(LED_OFF).mul(mix(dot01, float(0.4), farAway));
  const sheen = pow(float(1).sub(abs(dot(normalWorld, normalize(cameraPosition.sub(positionWorld))))), 4).mul(0.018);
  material.colorNode = vec3(0.004, 0.004, 0.0045).add(sheen).add(unlit).add(tint.mul(lit).mul(LED_GAIN));
  return material;
}

/**
 * The racks' steel, lit orange from inside by their platters. Per box (instanced):
 * `aAnchor` = (rack x, rack z, lowest and highest platter heights),
 * `aGlow` = (how bright the rack is, height of its top lit platter, white mix).
 */
export function createCageMaterial(mirrored: boolean): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#0b0b0c', roughness: 0.42, metalness: 0.7 });
  const anchor = attribute<'vec4'>('aAnchor', 'vec4');
  const glow = attribute<'vec3'>('aGlow', 'vec3');
  const flip = vec3(1, mirrored ? -1 : 1, 1);
  const p = positionWorld.mul(flip);
  const n = normalWorld.mul(flip);
  const contents = vec3(anchor.x, clamp(p.y, anchor.z, anchor.w), anchor.y);
  const facing = pow(max(dot(n, normalize(contents.sub(p))), 0), 1.5);
  const belowTop = float(1).sub(smoothstep(glow.y.sub(0.2), glow.y.add(0.45), p.y));
  material.emissiveNode = mix(color(ORANGE), color('#ffffff'), glow.z).mul(glow.x.mul(facing).mul(belowTop).mul(0.55));
  return material;
}

/** Platter faces and spindles: dark anodised metal. */
export function createPlatterBodyMaterial(): THREE.MeshStandardNodeMaterial {
  return new THREE.MeshStandardNodeMaterial({ color: '#09090a', roughness: 0.32, metalness: 0.6 });
}

/**
 * The floor: perfectly flat, highly reflective black plates, reflective by Fresnel,
 * with thin seams where the plates meet, and the matte walkway of 4 ft plates
 * down the middle. It's blended over the mirrored racks as `colour + behind ×
 * (1 - alpha)`, so its own highlights aren't dimmed by its transparency, and
 * fogged by hand so the far floor fades to the fog and not to double fog.
 */
export function createFloorMaterial(fog: THREE.Fog): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ metalness: 0 });
  material.transparent = true;
  material.depthWrite = true;
  material.fog = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  const p = positionWorld.xz;
  const fw = max(fwidth(p), vec2(0.00001));

  // The walkway, with antialiased edges.
  const edge = abs(p).sub(vec2(WALKWAY_HALF_WIDTH, WALKWAY_HALF_LENGTH));
  const walk = float(1).sub(smoothstep(fw.x.negate(), fw.x, edge.x)).mul(float(1).sub(smoothstep(fw.y.negate(), fw.y, edge.y)));
  const gloss = float(1).sub(walk);

  // Walkway plates, 4 ft square with 5 mm gaps, each a slightly different grey.
  const plate = p.div(MODULE);
  const toGap = abs(fract(plate.add(0.5)).sub(0.5)).mul(MODULE);
  const gap = max(line(toGap.x, 0.0025, fw.x), line(toGap.y, 0.0025, fw.y));
  const tone = hash21(floor(plate)).mul(0.1).add(0.95);

  // Seams between the big mirror plates, each a hair different in width.
  const big = p.add(vec2(WALKWAY_HALF_WIDTH, 0)).div(FLOOR_PLATE);
  const toSeam = abs(fract(big.add(0.5)).sub(0.5)).mul(FLOOR_PLATE);
  const seamIndex = floor(big.add(0.5));
  const seamHalf = vec2(hash21(vec2(seamIndex.x, 3.1)), hash21(vec2(seamIndex.y, 9.7))).mul(0.0012).add(0.0008);
  const seam = max(line(toSeam.x, seamHalf.x, fw.x), line(toSeam.y, seamHalf.y, fw.y));

  const normal = vec3(0, 1, 0);
  const facing = clamp(dot(normal, normalize(cameraPosition.sub(positionWorld))), 0, 1);
  const f0 = float(0.28);
  const fresnel = f0.add(float(1).sub(f0).mul(pow(float(1).sub(facing), 5)));
  const alpha = float(1).sub(fresnel.mul(gloss).mul(float(1).sub(seam)));

  const lacquer = vec3(0.0025, 0.0025, 0.0027);
  const matte = color('#36363a').mul(tone).mul(float(1).sub(gap.mul(0.8)));
  material.colorNode = mix(lacquer, matte, walk);
  material.roughnessNode = mix(float(0.08), float(0.9), walk);
  material.opacityNode = alpha;

  const { color: fogColor, factor } = sceneFog(fog);
  // Source RGB is the shaded surface; destination RGB is the mirrored scene.
  // One / OneMinusSrcAlpha implements surface + reflection * (1 - alpha).
  material.outputNode = vec4(mix(output.rgb, fogColor.mul(alpha), factor), alpha);
  return material;
}

/** Glow width and strength of the haze round a working tower. */
const HAZE_WIDTH = 3.6;
const HAZE_GAIN = 0.032;

/**
 * Light scattered in the air round a working tower: a soft vertical card that
 * turns to face the eye, rising with the tower's lit platters. Per tower
 * (instanced): `place` = (x, z, height, seed), `state` = (brightness, lit top, white mix, unused).
 */
export function createHazeMaterial(
  fog: THREE.Fog,
  place: THREE.InstancedBufferAttribute,
  state: THREE.InstancedBufferAttribute,
  mirrored: boolean,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const at = instancedBufferAttribute(place) as unknown as Vec4Node;
  const now = instancedDynamicBufferAttribute(state) as unknown as Vec4Node;
  // Nudged so it stays defined with the eye straight above the rack (standing on its lid).
  const toEye = normalize(cameraPosition.xz.sub(at.xy).add(vec2(0.0001, 0)));
  const across = positionGeometry.x.mul(HAZE_WIDTH);
  const top = max(now.y.add(1.1), 0.6);
  const y = positionGeometry.y.add(0.5).mul(top);
  material.positionNode = vec3(
    at.x.add(toEye.y.negate().mul(across)),
    mirrored ? y.negate() : y,
    at.y.add(toEye.x.mul(across)),
  );

  const u = uv().x.mul(2).sub(1);
  const v = uv().y;
  const profile = exp(u.mul(u).mul(-4.5)).mul(smoothstep(0, 0.12, v)).mul(float(1).sub(smoothstep(0.5, 1, v)));
  const distance = length(cameraPosition.xz.sub(at.xy));
  const close = smoothstep(1.5, 7, distance);
  const steep = float(1).sub(smoothstep(0.55, 0.9, abs(normalize(cameraPosition.sub(positionWorld)).y)));
  const { factor } = sceneFog(fog);
  material.colorNode = mix(color(ORANGE), color('#ffffff'), now.z).mul(now.x.mul(profile).mul(close).mul(steep).mul(float(1).sub(factor)).mul(HAZE_GAIN));
  return material;
}
