import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  color,
  dot,
  float,
  mix,
  normalWorld,
  normalize,
  positionWorld,
  sin,
  smoothstep,
  texture,
  uniform,
  uv,
  vec4,
} from 'three/tsl';

type SkyDrakeMaterialSet = import('./skyDrakeMaterialsContract').SkyDrakeMaterialSet;

const TAU = 2 * Math.PI;
const SQRT_3 = Math.sqrt(3);
const DEFAULT_ACCENT = '#38bdf8';

function unit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function ease(low: number, high: number, value: number): number {
  const t = unit((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash(x: number, y: number, seed: number): number {
  const n = Math.imul(x + seed, 374761393) ^ Math.imul(y - seed, 668265263);
  return (Math.imul(n ^ (n >>> 13), 1274126177) >>> 0) / 4294967296;
}

function rgba(size: number): Uint8ClampedArray<ArrayBuffer> {
  return new Uint8ClampedArray(size * size * 4);
}

function writePixel(
  pixels: Uint8ClampedArray,
  i: number,
  r: number,
  g: number,
  b: number,
  a = 255,
): void {
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function bakePixels(
  size: number,
  draw: (pixels: Uint8ClampedArray, index: number, u: number, v: number) => void,
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = rgba(size);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      draw(pixels, (y * size + x) * 4, (x + 0.5) / size, v);
    }
  }
  return pixels;
}

interface SurfaceSample {
  r: number;
  g: number;
  b: number;
  height: number;
  roughness: number;
}

function bakeSurface(
  size: number,
  relief: number,
  wrapV: boolean,
  sample: (u: number, v: number, out: SurfaceSample) => void,
) {
  const albedo = rgba(size);
  const normal = rgba(size);
  const roughness = rgba(size);
  const height = new Float32Array(size * size);
  const surface = { r: 0, g: 0, b: 0, height: 0, roughness: 0 };

  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      sample((x + 0.5) / size, v, surface);
      const pixel = y * size + x;
      const gray = surface.roughness * 255;
      height[pixel] = surface.height;
      writePixel(albedo, pixel * 4, surface.r, surface.g, surface.b);
      writePixel(roughness, pixel * 4, gray, gray, gray);
    }
  }

  const wrap = (sampleIndex: number) => (sampleIndex + size) % size;
  const edge = wrapV
    ? wrap
    : (sampleIndex: number) => Math.min(size - 1, Math.max(0, sampleIndex));
  for (let y = 0; y < size; y++) {
    const bottom = edge(y - 1) * size;
    const top = edge(y + 1) * size;
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const nx = (height[row + wrap(x - 1)] - height[row + wrap(x + 1)]) * relief;
      const ny = (height[bottom + x] - height[top + x]) * relief;
      const invLength = 127.5 / Math.sqrt(nx * nx + ny * ny + 1);
      writePixel(normal, (row + x) * 4, 127.5 + nx * invLength, 127.5 + ny * invLength, 127.5 + invLength);
    }
  }
  return { albedo, normal, roughness };
}

