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

export interface StaticSkyHandle {
  material: THREE.MeshBasicNodeMaterial;
  uDaylight: { value: number };
  uRain: { value: number };
  uStaticReveal: { value: number };
}

/**
 * Neuromancer / Blade Runner Static Sky Dome (fog-exempt):
 * Instead of blue sky, behind drifting low rain clouds and wispy smog bands sits a shimmering
 * dead-channel television static sky (animated high-frequency grain + subtle VHS tracking bars +
 * faint cyan/magenta chroma ghosts) that peeks eerily through breaks in the low clouds!
 */
export function createStaticSkyMaterial(): StaticSkyHandle {
  const uDaylight = uniform(0.15);
  const uRain = uniform(0.85);
  const uStaticReveal = uniform(0.45);

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });

  material.colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const elev = clamp(dir.y, 0.0, 1.0);

    // Project upper hemisphere for fine animated TV-static snow + horizontal VHS scanlines
    const skyUV = dir.xz.div(max(elev.add(0.28), 0.28));
    const snapTime = floor(time.mul(24.0));
    const cell = floor(skyUV.mul(310.0));
    const snowA = fract(sin(dot(cell.add(vec2(snapTime.mul(1.7), snapTime.mul(3.1))), vec2(127.1, 311.7))).mul(43758.5453));
    const snowB = fract(sin(dot(cell.mul(0.5).add(vec2(snapTime.mul(0.9), snapTime.mul(2.3))), vec2(269.5, 183.3))).mul(21345.12));
    const scanBand = sin(elev.mul(320.0).sub(time.mul(18.0))).mul(0.14).add(0.86);
    const trackingBar = smoothstep(float(0.92), float(1.0), sin(elev.mul(9.0).sub(time.mul(0.55))).mul(0.5).add(0.5));

    // Dead-channel monochrome snow with subtle cyan/magenta CRT phosphor tint
    const grain = mix(snowA, snowB, 0.42).mul(scanBand);
    const staticBase = vec3(
      grain.mul(0.62).add(trackingBar.mul(0.18)),
      grain.mul(0.7).add(trackingBar.mul(0.24)),
      grain.mul(0.78).add(trackingBar.mul(0.28)),
    );
    const staticBrightness = mix(float(0.28), float(0.82), uDaylight);
    const staticSky = staticBase.mul(staticBrightness);

    // Low drifting rain clouds & wispy smog veils partially occluding the static sky
    const drift1 = skyUV.add(vec2(time.mul(0.025), time.mul(0.012)));
    const drift2 = skyUV.mul(1.85).add(vec2(time.mul(-0.018), time.mul(0.02)));
    const wisp1 = sin(drift1.x.mul(1.8).add(sin(drift1.y.mul(1.5)).mul(1.1)))
      .mul(cos(drift1.y.mul(1.6).sub(drift1.x.mul(0.6))));
    const wisp2 = sin(drift2.x.mul(2.5).sub(drift2.y.mul(2.1)).add(0.9)).mul(0.48);
    const wisp3 = cos(drift2.x.mul(5.0).add(drift2.y.mul(4.1))).mul(0.24);
    const cloudField = wisp1.add(wisp2).add(wisp3);

    // Low misty rain clouds shroud most of the static sky during rain, parting into wispy streaks during lulls
    const cloudThreshold = mix(float(-0.05), float(-0.52), uRain);
    const cloudMask = smoothstep(cloudThreshold, cloudThreshold.add(0.95), cloudField)
      .mul(smoothstep(float(0.02), float(0.2), elev));

    // Blade Runner smog & neon light-pollution underlit clouds (shifts across day/night cycle!)
    const nightCloud = vec3(0.06, 0.075, 0.14);
    const daySmogCloud = vec3(0.32, 0.27, 0.35);
    const cloudUnderGlow = mix(
      vec3(0.42, 0.14, 0.28),
      vec3(0.66, 0.42, 0.34),
      uDaylight,
    );
    const cloudCol = mix(mix(nightCloud, daySmogCloud, uDaylight), cloudUnderGlow, float(1.0).sub(smoothstep(float(0.05), float(0.48), elev)).mul(0.65));

    // Horizon neon smog haze blending into distant Neo-Tokyo towers
    const horizonCol = mix(vec3(0.16, 0.08, 0.2), vec3(0.48, 0.32, 0.34), uDaylight);
    const horizonFog = float(1.0).sub(smoothstep(float(0.0), float(0.28), elev));

    // Blend wispy cloud deck over the static sky so static peeks mysteriously through gaps
    const cloudOpacity = clamp(cloudMask.mul(mix(float(0.66), float(0.95), uRain)).mul(float(1.0).sub(uStaticReveal.mul(0.24))), 0.18, 0.95);
    let col = mix(staticSky, cloudCol, cloudOpacity);
    col = mix(col, horizonCol, horizonFog.mul(0.92));

    return vec4(col, 1.0);
  })();

  return { material, uDaylight, uRain, uStaticReveal };
}

