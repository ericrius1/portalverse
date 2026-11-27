import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  cameraPosition,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

/**
 * Nostalgic blue-hour twilight sky dome (fog-exempt):
 * Deep velvety indigo zenith, soft lavender-violet dusk band, warm peach-coral afterglow
 * on the horizon, drifting backlit twilight clouds, subtle twinkling stars, and a glowing crescent moon.
 */
export function createTwilightSkyMaterial(moonDir: THREE.Vector3): THREE.MeshBasicNodeMaterial {
  const uMoonDir = uniform(moonDir.clone().normalize());
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });

  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const elev = clamp(dir.y, 0.0, 1.0);

    const zenith = vec3(0.05, 0.07, 0.17);
    const midDusk = vec3(0.14, 0.16, 0.34);
    const violetBand = vec3(0.32, 0.21, 0.44);
    const warmHorizon = vec3(0.76, 0.44, 0.46);

    const lower = mix(warmHorizon, violetBand, smoothstep(float(0.0), float(0.18), elev));
    const upper = mix(midDusk, zenith, smoothstep(float(0.24), float(0.78), elev));
    let sky = mix(lower, upper, smoothstep(float(0.1), float(0.42), elev));

    // Soft backlit twilight cumulus clouds catching peach-rose horizon glow & moonlight
    const proj = dir.xz.div(max(elev.add(0.26), 0.26));
    const drift = proj.add(vec2(time.mul(0.012), time.mul(0.005)));
    const c1 = sin(drift.x.mul(1.6).add(sin(drift.y.mul(1.3)).mul(0.85)))
      .mul(cos(drift.y.mul(1.5).sub(drift.x.mul(0.4))));
    const c2 = sin(drift.x.mul(3.4).sub(drift.y.mul(2.8)).add(1.7)).mul(0.44);
    const cloudVal = c1.add(c2);
    const cloudMask = smoothstep(float(0.28), float(0.88), cloudVal)
      .mul(smoothstep(float(0.05), float(0.25), elev))
      .mul(float(1.0).sub(smoothstep(float(0.68), float(0.95), elev)));
    const cloudCol = mix(vec3(0.18, 0.17, 0.34), vec3(0.72, 0.47, 0.56), float(1.0).sub(smoothstep(float(0.08), float(0.45), elev)));
    sky = mix(sky, cloudCol, cloudMask.mul(0.55));

    // Gentle high-sky twinkling stars
    const starGrid = floor(dir.xz.mul(95.0).add(dir.y.mul(45.0)));
    const starHash = fract(sin(dot(starGrid, vec2(127.1, 311.7))).mul(43758.5453));
    const starMask = smoothstep(float(0.992), float(0.999), starHash).mul(smoothstep(float(0.24), float(0.58), elev));
    const twinkle = sin(time.mul(2.4).add(starHash.mul(62.0))).mul(0.35).add(0.65);
    sky = sky.add(vec3(0.88, 0.94, 1.0).mul(starMask.mul(twinkle).mul(0.95)));

    // Luminous crescent moon & soft cool lavender halo
    const moonAmt = max(dot(dir, uMoonDir), 0.0);
    const moonHalo = vec3(0.55, 0.72, 0.98).mul(pow(moonAmt, 14.0).mul(0.36));
    const moonDisc = smoothstep(float(0.9968), float(0.9982), moonAmt);
    // Offset shadow disc to carve a storybook crescent
    const shadowDir = normalize(uMoonDir.add(vec3(0.036, 0.024, 0.01)));
    const shadowAmt = max(dot(dir, shadowDir), 0.0);
    const crescent = clamp(moonDisc.sub(smoothstep(float(0.9966), float(0.9981), shadowAmt)), 0.0, 1.0);

    sky = sky.add(moonHalo).add(vec3(1.0, 0.97, 0.88).mul(crescent.mul(1.5)));
    return vec4(sky, 1.0);
  })();

  return material;
}

export interface WetPromenadeHandle {
  material: THREE.MeshBasicNodeMaterial;
  uPlayerPos: { value: THREE.Vector3 };
  uRippleOrigin: { value: THREE.Vector2 };
  uRippleAge: { value: number };
}

/**
 * Rain-washed twilight cobblestone & wet puddle shader:
 * - Laid dark slate tiles with subtle mossy mortar grooves & wooden platform planks on the sides
 * - Organic glossy rain puddles reflecting warm amber lanterns, soft cyan CRT glow, and rose neon
 * - Continuous gentle falling raindrop micro-rings across puddles
 * - Live expanding footstep puddle splash ring (`uRippleOrigin`, `uRippleAge`) & subtle warm foot aura
 */