function scaleSurface(u: number, v: number, out: SurfaceSample): void {
  const x = u * 12;
  const y = v * 8;
  const ax = x - Math.round(x);
  const ay = (y - Math.round(y)) * SQRT_3;
  const bx = x - (Math.round(x - 0.5) + 0.5);
  const by = (y - (Math.round(y - 0.5) + 0.5)) * SQRT_3;
  // The two offset lattices give each scale six shared edges with the next row.
  const staggered = bx * bx + by * by < ax * ax + ay * ay;
  const dx = staggered ? bx : ax;
  const dy = staggered ? by : ay;
  const edge = 2 * Math.max(Math.abs(dx), 0.5 * Math.abs(dx) + 0.8660254 * Math.abs(dy));
  const bevel = 1 - ease(0.75, 1, edge);
  const tileX = Math.round((x - dx) * 2) % 24;
  const tileY = Math.round((y - dy / SQRT_3) * 2) % 16;
  const shade = hash(tileX, tileY, 19);
  const sheen = Math.sin(TAU * (u - 0.18 + 0.13 * Math.cos(TAU * v)));
  const facets = unit(0.34 + 0.27 * sheen + 0.37 * shade + 0.30 * dy);
  const ridge = ease(0.48, 0.83, edge) * bevel * ease(-0.19, 0.25, dy);
  const glintX = dx - (shade - 0.5) * 0.61;
  const glintY = dy - (0.38 - Math.abs((shade - 0.5) * 0.33));
  const glint = (1 - ease(0.00017, 0.00185, glintX * glintX + glintY * glintY))
    * ease(0.37, 0.9, shade);
  const grain = (hash(Math.floor(u * 256), Math.floor(v * 256), 63) - 0.5) * 9 * bevel;

  out.r = 12 + bevel * (14 - 6 * facets) + ridge * 17 + glint * 152 + grain;
  out.g = 18 + bevel * (25 + 93 * facets) + ridge * 39 + glint * 167 + grain;
  out.b = 51 + bevel * (58 + 59 * facets) + ridge * 41 + glint * 105 + grain;
  out.height = bevel * (0.38 + 0.59 * (1 - edge * edge * 0.52) + 0.17 * dy);
  out.roughness = 0.72 - 0.33 * bevel - 0.13 * ridge + grain * 0.007;
}

function bellySurface(u: number, v: number, out: SurfaceSample): void {
  const arch = 0.20 * (1 - Math.cos(TAU * u));
  const plate = fract(v * 9 + arch);
  const seam = ease(0.025, 0.15, plate) * (1 - ease(0.90, 1, plate));
  const lip = ease(0.08, 0.19, plate) * (1 - ease(0.20, 0.34, plate));
  const pearl = seam * (0.71 + 0.21 * Math.cos(TAU * (u - 0.35)) + 0.08 * lip);
  const grain = (hash(Math.floor(u * 128), Math.floor(v * 128), 26) - 0.5) * 5;
  out.r = 174 + seam * 52 + pearl * 21 + lip * 8 + grain;
  out.g = 122 + seam * 57 + pearl * 54 + lip * 11 + grain;
  out.b = 71 + seam * 48 + pearl * 88 + lip * 13 + grain;
  out.height = seam * (0.46 + 0.27 * (1 - plate) + 0.13 * lip);
  out.roughness = 0.56 - 0.19 * seam - 0.10 * lip;
}

function hornSurface(u: number, v: number, out: SurfaceSample): void {
  const angle = u * TAU;
  const pearl = ease(0.03, 0.85, v);
  const ring = fract(v * 17 + 0.27 * Math.sin(angle) + 0.07 * Math.sin(angle * 3));
  const groove = 1 - ease(0.026, 0.17, Math.min(ring, 1 - ring));
  const brush = Math.sin(angle * 36 + Math.sin(v * 14 + angle * 2) * 1.8);
  out.r = 182 + pearl * 67 - groove * 26 + brush * 4;
  out.g = 132 + pearl * 94 - groove * 31 + brush * 4;
  out.b = 66 + pearl * 124 - groove * 30 + brush * 5;
  out.height = 0.25 * (1 - groove) + 0.022 * brush;
  out.roughness = 0.27 + 0.15 * groove - 0.04 * pearl;
}