export interface WetStreetHandle {
  material: THREE.MeshBasicNodeMaterial;
  uPlayerPos: { value: THREE.Vector3 };
  uRippleOrigin: { value: THREE.Vector2 };
  uRippleAge: { value: number };
  uRain: { value: number };
  uDaylight: { value: number };
}

/**
 * Rain-slicked Neo-Tokyo Street Corner shader:
 * - Dark wet asphalt road with zebra crosswalks, glowing tram rails, and yellow/cyan lane paint
 * - Tiled wet sidewalks flanking X = +/-4.8m
 * - Glossy rain puddles reflecting rich Blade Runner crimson, amber, electric cyan, and magenta neon signs
 * - Continuous raindrop micro-rings scaled by `uRain` + live player footstep puddle splash ring!
 */
export function createWetStreetMaterial(): WetStreetHandle {
  const uPlayerPos = uniform(new THREE.Vector3(0, -100, 0));
  const uRippleOrigin = uniform(new THREE.Vector2(999, 999));
  const uRippleAge = uniform(10.0);
  const uRain = uniform(0.85);
  const uDaylight = uniform(0.15);

  const material = new THREE.MeshBasicNodeMaterial();

  material.colorNode = Fn(() => {
    const wp = positionWorld;
    const p = wp.xz;
    const ax = abs(wp.x);

    const isSidewalk = smoothstep(float(4.65), float(5.15), ax);

    // Sidewalk tactile wet tiles
    const tileU = fract(p.x.mul(0.95));
    const tileV = fract(p.y.mul(0.95));
    const mortar = smoothstep(float(0.0), float(0.05), tileU)
      .mul(float(1.0).sub(smoothstep(float(0.95), float(1.0), tileU)))
      .mul(smoothstep(float(0.0), float(0.05), tileV))
      .mul(float(1.0).sub(smoothstep(float(0.95), float(1.0), tileV)));
    const tileId = floor(p.mul(0.95));
    const tileHash = fract(sin(dot(tileId, vec2(12.9898, 78.233))).mul(43758.5453));

    // Fine wet asphalt micro-grit on the road
    const grit = fract(sin(dot(floor(p.mul(44.0)), vec2(41.1, 289.7))).mul(43758.5453)).mul(0.028);

    const dayLift = mix(float(1.0), float(1.72), uDaylight);
    const roadBase = vec3(0.045, 0.05, 0.072).add(vec3(grit, grit, grit.mul(1.1))).mul(dayLift);
    const walkBase = vec3(0.075, 0.082, 0.11)
      .add(vec3(tileHash.mul(0.04), tileHash.mul(0.042), tileHash.mul(0.05)))
      .mul(float(0.74).add(mortar.mul(0.26)))
      .mul(dayLift);

    let baseCol = mix(roadBase, walkBase, isSidewalk);

    // Zebra crosswalk stripes at Z ≈ +14.5 and Z ≈ -14.5 across the road
    const cwBandA = float(1.0).sub(smoothstep(float(1.35), float(1.55), abs(wp.z.sub(14.5))));
    const cwBandB = float(1.0).sub(smoothstep(float(1.35), float(1.55), abs(wp.z.add(14.5))));
    const cwStripe = smoothstep(float(0.32), float(0.4), fract(wp.x.mul(0.85)))
      .mul(float(1.0).sub(smoothstep(float(0.75), float(0.83), fract(wp.x.mul(0.85)))));
    const crosswalk = max(cwBandA, cwBandB).mul(cwStripe).mul(float(1.0).sub(isSidewalk));
    baseCol = mix(baseCol, vec3(0.42, 0.44, 0.48).mul(dayLift), crosswalk.mul(0.65));

    // Curb yellow tactile safety strip along X = ±4.95
    const curbLine = float(1.0).sub(smoothstep(float(0.08), float(0.18), abs(ax.sub(4.95))))
      .mul(float(1.0).sub(smoothstep(float(24.0), float(27.0), abs(wp.z))));
    baseCol = mix(baseCol, vec3(0.65, 0.48, 0.12), curbLine.mul(0.62));

    // Center dashed cyber-amber road line + glowing trolley rails near X = 2.6
    const centerDash = float(1.0).sub(smoothstep(float(0.05), float(0.1), abs(wp.x.add(0.45))))
      .mul(smoothstep(float(0.3), float(0.36), fract(wp.z.mul(0.35))));
    baseCol = mix(baseCol, vec3(0.55, 0.36, 0.14), centerDash.mul(0.5));

    const railA = float(1.0).sub(smoothstep(float(0.03), float(0.085), abs(wp.x.sub(1.95))));
    const railB = float(1.0).sub(smoothstep(float(0.03), float(0.085), abs(wp.x.sub(3.25))));
    const railGlow = max(railA, railB);
    baseCol = baseCol.add(vec3(0.18, 0.72, 0.85).mul(railGlow.mul(0.42)));

    // Organic rain puddles pooled across the road & sidewalks (always glossy after rain, richer during rain)
    const puddleWave = sin(p.x.mul(0.34).add(sin(p.y.mul(0.28)).mul(1.15)))
      .mul(cos(p.y.mul(0.31).sub(p.x.mul(0.19))))
      .add(sin(p.x.mul(0.78).add(p.y.mul(0.64))).mul(0.28));
    const wetness = mix(float(0.52), float(1.0), uRain);
    const puddleMask = smoothstep(float(-0.08), float(0.42), puddleWave).mul(wetness);

    // Fresnel mirror reflections of the 4 corner shops' neon signs!
    const viewDir = normalize(cameraPosition.sub(wp));
    const fresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 2.1);

    // Localized neon reflection pools matching each shop's real position on the corner!
    const noodleGlow = vec3(1.0, 0.34, 0.18).mul(float(1.0).sub(smoothstep(float(2.0), float(13.5), length(p.sub(vec2(-7.0, 6.2))))));
    const opticsGlow = vec3(0.12, 0.92, 0.88).mul(float(1.0).sub(smoothstep(float(2.0), float(13.5), length(p.sub(vec2(7.0, 8.2))))));
    const analogGlow = vec3(0.95, 0.25, 0.68).mul(float(1.0).sub(smoothstep(float(2.0), float(13.5), length(p.sub(vec2(-7.0, -10.8))))));
    const conbiniGlow = vec3(0.96, 0.76, 0.24).mul(float(1.0).sub(smoothstep(float(2.0), float(13.5), length(p.sub(vec2(7.0, -10.2))))));
    const ambientNeon = vec3(0.12, 0.16, 0.28).mul(dayLift);
    const reflectionCol = ambientNeon.add(noodleGlow.mul(0.62)).add(opticsGlow.mul(0.58)).add(analogGlow.mul(0.58)).add(conbiniGlow.mul(0.55));

    // Falling raindrop micro-ripples scaled by live rainIntensity
    const dropCell = fract(p.mul(1.45));
    const dropId = floor(p.mul(1.45));
    const dropSeed = fract(sin(dot(dropId, vec2(41.1, 289.7))).mul(43758.5453));
    const dropPhase = fract(time.mul(1.05).add(dropSeed));
    const dropDist = length(dropCell.sub(vec2(0.5, 0.5)));
    const dropRing = float(1.0)
      .sub(smoothstep(float(0.0), float(0.065), abs(dropDist.sub(dropPhase.mul(0.42)))))
      .mul(float(1.0).sub(dropPhase))
      .mul(puddleMask)
      .mul(uRain);

    // Expanding player footstep splash ring
    const rDist = length(p.sub(uRippleOrigin));
    const waveFront = uRippleAge.mul(2.6);
    const stepRing = float(1.0)
      .sub(smoothstep(float(0.0), float(0.4), abs(rDist.sub(waveFront))))
      .mul(float(1.0).sub(smoothstep(float(0.15), float(2.2), uRippleAge)))
      .mul(sin(rDist.sub(waveFront).mul(18.0)).mul(0.5).add(0.5));

    // Soft ambient glow around player's feet
    const footGlow = float(1.0).sub(smoothstep(float(0.2), float(2.4), length(p.sub(uPlayerPos.xz)))).mul(0.1);

    const reflected = mix(baseCol, reflectionCol, puddleMask.mul(fresnel.mul(0.72).add(0.24)));
    const finalCol = reflected
      .add(vec3(0.68, 0.92, 1.0).mul(dropRing.mul(0.36)))
      .add(vec3(0.45, 0.96, 0.95).mul(stepRing.mul(0.62)))
      .add(vec3(0.35, 0.82, 0.9).mul(footGlow));

    return vec4(finalCol, 1.0);
  })();

  return { material, uPlayerPos, uRippleOrigin, uRippleAge, uRain, uDaylight };
}