export function createWetPromenadeMaterial(): WetPromenadeHandle {
  const uPlayerPos = uniform(new THREE.Vector3(0, -100, 0));
  const uRippleOrigin = uniform(new THREE.Vector2(999, 999));
  const uRippleAge = uniform(10.0);

  const material = new THREE.MeshBasicNodeMaterial();

  material.colorNode = Fn(() => {
    const wp = positionWorld;
    const p = wp.xz;

    // Subtle stone paving tiles along the central promenade, weathered planks on outer platforms
    const tileU = fract(p.x.mul(0.85));
    const tileV = fract(p.y.mul(0.85));
    const mortarX = smoothstep(float(0.0), float(0.055), tileU).mul(float(1.0).sub(smoothstep(float(0.945), float(1.0), tileU)));
    const mortarZ = smoothstep(float(0.0), float(0.055), tileV).mul(float(1.0).sub(smoothstep(float(0.945), float(1.0), tileV)));
    const tileFace = mortarX.mul(mortarZ);

    const tileId = floor(p.mul(0.85));
    const tileTone = fract(sin(dot(tileId, vec2(12.9898, 78.233))).mul(43758.5453)).mul(0.14);

    // Soft glowing cyber-moss tucking into occasional damp mortar seams near edges
    const edgeBand = smoothstep(float(2.2), float(4.8), abs(wp.x));
    const mossPatch = sin(p.x.mul(0.35).add(1.2)).mul(cos(p.y.mul(0.28).sub(0.6))).mul(0.5).add(0.5);
    const seamMoss = float(1.0).sub(tileFace).mul(edgeBand).mul(smoothstep(float(0.45), float(0.85), mossPatch));

    // Base rain-dampened slate blue-charcoal stone
    const wetSlate = vec3(0.08, 0.095, 0.14).add(vec3(tileTone.mul(0.22), tileTone.mul(0.24), tileTone.mul(0.3)));
    const dryEdgeWood = vec3(0.12, 0.1, 0.13);
    const isSidePlatform = smoothstep(float(4.5), float(5.2), abs(wp.x));
    let baseCol = mix(wetSlate, dryEdgeWood, isSidePlatform.mul(0.7));
    baseCol = baseCol.mul(float(0.72).add(tileFace.mul(0.28)));
    // Add luminous emerald-mint rain-moss in damp seams
    baseCol = baseCol.add(vec3(0.06, 0.28, 0.22).mul(seamMoss));

    // Organic rain puddles pooled across the promenade
    const puddleNoise = sin(p.x.mul(0.32).add(sin(p.y.mul(0.25)).mul(1.2)))
      .mul(cos(p.y.mul(0.29).sub(p.x.mul(0.18))))
      .add(sin(p.x.mul(0.75).add(p.y.mul(0.62))).mul(0.32));
    const puddleMask = smoothstep(float(0.05), float(0.48), puddleNoise)
      .mul(float(1.0).sub(smoothstep(float(10.0), float(22.0), abs(wp.x))));

    // View Fresnel for mirror-like rain reflections
    const viewDir = normalize(cameraPosition.sub(wp));
    const fresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 2.2);

    // Rich reflected twilight neon pools: warm amber lanterns, cyan CRT glow, coral vending glow, violet sky
    const neonWave1 = sin(p.y.mul(0.18).add(0.6)).mul(0.5).add(0.5);
    const neonWave2 = cos(p.y.mul(0.24).sub(p.x.mul(0.22))).mul(0.5).add(0.5);
    const amberGlow = vec3(0.95, 0.56, 0.22).mul(smoothstep(float(0.35), float(0.95), neonWave1).mul(0.42));
    const cyanGlow = vec3(0.16, 0.84, 0.92).mul(smoothstep(float(0.3), float(0.92), neonWave2).mul(0.38));
    const sakuraGlow = vec3(0.94, 0.42, 0.68).mul(smoothstep(float(0.4), float(0.95), sin(p.y.mul(0.13).sub(1.1)).mul(0.5).add(0.5)).mul(0.32));
    const skyMirror = vec3(0.18, 0.21, 0.42).add(amberGlow).add(cyanGlow).add(sakuraGlow);

    // Animated falling raindrop micro-rings shimmering inside every puddle
    const dropCell = fract(p.mul(1.35));
    const dropId = floor(p.mul(1.35));
    const dropSeed = fract(sin(dot(dropId, vec2(41.1, 289.7))).mul(43758.5453));
    const dropPhase = fract(time.mul(0.85).add(dropSeed));
    const dropDist = length(dropCell.sub(vec2(0.5, 0.5)));
    const dropRing = float(1.0)
      .sub(smoothstep(float(0.0), float(0.065), abs(dropDist.sub(dropPhase.mul(0.42)))))
      .mul(float(1.0).sub(dropPhase))
      .mul(puddleMask);

    // Expanding player footstep puddle splash ring
    const rDist = length(p.sub(uRippleOrigin));
    const waveFront = uRippleAge.mul(2.5);
    const stepRing = float(1.0)
      .sub(smoothstep(float(0.0), float(0.45), abs(rDist.sub(waveFront))))
      .mul(float(1.0).sub(smoothstep(float(0.15), float(2.4), uRippleAge)))
      .mul(sin(rDist.sub(waveFront).mul(18.0)).mul(0.5).add(0.5));

    // Soft warm glow right under player's feet so walking feels grounded and alive
    const pDist = length(p.sub(uPlayerPos.xz));
    const footGlow = float(1.0).sub(smoothstep(float(0.2), float(2.6), pDist)).mul(0.12);

    // Subtle railway-track brass inlay stripes flanking the central walk
    const railStripe = float(1.0).sub(smoothstep(float(0.04), float(0.12), abs(abs(wp.x).sub(3.35))));
    const railCol = vec3(0.42, 0.56, 0.64).mul(railStripe.mul(0.45));

    const reflected = mix(baseCol, skyMirror, puddleMask.mul(fresnel.mul(0.68).add(0.22)));
    const finalCol = reflected
      .add(vec3(0.65, 0.9, 1.0).mul(dropRing.mul(0.32)))
      .add(vec3(0.55, 0.95, 0.92).mul(stepRing.mul(0.58)))
      .add(vec3(0.45, 0.85, 0.88).mul(footGlow))
      .add(railCol);

    return vec4(finalCol, 1.0);
  })();

  return { material, uPlayerPos, uRippleOrigin, uRippleAge };
}