function scarfSurface(u: number, v: number, out: SurfaceSample): void {
  const edge = Math.min(v, 1 - v);
  const warp = Math.cos(TAU * 92 * u);
  const weft = Math.cos(TAU * 72 * v);
  const threads = 0.5 + 0.25 * (warp + weft);
  const column = fract(u * 12);
  const herringbone = Math.cos(TAU * (v * 42 + Math.abs(column - 0.5) * 2));
  const diamond = Math.abs(column - 0.5) + Math.abs(edge - 0.125) * 8.5;
  const emblem = (1 - ease(0.32, 0.49, diamond)) * ease(0.075, 0.092, edge);
  const border = ease(0.016, 0.031, edge) * (1 - ease(0.052, 0.073, edge));
  const piping = ease(0.188, 0.201, edge) * (1 - ease(0.204, 0.22, edge));
  const gold = unit(border * (0.58 + 0.38 * herringbone) + emblem + piping * 0.54);
  const violet = 8 * herringbone + 18 * threads;
  out.r = 34 + violet + 193 * gold;
  out.g = 23 + violet * 0.55 + 151 * gold;
  out.b = 71 + violet * 1.5 - 27 * gold + 15 * threads * gold;
  out.height = threads * 0.13 + gold * 0.08;
  out.roughness = 0.86 - 0.16 * threads - 0.22 * gold;
}

// Each primary rib and secondary branch is a bowed curve in root-to-tip UV space.
const WING_RIBS = [
  [0, 1, 0.33, 0, -0.29],
  [0, 1, 0.55, 0, -0.29],
  [0, 1, 0.77, 0, -0.24],
  [0, 1, 1, 0, -0.10],
  [0, 1, 1, 0.73, -0.08],
] as const;

type WingCurve = readonly [number, number, number, number, number];

function curveHeight([, startV, , endV, bow]: WingCurve, t: number): number {
  return startV + (endV - startV) * t + bow * t * (1 - t);
}

const WING_BRANCHES: readonly WingCurve[] = [
  [0, 0.15, 0.24, 0, 0.20],
  [1, 0.25, 0.43, 0, -0.12],
  [2, 0.38, 0.65, 0, -0.18],
  [3, 0.54, 0.89, 0, -0.11],
  [4, 0.60, 1, 0.45, -0.25],
].map(([rib, startU, endU, endV, bow]) => [
  startU, curveHeight(WING_RIBS[rib], startU / WING_RIBS[rib][2]), endU, endV, bow,
]);

function drawWingVeins(
  pixels: Uint8ClampedArray,
  size: number,
  curves: readonly WingCurve[],
  channel: number,
  width: number,
): void {
  for (const curve of curves) {
    const [startU, , endU] = curve;
    const firstX = Math.max(0, Math.ceil(startU * size - 0.5));
    const lastX = Math.min(size - 1, Math.floor(endU * size - 0.5));
    for (let x = firstX; x <= lastX; x++) {
      const t = ((x + 0.5) / size - startU) / (endU - startU);
      const center = curveHeight(curve, t);
      const radius = width * (1 - 0.74 * t);
      const feather = radius + 0.004;
      const firstY = Math.max(0, Math.ceil((center - feather) * size - 0.5));
      const lastY = Math.min(size - 1, Math.floor((center + feather) * size - 0.5));
      for (let y = firstY; y <= lastY; y++) {
        const coverage = 1 - ease(radius * 0.24, feather, Math.abs((y + 0.5) / size - center));
        const i = (y * size + x) * 4 + channel;
        pixels[i] = Math.max(pixels[i], 255 * coverage);
      }
    }
  }
}

function wingPixel(pixels: Uint8ClampedArray, i: number, u: number, v: number): void {
  const x = u * 23;
  const y = v * 18;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const brightness = hash(ix, iy, 431);
  const starX = fract(x) - (0.23 + hash(ix, iy, 47) * 0.54);
  const starY = fract(y) - (0.23 + hash(ix, iy, 71) * 0.54);
  const pin = (1 - ease(0.00014, 0.0225, starX * starX + starY * starY)) * ease(0.53, 0.99, brightness);
  const cross = (1 - ease(0.0, 0.038, Math.min(Math.abs(starX), Math.abs(starY))))
    * (1 - ease(0.04, 0.28, Math.abs(starX) + Math.abs(starY))) * ease(0.89, 1, brightness);
  const dust = Math.max(0, hash(i / 4, 0, 129) - 0.982) * 17;
  const silk = 0.5 + 0.26 * Math.sin(31 * u - 24 * v + 2.6 * Math.sin(8 * v))
    + 0.24 * Math.sin(23 * v + 8 * u);
  writePixel(pixels, i, 0, 0, 255 * unit(pin + cross + dust), 255 * silk);
}

