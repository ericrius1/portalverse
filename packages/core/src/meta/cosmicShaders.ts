import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  modelPosition,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  reflect,
  refract,
  screenUV,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  viewportTexture,
} from 'three/tsl';
import type { ConstellationSpec } from './constellations';

function createFallbackTexture(): THREE.DataTexture {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Rich deep-space WebGPU TSL sky dome with a tilted luminous Milky Way band,
 * multi-toned sapphire/amethyst/teal/rose nebula clouds, and faint distant
 * twinkling micro-stars.
 */
export function createCosmicSkyMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal);

    // Deep velvety cosmic gradient (midnight indigo to obsidian zenith)
    const voidDark = vec3(0.012, 0.018, 0.052);
    const midSpace = vec3(0.032, 0.048, 0.125);
    const horizonMist = vec3(0.068, 0.052, 0.165);
    const eqBand = float(1.0).sub(smoothstep(float(0.0), float(0.65), abs(dir.y)));
    let sky = mix(voidDark, midSpace, smoothstep(float(-0.6), float(0.45), dir.y));
    sky = mix(sky, horizonMist, eqBand.mul(0.55));

    // Tilted galactic plane coordinates for the Milky Way river
    const galPlane = dir.y.mul(0.76).add(dir.x.mul(0.48)).sub(dir.z.mul(0.44));
    const galWidth = exp(galPlane.mul(galPlane).negate().mul(11.5));
    const galCore = exp(galPlane.mul(galPlane).negate().mul(34.0));

    // Organic swirling cosmic dust & nebula turbulence
    const tSlow = time.mul(0.035);
    const p1 = dir.mul(3.4).add(vec3(tSlow, tSlow.mul(0.4), tSlow.negate().mul(0.6)));
    const w1 = sin(p1.x.add(sin(p1.y.mul(1.7).add(p1.z)))).mul(cos(p1.z.mul(1.4).sub(p1.x.mul(0.8))));
    const w2 = sin(dir.x.mul(7.2).sub(dir.y.mul(5.8)).add(dir.z.mul(6.4)).add(tSlow.mul(1.4))).mul(0.5);
    const w3 = cos(dir.x.mul(12.5).add(dir.z.mul(11.2)).sub(dir.y.mul(9.6))).mul(0.25);
    const turb = clamp(w1.mul(0.55).add(w2).add(w3).mul(0.5).add(0.5), 0.0, 1.0);

    // Dark cosmic dust lanes carved across the Milky Way ridge
    const dustLane = smoothstep(float(0.32), float(0.78), turb);
    const mwCyan = vec3(0.11, 0.44, 0.68);
    const mwViolet = vec3(0.38, 0.18, 0.62);
    const mwRose = vec3(0.68, 0.24, 0.54);
    const mwGold = vec3(0.95, 0.74, 0.46);

    const bandHue = sin(dir.x.mul(2.1).add(dir.z.mul(1.8)).add(0.8)).mul(0.5).add(0.5);
    const bandCol = mix(mwCyan, mwViolet, bandHue);
    const warmCloud = mix(bandCol, mwRose, smoothstep(float(0.52), float(0.92), turb));

    sky = sky.add(warmCloud.mul(galWidth.mul(dustLane).mul(0.56)));
    sky = sky.add(mix(vec3(0.52, 0.76, 1.0), mwGold, bandHue).mul(galCore.mul(dustLane).mul(0.24)));

    // Broad outer-nebula pockets away from the Milky Way band
    const pocket = smoothstep(
      float(0.58),
      float(0.96),
      sin(dir.x.mul(2.6).sub(dir.z.mul(2.1))).mul(cos(dir.y.mul(2.8).add(dir.x))).mul(0.5).add(0.5),
    );
    const pocketCol = mix(vec3(0.08, 0.34, 0.52), vec3(0.46, 0.16, 0.48), smoothstep(float(-0.4), float(0.5), dir.z));
    sky = sky.add(pocketCol.mul(pocket.mul(0.28)));

    // Fine distant starfield powder embedded in the dome
    const starCell = floor(dir.mul(190.0));
    const starHash = fract(sin(dot(starCell, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
    const starSpark = smoothstep(float(0.986), float(0.9992), starHash);
    const twinkle = sin(time.mul(2.2).add(starHash.mul(80.0))).mul(0.32).add(0.68);
    const starTint = mix(vec3(0.75, 0.88, 1.0), vec3(1.0, 0.9, 0.76), fract(starHash.mul(31.7)));
    sky = sky.add(starTint.mul(starSpark.mul(twinkle).mul(float(0.65).add(galWidth.mul(0.85)))));

    return vec4(sky, 1.0);
  })();

  return material;
}