/**
 * Translucent glowing holographic koi / sky-billboard material with GPU wave undulation & scanlines.
 */
export function createHoloKoiMaterial(colorHex: string, phaseOffset: number): THREE.MeshBasicNodeMaterial {
  const baseColor = new THREE.Color(colorHex);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  material.positionNode = Fn(() => {
    const pos = positionLocal;
    const tailWeight = smoothstep(float(0.25), float(-0.75), pos.z);
    const wiggle = sin(time.mul(4.5).add(float(phaseOffset)).add(pos.z.mul(4.2))).mul(0.15).mul(tailWeight);
    return vec3(pos.x.add(wiggle), pos.y, pos.z);
  })();

  const out = Fn(() => {
    const coord = uv();
    const scanline = sin(coord.y.mul(52.0).sub(time.mul(6.5))).mul(0.2).add(0.8);
    const shimmer = sin(coord.x.mul(10.0).add(time.mul(2.2)).add(float(phaseOffset))).mul(0.15).add(0.85);
    const col = vec3(baseColor.r, baseColor.g, baseColor.b).mul(scanline).mul(shimmer).mul(1.4);
    return vec4(col, float(0.56).mul(scanline));
  })();

  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}

/**
 * Translucent holographic billboard / projection ribbon shader with flowing Blade Runner scanlines.
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
    const scan = sin(coord.y.mul(72.0).sub(time.mul(6.0))).mul(0.22).add(0.78);
    const flicker = sin(time.mul(17.0)).mul(0.04).add(0.96);
    const grad = mix(vec3(cA.r, cA.g, cA.b), vec3(cB.r, cB.g, cB.b), coord.x);
    const edgeFade = smoothstep(float(0.0), float(0.14), coord.y).mul(float(1.0).sub(smoothstep(float(0.86), float(1.0), coord.y)));
    return vec4(grad.mul(scan).mul(flicker).mul(1.25), edgeFade.mul(0.38));
  })();

  material.colorNode = out.xyz;
  material.opacityNode = out.w;
  return material;
}