function crestPixel(pixels: Uint8ClampedArray, i: number, u: number, v: number): void {
  const spread = 0.68 + 0.42 * u;
  const rayV = (v - 0.5 - 0.08 * Math.sin(u * Math.PI)) / spread + 0.5;
  const ray = fract(12 * rayV);
  const rib = 1 - ease(0.02, 0.19, Math.abs(ray - 0.5));
  const shaft = 1 - ease(0.015, 0.072, Math.abs(rayV - 0.5));
  const barbs = 0.5 + 0.5 * Math.cos(TAU * (u * 29 - Math.abs(ray - 0.5) * 1.65));
  const strandTip = 0.94 - 0.11 * Math.abs(ray - 0.5) - 0.06 * Math.abs(2 * v - 1);
  const fade = 1 - ease(strandTip - 0.24, strandTip + 0.06, u);
  writePixel(pixels, i, Math.max(rib, shaft * 0.83) * 255, barbs * 255, 0, fade * 255);
}

function irisPixel(pixels: Uint8ClampedArray, i: number, u: number, v: number): void {
  const x = (u - 0.5) * 2;
  const y = (v - 0.5) * 2;
  const r = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(y, x);
  const radial = 0.5 + 0.25 * Math.sin(53 * theta + 4 * r)
    + 0.15 * Math.cos(91 * theta - 11 * r) + 0.1 * Math.sin(31 * theta + 12 * r);
  const gold = radial * (1 - ease(0.52, 1, r));
  const rim = 1 - 0.82 * ease(0.78, 1.02, r);
  const slit = Math.abs(x) * 5.8 + Math.pow(Math.abs(y) * 1.24, 1.5);
  const pupil = 1 - ease(0.92, 1.06, slit);
  const ember = (1 - ease(0.98, 1.29, slit)) * (1 - pupil);
  const fill = (1 - pupil) * rim;
  const glintA = 1 - ease(0.04, 0.13, Math.hypot(x + 0.26, y - 0.34));
  const glintB = 1 - ease(0.013, 0.07, Math.hypot(x - 0.28, y + 0.24));
  const core = 1 - ease(0.008, 0.055, Math.hypot(x + 0.26, y - 0.34));
  writePixel(
    pixels, i,
    9 + fill * (231 + 27 * gold) + 24 * ember + 18 * glintA + 90 * core,
    7 + fill * (117 + 90 * gold) + glintA * 92 + glintB * 83 + core * 54,
    23 + fill * (13 + 34 * gold) - 16 * ember + glintA * 122 + glintB * 162 + core * 91,
  );
}

function bakeMaps() {
  const wingSize = 256;
  // Linear masks pack ribs, branches, starlight and silk into one texture sample.
  const wing = bakePixels(wingSize, wingPixel);
  drawWingVeins(wing, wingSize, WING_RIBS, 0, 0.022);
  drawWingVeins(wing, wingSize, WING_BRANCHES, 1, 0.009);
  return {
    body: bakeSurface(256, 3.3, true, scaleSurface),
    belly: bakeSurface(128, 1.5, true, bellySurface),
    horn: bakeSurface(128, 1.15, false, hornSurface),
    scarf: bakeSurface(256, 1.55, true, scarfSurface),
    wing,
    crest: bakePixels(128, crestPixel),
    iris: bakePixels(128, irisPixel),
  };
}