export interface SnowglobeGlassHandle {
  material: THREE.MeshBasicNodeMaterial;
  /** Faint additive inner back wall (second highlight + rim seen through the liquid). */
  backMaterial: THREE.MeshBasicNodeMaterial;
  uHover: { value: number };
  uSelected: { value: number };
  /** 0..1+ shake energy: sloshes the liquid lens and widens the dispersion. */
  uShake: { value: number };
  uAccent: { value: THREE.Color };
}

export interface SnowglobeGlassOptions {
  /** Spectral samples for the dispersion (3 on phones, 6 on desktop). */
  spectralSamples?: number;
}

/**
 * One framebuffer copy per render, shared by every globe. Sampled through
 * `.sample(uv)` so all glass materials reference the same base node (three
 * keys the copy on the texture, so 16 globes still cost a single copy), and
 * linear-filtered so the magnified interior stays smooth instead of the
 * nearest-filtered blockiness of `viewportSharedTexture`.
 */
let glassBackdropNode: ReturnType<typeof viewportTexture> | null = null;
function getGlassBackdrop(): ReturnType<typeof viewportTexture> {
  if (!glassBackdropNode) {
    const tex = new THREE.FramebufferTexture(1, 1);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    glassBackdropNode = viewportTexture(screenUV, null, tex);
  }
  return glassBackdropNode;
}

/** World point → screen UV (WebGPU convention, y down), clamped on screen. */
type Vec3Node = THREE.Node<'vec3'>;

function worldToScreenUV(p: Vec3Node) {
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(p, 1.0));
  const ndc = clip.xy.div(max(clip.w, 0.0001));
  return clamp(vec2(ndc.x.mul(0.5).add(0.5), ndc.y.mul(-0.5).add(0.5)), 0.001, 0.999);
}

/**
 * Studio + cosmos environment seen in the glass: camera-locked softbox panels
 * (a mullioned window up-left, a tall strip light on the right, a floor
 * bounce) so every globe always catches the same crisp product-shot
 * reflections, plus a world-space nebula band and star glints that slide
 * across the glass as you orbit.
 */
function glassEnvironment(rWorld: Vec3Node, accent: THREE.Node<'vec3'> | THREE.Node<'color'>): Vec3Node {
  const rv = normalize(cameraViewMatrix.mul(vec4(rWorld, 0.0)).xyz);

  // Cosmic base: deep indigo below, violet haze above, a hint of the accent
  let env: Vec3Node = mix(vec3(0.012, 0.016, 0.05), vec3(0.07, 0.06, 0.17), smoothstep(-0.4, 0.8, rWorld.y));
  const band = exp(rWorld.y.mul(0.76).add(rWorld.x.mul(0.48)).sub(rWorld.z.mul(0.44)).pow(2.0).negate().mul(9.0));
  env = env.add(mix(vec3(0.16, 0.42, 0.7), vec3(0.62, 0.3, 0.7), rWorld.x.mul(0.5).add(0.5)).mul(band.mul(0.32)));
  env = env.add(accent.mul(0.05));

  // Star glints in the reflection
  const cell = floor(rWorld.mul(46.0));
  const h = fract(sin(dot(cell, vec3(127.1, 311.7, 74.7))).mul(43758.5453));
  env = env.add(vec3(1.0, 0.96, 0.9).mul(smoothstep(0.985, 0.999, h).mul(1.6)));

  // Mullioned window softbox up-left (behind the viewer: rv.z > 0)
  const facing = smoothstep(0.05, 0.35, rv.z);
  const winX = smoothstep(-0.84, -0.8, rv.x).mul(smoothstep(-0.2, -0.24, rv.x));
  const winY = smoothstep(0.26, 0.3, rv.y).mul(smoothstep(0.84, 0.8, rv.y));
  const mullionX = smoothstep(0.0, 0.018, abs(rv.x.add(0.52)));
  const mullionY = smoothstep(0.0, 0.018, abs(rv.y.sub(0.55)));
  const windowPane = winX.mul(winY).mul(mullionX).mul(mullionY).mul(facing);
  env = env.add(vec3(1.0, 0.98, 0.95).mul(windowPane.mul(3.2)));

  // Tall cool strip light on the right
  const strip = smoothstep(0.5, 0.54, rv.x)
    .mul(smoothstep(0.66, 0.62, rv.x))
    .mul(smoothstep(-0.7, -0.5, rv.y))
    .mul(smoothstep(0.75, 0.55, rv.y))
    .mul(facing);
  env = env.add(vec3(0.72, 0.86, 1.0).mul(strip.mul(2.4)));

  // Warm floor bounce from the brass pedestals
  env = env.add(vec3(0.9, 0.62, 0.3).mul(smoothstep(-0.55, -0.95, rv.y).mul(0.22)));
  return env;
}