/**
 * Translucent glowing holographic koi material with GPU sine-wave swimming undulation,
 * horizontal hologram scanlines, and luminous Fresnel rim.
 */
export function createHoloKoiMaterial(colorHex: string, phaseOffset: number): THREE.MeshBasicNodeMaterial {
  const baseColor = new THREE.Color(colorHex);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // Gentle fluid body undulation along local Z (head at +Z, tail at -Z)
  material.positionNode = Fn(() => {
    const pos = positionLocal;
    const tailWeight = smoothstep(float(0.25), float(-0.75), pos.z);
    const wiggle = sin(time.mul(4.8).add(float(phaseOffset)).add(pos.z.mul(4.5))).mul(0.14).mul(tailWeight);
    return vec3(pos.x.add(wiggle), pos.y, pos.z);
  })();

  const out = Fn(() => {
    const coord = uv();
    const scanline = sin(coord.y.mul(48.0).sub(time.mul(6.0))).mul(0.18).add(0.82);
    const shimmer = sin(coord.x.mul(12.0).add(time.mul(2.5)).add(float(phaseOffset))).mul(0.15).add(0.85);
    const col = vec3(baseColor.r, baseColor.g, baseColor.b).mul(scanline).mul(shimmer).mul(1.35);
    const alpha = float(0.62).mul(scanline);
    return vec4(col, alpha);
  })();

  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

/**
 * Translucent holographic cassette-arch ribbon / beacon shader with flowing synthwave scanlines.
 */
export function createHoloRibbonMaterial(colorA: string, colorB: string): THREE.MeshBasicNodeMaterial {
  const cA = new THREE.Color(colorA);
  const cB = new THREE.Color(colorB);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const out = Fn(() => {
    const coord = uv();
    const scan = sin(coord.y.mul(64.0).sub(time.mul(5.0))).mul(0.2).add(0.8);
    const grad = mix(vec3(cA.r, cA.g, cA.b), vec3(cB.r, cB.g, cB.b), coord.x);
    const edgeFade = smoothstep(float(0.0), float(0.15), coord.y).mul(float(1.0).sub(smoothstep(float(0.85), float(1.0), coord.y)));
    return vec4(grad.mul(scan).mul(1.15), edgeFade.mul(0.36));
  })();

  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}