function makeTexture(
  name: string,
  pixels: Uint8ClampedArray<ArrayBuffer>,
  colorSpace: string,
  wrapS: THREE.Wrapping = THREE.ClampToEdgeWrapping,
  wrapT = wrapS,
): THREE.DataTexture {
  const size = Math.sqrt(pixels.length / 4);
  const map = new THREE.DataTexture(new Uint8Array(pixels.buffer), size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.name = `Zephyr ${name}`;
  map.colorSpace = colorSpace;
  map.wrapS = wrapS;
  map.wrapT = wrapT;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

function surfaceTextures(name: string, pixels: ReturnType<typeof bakeSurface>, wrapsV = true) {
  const wrapT = wrapsV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  return {
    map: makeTexture(`${name} albedo`, pixels.albedo, THREE.SRGBColorSpace, THREE.RepeatWrapping, wrapT),
    normalMap: makeTexture(`${name} tangent normal`, pixels.normal, THREE.NoColorSpace, THREE.RepeatWrapping, wrapT),
    roughnessMap: makeTexture(`${name} roughness`, pixels.roughness, THREE.NoColorSpace, THREE.RepeatWrapping, wrapT),
  };
}

// Keep the CPU pixels so returning to Zephyr can upload fresh textures without rebaking.
let bakedMaps: ReturnType<typeof bakeMaps> | undefined;

function createTextureSet() {
  const maps = bakedMaps ??= bakeMaps();
  return {
    body: surfaceTextures('scales', maps.body),
    belly: surfaceTextures('ventral plates', maps.belly),
    horn: surfaceTextures('carved horn', maps.horn, false),
    scarf: surfaceTextures('woven scarf', maps.scarf),
    wing: makeTexture('wing veins and stars', maps.wing, THREE.NoColorSpace),
    crest: makeTexture('crest filaments', maps.crest, THREE.NoColorSpace),
    iris: makeTexture('amber iris', maps.iris, THREE.SRGBColorSpace),
  };
}

let sharedTextures: ReturnType<typeof createTextureSet> | undefined;
let textureUsers = 0;

function releaseTextures(textures: ReturnType<typeof createTextureSet>): void {
  if (--textureUsers !== 0) return;
  sharedTextures = undefined;
  for (const { map, normalMap, roughnessMap } of [textures.body, textures.belly, textures.horn, textures.scarf]) {
    map.dispose();
    normalMap.dispose();
    roughnessMap.dispose();
  }
  textures.wing.dispose();
  textures.crest.dispose();
  textures.iris.dispose();
}

const viewEdge = Fn(() => {
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  return float(1).sub(abs(dot(normalWorld, viewDir)).saturate());
});

export function createSkyDrakeMaterials(accentColor = DEFAULT_ACCENT): SkyDrakeMaterialSet {
  const textures = sharedTextures ??= createTextureSet();
  const uTime = uniform(0);
  const uFlight = uniform(0);
  const uBoost = uniform(0);
  const uSpeed = uniform(0);
  const uFlow = uniform(0);
  const accentTarget = new THREE.Color(accentColor);
  const uAccent = uniform(accentTarget.clone());

  const scaleMaterial = {
    ...textures.body,
    roughness: 1,
    metalness: 0.20,
    normalScale: new THREE.Vector2(0.75, 0.75),
    clearcoat: 0.30,
    clearcoatRoughness: 0.33,
  };
  const body = new THREE.MeshPhysicalNodeMaterial({ ...scaleMaterial, name: 'Zephyr · twilight scales' });
  body.emissiveNode = Fn(() => {
    const edge = viewEdge();
    const shimmer = sin(uTime.mul(1.5).add(uv().y.mul(14)).add(uv().x.mul(TAU))).mul(0.5).add(0.5);
    const hue = edge.mul(0.74).add(shimmer.mul(0.20)).saturate();
    const rim = mix(mix(color(0x43f7ed), color(0x9877f5), hue), uAccent, 0.30);
    const pulse = sin(uTime.mul(7).sub(uv().y.mul(8))).mul(0.20).add(0.70);
    const energy = float(0.32).add(shimmer.mul(0.12)).add(uFlight.mul(0.28))
      .add(uSpeed.mul(0.045)).add(uBoost.mul(pulse));
    return texture(textures.body.map).rgb.mul(0.13).add(rim.mul(edge.pow(2.35)).mul(energy));
  })();

  const belly = new THREE.MeshStandardNodeMaterial({
    ...textures.belly,
    name: 'Zephyr · opal ventral plates',
    roughness: 1,
    metalness: 0.08,
    normalScale: new THREE.Vector2(0.55, 0.55),
    emissive: 0x71512d,
    emissiveIntensity: 0.20,
  });

  const horn = new THREE.MeshStandardNodeMaterial({
    ...textures.horn,
    name: 'Zephyr · carved pearl gold',
    metalness: 0.45,
    roughness: 1,
    normalScale: new THREE.Vector2(0.55, 0.55),
  });
  horn.emissiveNode = color(0xffd590).mul(viewEdge().pow(3).mul(0.20).add(0.06));

  const wingMembrane = new THREE.MeshStandardNodeMaterial({
    name: 'Zephyr · aurora sail',
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    roughness: 0.52,
    metalness: 0.09,
  });
  const wingField = Fn(() => {
    const coords = uv();
    const ink = texture(textures.wing, coords);
    const edge = viewEdge().pow(1.8);
    const phase = coords.x.mul(19).add(coords.y.mul(3.3)).sub(uFlow);
    const pulse = sin(phase).mul(0.5).add(0.5).pow(3);
    const ribbon = sin(coords.x.mul(14).sub(coords.y.mul(9)).add(uTime.mul(0.7))).mul(0.5).add(0.5);

    const spectral = coords.x.mul(0.65).add(float(1).sub(coords.y).mul(0.35)).add(ribbon.mul(0.10));
    const violet = mix(color(0x20dcca), color(0x745bf4), smoothstep(0.12, 0.60, spectral));
    const rose = mix(violet, color(0xee5abf), smoothstep(0.54, 0.91, spectral));
    const gold = mix(rose, color(0xffbc76), smoothstep(0.79, 1.05, spectral).mul(ribbon.mul(0.55).add(0.22)));
    const aurora = mix(gold, mix(color(0xb9fff2), uAccent, 0.29), edge.mul(0.42));
    const veins = ink.r.mul(0.83).add(ink.g.mul(0.40));
    const energy = float(0.20).add(uFlight.mul(0.23)).add(uBoost.mul(0.48)).add(uSpeed.mul(0.045));
    const light = ink.a.mul(0.19).add(ribbon.mul(0.08)).add(pulse.mul(energy)).add(edge.mul(0.26));
    const stars = ink.b.mul(ribbon.mul(0.45).add(0.38));
    const gleam = mix(color(0xa4fff5), uAccent, 0.29).mul(veins.mul(0.28).add(veins.mul(pulse).mul(energy)).add(stars));
    const alpha = float(0.20).add(coords.y.mul(0.17)).add(float(1).sub(coords.x).pow(2).mul(0.27))
      .add(veins.mul(0.27)).add(stars.mul(0.26)).add(edge.mul(0.07));
    return vec4(aurora.mul(light).add(gleam), alpha.clamp(0.18, 0.94));
  })();
  wingMembrane.colorNode = mix(wingField.rgb, color(0x403581), 0.24);
  wingMembrane.emissiveNode = wingField.rgb;
  wingMembrane.opacityNode = wingField.a;

  const wingBone = new THREE.MeshPhysicalNodeMaterial({
    name: 'Zephyr · lapis spars',
    color: 0x102042,
    roughness: 0.37,
    metalness: 0.47,
    clearcoat: 0.20,
    anisotropy: 0.35,
  });
  wingBone.emissiveNode = Fn(() => {
    const grain = sin(uv().x.mul(TAU * 26).add(sin(uv().y.mul(24)).mul(0.55))).mul(0.16).add(0.84);
    const edge = viewEdge().pow(3.5);
    return mix(color(0x40d9e3), color(0xffd582), edge).mul(edge.mul(0.24).mul(grain)).add(color(0x081732));
  })();

  const crest = new THREE.MeshStandardNodeMaterial({
    name: 'Zephyr · aurora feather rays',
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    roughness: 0.48,
    metalness: 0.13,
  });
  const crestField = Fn(() => {
    const coords = uv();
    const fiber = texture(textures.crest, coords);
    const drift = sin(coords.x.mul(8).add(coords.y.mul(5)).sub(uTime.mul(1.6))).mul(0.5).add(0.5);
    const hue = coords.x.mul(0.75).add(drift.mul(0.26));
    const aqua = mix(color(0x38f2d8), color(0x38bdf8), smoothstep(0.08, 0.57, hue));
    const prism = mix(aqua, color(0xe879f9), smoothstep(0.40, 0.98, hue));
    const rays = fiber.r.mul(0.46).add(fiber.g.mul(0.18)).add(viewEdge().pow(2).mul(0.23)).add(0.22);
    const energy = uFlight.mul(0.48).add(uBoost.mul(drift.mul(0.56).add(0.33))).add(0.54);
    const alpha = fiber.a.mul(fiber.r.mul(0.28).add(0.64)).mul(float(1).sub(coords.x.mul(0.20)));
    return vec4(prism.mul(rays).mul(energy), alpha);
  })();
  crest.colorNode = crestField.rgb;
  crest.emissiveNode = crestField.rgb;
  crest.opacityNode = crestField.a;

  const eyeIris = new THREE.MeshStandardNodeMaterial({
    name: 'Zephyr · molten amber iris',
    map: textures.iris,
    roughness: 0.24,
    metalness: 0.04,
  });
  eyeIris.emissiveNode = texture(textures.iris).rgb.mul(0.42);

  const eyeRim = new THREE.MeshStandardNodeMaterial({
    name: 'Zephyr · obsidian eye rim',
    color: 0x0b1024,
    roughness: 0.15,
    metalness: 0.09,
  });
  const eyelid = new THREE.MeshPhysicalNodeMaterial({ ...scaleMaterial, name: 'Zephyr · scaled eyelid' });
  eyelid.emissiveNode = body.emissiveNode;

  const scarf = new THREE.MeshStandardNodeMaterial({
    ...textures.scarf,
    name: 'Zephyr · woven twilight scarf',
    metalness: 0.12,
    roughness: 1,
    normalScale: new THREE.Vector2(0.36, 0.36),
  });
  scarf.emissiveNode = Fn(() => {
    const weave = texture(textures.scarf.map).rgb;
    const gold = smoothstep(0.10, 0.42, weave.r.sub(weave.b));
    const thread = sin(uv().x.mul(TAU * 12).add(uv().y.mul(25)).sub(uTime.mul(1.2))).mul(0.15).add(0.24);
    const edge = viewEdge();
    return weave.mul(0.095).add(mix(color(0xf5b841), color(0xecb9ee), edge)
      .mul(edge.pow(2)).mul(gold).mul(thread));
  })();

  const materials = { body, belly, horn, wingMembrane, wingBone, crest, eyeIris, eyeRim, eyelid, scarf };
  textureUsers++;
  let disposed = false;

  return {
    ...materials,
    setAccentColor(hexColor) {
      accentTarget.set(hexColor);
    },
    update(dt, elapsed, motion) {
      const step = Math.max(0, dt);
      const weight = -Math.expm1(-step * 7);
      uTime.value = elapsed;
      uFlight.value += (Number(motion.isFlying) - uFlight.value) * weight;
      uBoost.value += (unit(motion.boost) - uBoost.value) * weight;
      uSpeed.value += (Math.min(2, Math.max(0, motion.speedNorm)) - uSpeed.value) * weight;
      uAccent.value.lerp(accentTarget, weight);
      // Integrate the membrane phase so changing speed never jumps the wave's position.
      const flowRate = 1.3 + 2.7 * uFlight.value + 4.8 * uBoost.value + 0.55 * uSpeed.value;
      uFlow.value = (uFlow.value + step * flowRate) % TAU;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of Object.values(materials)) material.dispose();
      releaseTextures(textures);
    },
  };
}