/**
 * Liquid-filled crystal snowglobe: the interior is refracted through the
 * front surface (a real ray–sphere path projected back to the screen, so the
 * diorama magnifies like a water ball), split into a spectrum for chromatic
 * aberration that blooms into rainbow fringes toward the rim, Fresnel-mixed
 * with studio softbox reflections, thin-film iridescence, a dark
 * total-internal-reflection edge and a bright accent rim. Shaking the globe
 * sloshes the liquid lens.
 */
export function createSnowglobeGlassMaterial(
  accentHex: string,
  options: SnowglobeGlassOptions = {},
): SnowglobeGlassHandle {
  const uAccent = uniform(new THREE.Color(accentHex));
  const uHover = uniform(0.0);
  const uSelected = uniform(0.0);
  const uShake = uniform(0.0);
  const samples = Math.max(3, Math.min(8, Math.round(options.spectralSamples ?? 6)));
  const backdrop = getGlassBackdrop();

  const material = new THREE.MeshBasicNodeMaterial({
    // Transparent so it draws after the interior + flurry, but the output is
    // opaque: what lies behind the glass arrives through the refraction. It
    // writes depth so later transparents behind it (other globes' labels)
    // can't paint over the lens unrefracted.
    transparent: true,
    depthWrite: true,
    side: THREE.FrontSide,
    fog: false,
  });

  const glassFn = Fn(() => {
    const center = modelPosition;
    const toSurf = positionWorld.sub(center);
    const nGeo = normalize(toSurf);

    // Liquid slosh: a gentle idle shimmer, much stronger while shaken
    const wobAmt = uShake.mul(0.11).add(0.01);
    const wave = vec3(
      sin(nGeo.y.mul(9.0).add(nGeo.z.mul(4.0)).add(time.mul(3.1))),
      sin(nGeo.z.mul(8.0).add(nGeo.x.mul(5.0)).add(time.mul(2.7))),
      sin(nGeo.x.mul(10.0).add(nGeo.y.mul(3.0)).add(time.mul(3.4))),
    );
    const n = normalize(nGeo.add(wave.mul(wobAmt)));

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const incident = viewDir.negate();
    const ndotv = clamp(dot(n, viewDir), 0.0, 1.0);
    const grazing = float(1.0).sub(ndotv);
    const fresnel = float(0.04).add(float(0.96).mul(pow(grazing, 5.0)));

    // --- Refraction with spectral dispersion -------------------------------
    const spread = float(0.045).mul(float(1.0).add(uHover.mul(0.6)).add(uShake.mul(1.1)));
    // Per-pixel jitter of the wavelength positions turns the few discrete
    // spectral copies into a continuous rainbow smear instead of ghost images.
    const jitter = fract(sin(dot(screenUV.mul(vec2(1543.0, 877.0)), vec2(12.9898, 78.233))).mul(43758.5453))
      .sub(0.5)
      .mul(1.0 / samples);
    let transmitted: Vec3Node = vec3(0.0);
    const wSum = [0, 0, 0];
    const weights: Array<[number, number, number]> = [];
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const w: [number, number, number] = [
        Math.max(0, 1 - 1.6 * t),
        Math.max(0, 1 - 2 * Math.abs(t - 0.5)),
        Math.max(0, 1 - 1.6 * (1 - t)),
      ];
      weights.push(w);
      wSum[0] += w[0];
      wSum[1] += w[1];
      wSum[2] += w[2];
    }
    for (let i = 0; i < samples; i++) {
      const t = float(i / (samples - 1) - 0.5).add(jitter);
      const ior = float(1.17).add(spread.mul(t));
      const r = refract(incident, n, float(1.0).div(ior));
      // Distance to the far wall along the refracted ray; look halfway in,
      // where the diorama sits, so the whole interior magnifies.
      const tExit = max(dot(r, toSurf).mul(-2.0), 0.0);
      const uvR = worldToScreenUV(positionWorld.add(r.mul(tExit.mul(0.5))));
      const [wr, wg, wb] = weights[i];
      const weight = vec3(wr / wSum[0], wg / wSum[1], wb / wSum[2]);
      transmitted = transmitted.add(backdrop.sample(uvR).rgb.mul(weight));
    }

    // Faint liquid tint, deeper through the thick middle, accent-leaning when selected
    const tint = mix(vec3(0.9, 0.97, 1.0), uAccent, float(0.16).add(uSelected.mul(0.14)));
    transmitted = transmitted.mul(mix(vec3(1.0), tint, ndotv.mul(0.6)));

    // --- Reflection ---------------------------------------------------------
    const reflDir = reflect(incident, n);
    let reflected: Vec3Node = glassEnvironment(reflDir, uAccent);

    // Thin-film iridescence: film thickness drifts across the surface
    const film = sin(dot(nGeo, vec3(3.1, 5.3, 2.2)).add(time.mul(0.35))).mul(0.5).add(0.5);
    const iriPhase = film.mul(5.5).add(grazing.mul(6.0)).add(time.mul(0.4));
    const irid = vec3(
      cos(iriPhase).mul(0.5).add(0.5),
      cos(iriPhase.sub(2.094)).mul(0.5).add(0.5),
      cos(iriPhase.sub(4.188)).mul(0.5).add(0.5),
    );
    reflected = reflected.mul(mix(vec3(1.0), irid.mul(1.7), smoothstep(0.25, 0.9, grazing).mul(0.55)));

    // Sharp key specular + hover light sweep gliding across the glass
    const keyDir = normalize(vec3(0.55, 0.78, 0.42));
    const halfKey = normalize(keyDir.add(viewDir));
    const nh = max(dot(n, halfKey), 0.0);
    const spec = pow(nh, 900.0).mul(3.0).add(pow(nh, 220.0).mul(0.05));
    const rv = normalize(cameraViewMatrix.mul(vec4(reflDir, 0.0)).xyz);
    const sweepPhase = fract(time.mul(0.28)).mul(3.2).sub(1.6);
    const sweep = smoothstep(0.035, 0.0, abs(rv.x.add(rv.y).mul(0.7).sub(sweepPhase)))
      .mul(uHover.add(uSelected.mul(0.25)))
      .mul(0.35);

    // --- Edge -------------------------------------------------------------------
    // Dark total-internal-reflection band right at the silhouette, then a
    // bright accent rim just inside it (the glass wall seen edge-on).
    const tirEdge = smoothstep(0.0, 0.16, ndotv);
    const activeBoost = float(1.0).add(uHover.mul(0.6)).add(uSelected.mul(0.9));
    const rimBand = smoothstep(0.08, 0.2, ndotv).mul(smoothstep(0.42, 0.2, ndotv));
    const rimCol = mix(vec3(0.75, 0.9, 1.0), uAccent, 0.55).mul(rimBand.mul(0.55).mul(activeBoost));

    let rgb: Vec3Node = mix(transmitted, reflected, fresnel).mul(tirEdge);
    rgb = rgb.add(rimCol).add(vec3(1.0, 0.99, 0.97).mul(spec.add(sweep)));
    return rgb;
  });

  material.colorNode = glassFn();
  material.opacityNode = float(1.0);

  // Inner back wall: drawn additively before the flurry and front glass, so it
  // lands in the backdrop copy and gets lensed by the front surface — the
  // classic double highlight of a real glass ball.
  const backMaterial = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  backMaterial.colorNode = Fn(() => {
    const nIn = normalize(modelPosition.sub(positionWorld)); // inward-facing
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const ndotv = clamp(dot(nIn, viewDir), 0.0, 1.0);
    const reflDir = reflect(viewDir.negate(), nIn);
    const env = glassEnvironment(reflDir, uAccent);
    const hot = max(env.sub(0.6), vec3(0.0)); // keep only the bright softboxes
    const rim = pow(float(1.0).sub(ndotv), 3.0).mul(0.18).mul(float(1.0).add(uSelected));
    return hot.mul(0.35).add(uAccent.mul(rim));
  })();

  return { material, backMaterial, uHover, uSelected, uShake, uAccent };
}

/**
 * Soft drifting additive nebula cloud sheet for deep 3D parallax around the cosmos.
 */
export function createNebulaWispMaterial(
  colorHexA: string,
  colorHexB: string,
  phaseOffset: number,
  opacity = 0.22,
): THREE.MeshBasicNodeMaterial {
  const colA = uniform(new THREE.Color(colorHexA));
  const colB = uniform(new THREE.Color(colorHexB));
  const uOpacity = uniform(opacity);

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });

  const out = Fn(() => {
    const coord = uv();
    const p = coord.sub(0.5).mul(2.0);
    const r = length(p);
    const radial = smoothstep(float(1.0), float(0.12), r);

    const w1 = sin(p.x.mul(3.4).add(time.mul(0.12)).add(float(phaseOffset)))
      .mul(cos(p.y.mul(3.1).sub(time.mul(0.09))))
      .mul(0.5)
      .add(0.5);
    const w2 = sin(p.x.mul(6.2).sub(p.y.mul(5.4)).add(float(phaseOffset * 1.9))).mul(0.5).add(0.5);
    const cloud = pow(clamp(w1.mul(0.65).add(w2.mul(0.35)), 0.0, 1.0), 1.45);
    const col = mix(colA, colB, w2);
    const a = radial.mul(radial).mul(cloud).mul(uOpacity);
    return vec4(col, a);
  })();

  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

/**
 * Soft glowing 4-point starburst texture used for constellation hero stars.
 */
export function createStarSpriteTexture(): THREE.Texture {
  if (typeof document === 'undefined') return createFallbackTexture();
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) return createFallbackTexture();

  const cx = 64;
  const cy = 64;
  ctx.clearRect(0, 0, 128, 128);

  // Soft outer radial halo
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
  halo.addColorStop(0.0, 'rgba(255, 255, 255, 1)');
  halo.addColorStop(0.14, 'rgba(240, 249, 255, 0.92)');
  halo.addColorStop(0.34, 'rgba(186, 230, 253, 0.35)');
  halo.addColorStop(0.65, 'rgba(125, 211, 252, 0.08)');
  halo.addColorStop(1.0, 'rgba(125, 211, 252, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, 128, 128);

  // Crisp 4-point celestial diffraction spikes
  ctx.save();
  ctx.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    const spike = ctx.createLinearGradient(0, 0, 58, 0);
    spike.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    spike.addColorStop(0.4, 'rgba(224, 242, 254, 0.35)');
    spike.addColorStop(1, 'rgba(224, 242, 254, 0)');
    ctx.fillStyle = spike;
    ctx.beginPath();
    ctx.moveTo(0, -2.6);
    ctx.lineTo(58, 0);
    ctx.lineTo(0, 2.6);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Generates a ghostly, Uranometria-inspired celestial atlas watercolor/starlight
 * illustration texture for a constellation so the buffalo, alien, plants, and
 * concepts read poetically right behind their twinkling stars.
 */
export function createConstellationArtTexture(spec: ConstellationSpec): THREE.Texture {
  if (typeof document === 'undefined') return createFallbackTexture();
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return createFallbackTexture();

  ctx.clearRect(0, 0, size, size);

  const mapX = (nx: number) => size * 0.5 + nx * (size * 0.42);
  const mapY = (ny: number) => size * 0.5 - ny * (size * 0.42);

  // Faint celestial aura behind the silhouette
  const aura = ctx.createRadialGradient(size * 0.5, size * 0.5, 16, size * 0.5, size * 0.5, size * 0.46);
  aura.addColorStop(0, `${spec.color}2e`);
  aura.addColorStop(0.55, `${spec.secondaryColor}14`);
  aura.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, size, size);

  // Subtle decorative celestial astrolabe dashed halo ring
  ctx.save();
  ctx.strokeStyle = `${spec.color}28`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 9]);
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.5, size * 0.44, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Painterly silhouette washes & calligraphic glow outlines
  for (const stroke of spec.artStrokes) {
    if (stroke.points.length < 2) continue;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(mapX(stroke.points[0][0]), mapY(stroke.points[0][1]));
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(mapX(stroke.points[i][0]), mapY(stroke.points[i][1]));
    }
    if (stroke.closed) ctx.closePath();

    if (stroke.fillOpacity && stroke.fillOpacity > 0) {
      const fillGrad = ctx.createLinearGradient(0, size * 0.15, size, size * 0.85);
      const hexAlphaA = Math.round(Math.min(1, stroke.fillOpacity * 1.4) * 255)
        .toString(16)
        .padStart(2, '0');
      const hexAlphaB = Math.round(Math.min(1, stroke.fillOpacity * 0.7) * 255)
        .toString(16)
        .padStart(2, '0');
      fillGrad.addColorStop(0, `${spec.color}${hexAlphaA}`);
      fillGrad.addColorStop(1, `${spec.secondaryColor}${hexAlphaB}`);
      ctx.fillStyle = fillGrad;
      ctx.fill();
    }

    ctx.strokeStyle = `${spec.color}78`;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = spec.color;
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.restore();
  }

  // Engraved celestial title banner neatly tucked at the lower edge of the plate
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = spec.color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
  ctx.fillText(spec.name.toUpperCase(), size * 0.5, size - 44);
  ctx.shadowBlur = 0;
  ctx.fillStyle = spec.color;
  ctx.font = 'italic 600 14px Georgia, "Times New Roman", serif';
  ctx.fillText(`${spec.latinName}  ·  ${spec.categoryLabel}`, size * 0.5, size - 20);
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Compact crisp floating label plaque for a snowglobe in cosmic space.
 */
export function createSnowglobeLabelTexture(
  title: string,
  subtitle: string,
  accentColor: string,
  isCurrent: boolean,
): THREE.Texture {
  if (typeof document === 'undefined') return createFallbackTexture();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 140;
  const ctx = canvas.getContext('2d');
  if (!ctx) return createFallbackTexture();

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Pill background
  const x = 14;
  const y = 14;
  const w = canvas.width - 28;
  const h = canvas.height - 28;
  const r = 26;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();

  ctx.fillStyle = isCurrent ? 'rgba(15, 23, 46, 0.9)' : 'rgba(7, 11, 24, 0.8)';
  ctx.fill();
  ctx.lineWidth = isCurrent ? 4.5 : 3;
  ctx.strokeStyle = isCurrent ? '#fde68a' : accentColor;
  ctx.shadowColor = isCurrent ? '#fbbf24' : accentColor;
  ctx.shadowBlur = 14;
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 34px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
  ctx.fillText(title, canvas.width / 2, 54, canvas.width - 70);

  ctx.fillStyle = isCurrent ? '#fde68a' : accentColor;
  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
  ctx.fillText(isCurrent ? `✦ YOU ARE HERE · ${subtitle}` : subtitle, canvas.width / 2, 96, canvas.width - 70);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
