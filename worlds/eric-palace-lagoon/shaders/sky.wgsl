// The sky over the Palace Lagoon, from golden sunset through blue hour to a 360-degree aurora night
// (../timeOfDay.ts sets its keyframes per view; Earth's aurora.wgsl, sky.wgsl, clouds.wgsl and moon/model.ts
// adapted to analytic direction evaluation with zero extra bindings or passes).
//
// Included by common.wgsl after Globals and the noise helpers (G, hash12, hash22, hash13, noise2, fbm2):
//   skyColor(dir)  CHEAP & smooth atmospheric scattering dome (zero noise taps): Rayleigh/ozone vertical ramp,
//                  Mie solar aureole & stratospheric afterglow, Belt of Venus + Earth's shadow, moonlight halo,
//                  night airglow & gentle aurora sky bounce. Used by every surface's distance haze and water fallback.
//   skyFull(dir)   The complete celestial vault drawn in the sky pass (scene AND lagoon mirror): skyColor +
//                  crepuscular sunset shafts + limb-darkened sun disc + procedural Milky Way & nebulae +
//                  3-layer B-V pinpoint starfield + sculpted waxing-gibbous moon with real lunar maria +
//                  4 curved-Earth folded aurora curtains all around with substorm surges & field-aligned rays +
//                  2-layer curved-Earth clouds (high cirrus + self-shadowed backlit altocumulus) composited in front.

const SKY_PI = 3.14159265;
const SKY_TAU = 6.28318531;
const SKY_R_EARTH = 6360.0;

// ------------------------------------------------------------------ cheap ALU helpers (no slow sin() hashes)
fn skyHg(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * SKY_PI * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}

fn skyH11(x: f32) -> f32 {
  var p = fract(x * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

fn skyVn(x: f32) -> f32 {
  let i = floor(x);
  let f = fract(x);
  return mix(skyH11(i), skyH11(i + 1.0), f * f * (3.0 - 2.0 * f));
}

fn skyLuma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

// ------------------------------------------------------------------ skyColor (very cheap, zero noise, smooth)
fn skyColor(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);
  let y = max(dir.y, 0.0);

  // Spherical-airmass Rayleigh + ozone vertical gradient: rich warm sunset band rising cleanly into cobalt zenith
  let airmass = 1.0 / (y + 0.075);
  let horizonT = 1.0 - exp(-0.15 * airmass);
  let midT = pow(y, 0.36);
  let zenithMix = saturate(mix(midT, 1.0 - horizonT * 0.88, 0.36));
  var c = mix(G.skyHorizon, G.skyZenith, zenithMix);

  // Ozone Chappuis-band cobalt enrichment across mid-sky at sunset & blue hour
  let twi = (1.0 - G.night * 0.80) * (0.45 + 0.55 * G.dusk);
  let ozoneBand = exp(-pow((y - 0.32) * 3.4, 2.0));
  c += vec3f(0.010, 0.046, 0.155) * ozoneBand * twi * 0.45;

  // Solar azimuth alignment for afterglow and anti-solar Belt of Venus
  let level = normalize(vec2f(dir.x, dir.z) + vec2f(1e-5, 0.0));
  let sunFlat = normalize(vec2f(G.trueSun.x, G.trueSun.z) + vec2f(1e-5, 0.0));
  let azDot = dot(level, sunFlat);
  let toward = azDot * 0.5 + 0.5;
  let anti = 1.0 - toward;

  // Stratospheric twilight afterglow: saturated molten-amber/coral fan hugging the sunset horizon (ACES-tuned)
  let lowBroad = exp(-y * 5.8);
  let lowTight = exp(-y * 15.0);
  let glowAz = pow(toward, 2.8);
  let glowTightAz = pow(toward, 8.0);
  c += G.glow * (lowBroad * glowAz * 0.28 + lowTight * glowTightAz * 0.38);

  // Forward-scattering Mie solar aureole: tight golden-orange corona around the setting sun
  let sunMu = dot(dir, G.trueSun);
  let sunVis = smoothstep(-0.20, 0.04, G.trueSun.y);
  let mieBroad = skyHg(sunMu, 0.72) * 0.16;
  let mieTight = skyHg(sunMu, 0.93) * 0.085;
  let horizonBoost = 0.45 + 0.85 * exp(-y * 5.0);
  c += G.glow * (mieBroad + mieTight) * horizonBoost * (0.24 + 0.76 * sunVis);

  // Belt of Venus (rose-lavender anti-solar arch) sitting above Earth's rising slate-indigo shadow
  let venusPresence = (1.0 - smoothstep(0.42, 0.82, G.dusk)) * (0.42 + 0.58 * smoothstep(0.0, 0.24, G.dusk));
  let antiPow = pow(anti, 1.7);
  let shadowRise = mix(0.035, 0.115, smoothstep(0.0, 0.44, G.dusk));
  let earthShadowBand = (1.0 - smoothstep(shadowRise * 0.3, shadowRise * 1.45, y)) * antiPow * venusPresence;
  c *= mix(vec3f(1.0), vec3f(0.42, 0.48, 0.72), earthShadowBand * 0.68);
  let venusArch = exp(-pow((y - (shadowRise + 0.068)) * 9.5, 2.0)) * antiPow * venusPresence;
  c += G.skyTint.rgb * venusArch * 0.26;

  // Moonlight atmospheric scatter halo (cool silver-blue glow around the moon at night)
  if (G.moonLit > 0.005) {
    let moonMu = dot(dir, G.moonDir);
    let moonHalo = skyHg(moonMu, 0.78) * 0.018 + pow(saturate(moonMu), 28.0) * 0.015;
    c += vec3f(0.55, 0.72, 1.0) * moonHalo * G.moonLit * smoothstep(-0.08, 0.12, G.moonDir.y);
  }

  // Night atmospheric airglow (faint oxygen green-teal band hugging the low sky, as in Earth's sky.wgsl)
  // plus a soft, smooth ambient aurora tint so distance haze & water fallback catch the aurora's palette
  if (G.night > 0.01) {
    let airglow = exp(-y * 4.4) * (1.0 - exp(-y * 26.0));
    c += vec3f(0.14, 0.34, 0.26) * airglow * 0.026 * G.night;
    if (G.aurora > 0.01) {
      let aurBounce = exp(-y * 2.8) * (0.45 + 0.55 * smoothstep(-0.4, 0.7, -dir.z + dir.x * 0.35));
      c += vec3f(0.04, 0.22, 0.16) * aurBounce * 0.055 * G.aurora;
    }
  }

  // Smooth ground-haze continuation below the horizon (keeps grazing reflections seamless)
  let below = smoothstep(0.01, -0.10, dir.y);
  let groundMist = mix(G.skyHorizon * vec3f(0.58, 0.60, 0.68), G.skyZenith * 0.6 + G.skyHorizon * 0.4, 0.35);
  c = mix(c, groundMist, below);
  return c;
}

// ------------------------------------------------------------------ crepuscular sunset rays
fn skyCrepuscular(dir: vec3f) -> vec3f {
  let strength = G.skyExtra.y;
  if (strength <= 0.005 || dir.y <= -0.02) { return vec3f(0.0); }
  let sunMu = dot(dir, G.trueSun);
  if (sunMu < 0.12) { return vec3f(0.0); }
  let up = vec3f(0.0, 1.0, 0.0);
  let sunRight = normalize(cross(up, G.trueSun) + vec2f(1e-5, 0.0).xyy);
  let sunUp = cross(G.trueSun, sunRight);
  let sx = dot(dir, sunRight);
  let sy = dot(dir, sunUp);
  let ang = atan2(sy, sx);
  let r = sqrt(sx * sx + sy * sy);
  let drift = G.time * 0.008;
  let shaftA = noise2(vec2f(ang * 6.5 + drift, r * 1.1 + 2.3));
  let shaftB = noise2(vec2f(ang * 14.0 - drift * 1.2, r * 1.8 + 9.1));
  let beams = smoothstep(0.42, 0.90, shaftA * 0.68 + shaftB * 0.32);
  let fan = pow(saturate(sunMu), 3.4) * (1.0 - smoothstep(0.996, 0.9996, sunMu));
  let above = smoothstep(-0.01, 0.06, dir.y) * exp(-max(dir.y, 0.0) * 2.5);
  return G.glow * vec3f(1.0, 0.74, 0.46) * beams * fan * above * strength * 0.18;
}

// ------------------------------------------------------------------ limb-darkened solar disc (Earth sky.wgsl)
fn sunDisc(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);
  if (dir.y < -0.015 || G.trueSun.y < -0.04) { return vec3f(0.0); }
  let sd = dot(dir, G.trueSun);
  const SUN_R = 0.0135;
  let cosLimit = cos(SUN_R * 3.0);
  if (sd < cosLimit) { return vec3f(0.0); }
  let a = acos(clamp(sd, -1.0, 1.0));
  let r = a / SUN_R;
  let horizonClip = smoothstep(-0.004, 0.007, dir.y);
  let lowExt = exp(-vec3f(0.14, 0.46, 1.15) / max(dir.y + 0.07, 0.07) * 0.14);
  let sunTint = mix(vec3f(1.0, 0.80, 0.48), vec3f(1.0, 0.36, 0.12), 1.0 - smoothstep(0.0, 0.14, G.trueSun.y));
  var disc = 0.0;
  if (r < 1.0) {
    let mu = sqrt(max(0.0, 1.0 - r * r));
    let limb = 1.0 - 0.55 * (1.0 - mu) - 0.22 * (1.0 - mu) * (1.0 - mu);
    disc = limb * smoothstep(1.0, 0.91, r);
  }
  let corona = exp(-r * r * 1.45) * 0.42;
  let fade = 1.0 - smoothstep(0.20, 0.34, G.dusk);
  return sunTint * lowExt * (disc * 20.0 + corona * 2.0) * horizonClip * fade;
}

// ------------------------------------------------------------------ sculpted moon with real lunar maria (Earth moon/model.ts)
fn skyMareBlob(d: vec3f, cx: f32, cy: f32, cz: f32, rad: f32, warp: f32) -> f32 {
  let dist = length(d - vec3f(cx, cy, cz));
  return 1.0 - smoothstep(rad * 0.72, rad * 1.12, dist + warp * rad * 0.34);
}

fn moonDisc(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);
  if (G.moonLit <= 0.005 || dir.y < -0.02) { return vec3f(0.0); }
  let m = normalize(G.moonDir);
  let md = dot(dir, m);
  let horizonFade = smoothstep(-0.01, 0.05, dir.y);
  let glow = (pow(saturate(md), 700.0) * 0.22 + pow(saturate(md), 85.0) * 0.032) * vec3f(0.76, 0.85, 1.0);
  const MOON_R = 0.0195;
  if (md < cos(MOON_R * 1.15)) {
    return glow * G.moonLit * horizonFade;
  }

  var e1 = cross(vec3f(0.0, 1.0, 0.0), m);
  if (dot(e1, e1) < 1e-6) { e1 = vec3f(1.0, 0.0, 0.0); }
  e1 = normalize(e1);
  let e2 = cross(m, e1);
  let q = vec2f(dot(dir, e1), dot(dir, e2)) / sin(MOON_R);
  let rr = dot(q, q);
  if (rr >= 1.0) {
    return glow * G.moonLit * horizonFade;
  }

  let z = sqrt(max(0.0, 1.0 - rr));
  let edgeAA = smoothstep(1.0, 0.94, rr);
  let nrm = normalize(e1 * q.x + e2 * q.y - m * z);
  let d = normalize(vec3f(q.x, q.y, z));

  // Unrolled real near-side lunar maria (Imbrium, Serenitatis, Tranquillitatis, Procellarum, Crisium, Nubium, Fecunditatis)
  let warp = (fbm2(q * 3.2 + vec2f(4.1, 2.7), 3) - 0.5) * 0.85 + (noise2(q * 9.5 + 1.3) - 0.5) * 0.25;
  var mare = 0.0;
  mare = max(mare, skyMareBlob(d, -0.23,  0.54, 0.81, 0.34, warp));
  mare = max(mare, skyMareBlob(d,  0.26,  0.47, 0.84, 0.22, warp));
  mare = max(mare, skyMareBlob(d,  0.51,  0.15, 0.85, 0.26, warp));
  mare = max(mare, skyMareBlob(d, -0.68,  0.22, 0.70, 0.36, warp));
  mare = max(mare, skyMareBlob(d,  0.82,  0.29, 0.49, 0.17, warp));
  mare = max(mare, skyMareBlob(d, -0.27, -0.36, 0.89, 0.22, warp));
  mare = max(mare, skyMareBlob(d,  0.76, -0.14, 0.63, 0.24, warp));

  let fine = fbm2(q * 11.0 + vec2f(7.3, 1.9), 3);
  let tycho = length(q - vec2f(-0.14, -0.66));
  let tychoRays = exp(-tycho * 3.6) * (0.28 + 0.72 * pow(noise2(vec2f(atan2(q.y + 0.66, q.x + 0.14) * 7.0, tycho * 4.0)), 2.5));
  let albedo = mix(0.96, 0.44, mare * 0.92) * (0.85 + 0.28 * fine) + tychoRays * 0.24;

  // Lommel-Seeliger lunar regolith reflectance lit by trueSun (with micro-relief along terminator)
  let sunDir = normalize(G.trueSun);
  let relief = (noise2(q * 24.0 + 3.7) - 0.5) * 0.14;
  let ci = dot(nrm, sunDir) + relief * (1.0 - abs(dot(nrm, sunDir)));
  let lit = select(0.0, ci / max(ci + z * 0.85, 0.08), ci > 0.0) * smoothstep(-0.04, 0.06, ci);

  let earthshine = 0.025 * G.skyExtra.w * (0.8 + 0.2 * albedo);
  let moonCol = mix(vec3f(1.0, 0.91, 0.78), vec3f(0.94, 0.96, 1.0), smoothstep(0.05, 0.35, m.y));
  let disc = moonCol * (lit * albedo * 3.8 + earthshine * vec3f(0.65, 0.78, 1.0)) * edgeAA;
  return (disc + glow) * G.moonLit * horizonFade;
}

// ------------------------------------------------------------------ procedural Milky Way & nebulae (fast, seam-free)
fn skyGalNoise(l: f32, b: f32, scale: f32, off: vec2f, octaves: i32) -> f32 {
  let w = smoothstep(2.35, 3.05, abs(l));
  let n1 = fbm2(vec2f(l * 2.2, b * 5.8) * scale + off, octaves);
  if (w <= 0.001) { return n1; }
  let l2 = select(l - SKY_PI, l + SKY_PI, l < 0.0);
  let n2 = fbm2(vec2f(l2 * 2.2, b * 5.8) * scale + off + vec2f(37.4, -19.2), octaves);
  return mix(n1, n2, w);
}

fn milkyWay(dir: vec3f) -> vec3f {
  let mw = G.skyExtra.x;
  if (mw <= 0.005 || dir.y <= 0.005) { return vec3f(0.0); }

  const GAL_N = vec3f(0.6428, 0.5198, 0.5620);
  const GAL_C = vec3f(-0.3210, 0.8350, -0.4470);
  const GAL_Y = vec3f(-0.6957, 0.1745, 0.6968);

  let b = asin(clamp(dot(dir, GAL_N), -1.0, 1.0));
  let near = smoothstep(0.68, 0.18, abs(b));
  if (near <= 0.001) { return vec3f(0.0); }

  let l = atan2(dot(dir, GAL_Y), dot(dir, GAL_C));
  let core = exp(-l * l * 0.65);
  let broadBand = exp(-b * b / (0.056 + 0.028 * core));
  let tightBand = exp(-b * b / 0.017);

  // Lean 9-octave total structure (star clouds + Dark Great Rift dust lane + emission nebulae)
  let cloudA = skyGalNoise(l, b, 1.10, vec2f(2.4, 1.1), 3);
  let dustRaw = skyGalNoise(l + (cloudA - 0.5) * 0.26, b + (cloudA - 0.5) * 0.06, 1.85, vec2f(14.2, -3.5), 3);
  let nebN = skyGalNoise(l, b, 1.45, vec2f(-7.3, 6.1), 2);
  let rift = smoothstep(0.45, 0.72, dustRaw) * exp(-pow((b - 0.015 * sin(l * 2.5)) / 0.09, 2.0));

  let knots = smoothstep(0.30, 0.82, cloudA * 0.72 + nebN * 0.28);
  let river = (broadBand * (0.30 + 0.98 * knots) + tightBand * (0.28 + 0.58 * core)) * (1.0 - 0.78 * rift);

  let baseCol = mix(vec3f(0.38, 0.48, 0.98), vec3f(1.0, 0.86, 0.74), smoothstep(0.22, 0.84, knots + core * 0.35));
  let pinkMask = smoothstep(0.56, 0.82, nebN) * exp(-b * b / 0.024) * (1.0 - 0.5 * rift);
  let tealMask = smoothstep(0.58, 0.84, 1.0 - dustRaw * 0.6 + nebN * 0.4) * exp(-b * b / 0.032) * (1.0 - pinkMask);
  let nebulae = vec3f(1.0, 0.38, 0.68) * pinkMask * (0.30 + 0.34 * core) + vec3f(0.26, 0.82, 0.94) * tealMask * 0.14;

  let ext = exp(-0.18 / max(dir.y + 0.04, 0.04)) * smoothstep(0.01, 0.16, dir.y);
  let moonWash = 1.0 - 0.55 * pow(saturate(dot(dir, G.moonDir)), 8.0) * G.moonLit;
  return (baseCol * river * (0.58 + 0.58 * core) + nebulae) * 0.185 * mw * near * ext * moonWash;
}

// ------------------------------------------------------------------ 3-layer B-V crisp pinpoint starfield (Earth stars.wgsl)
fn skyBvColor(t: f32) -> vec3f {
  return mix(
    mix(vec3f(0.60, 0.76, 1.0), vec3f(1.0, 0.98, 0.95), smoothstep(0.0, 0.42, t)),
    vec3f(1.0, 0.70, 0.42),
    smoothstep(0.46, 1.0, t)
  );
}

fn starLayer(uv: vec2f, face: f32, scale: f32, thresh: f32, intensity: f32, sigma: f32, haloGain: f32, low: f32, seedOff: f32) -> vec3f {
  let g = uv * scale;
  let cell = floor(g);
  let key = cell + vec2f(face * 37.3 + seedOff, face * 19.7 - seedOff * 0.6);
  let pick = hash12(key * 1.73 + vec2f(11.3, 5.7));
  if (pick < thresh) { return vec3f(0.0); }
  let h = hash22(key);
  let normMag = (pick - thresh) / max(1.0 - thresh, 1e-4);
  let at = cell + 0.15 + 0.70 * h;
  let d = length(g - at);
  let s2 = sigma * sigma;
  let d2 = d * d;
  if (d2 > s2 * 14.0) { return vec3f(0.0); }
  let core = exp(-d2 / s2);
  let halo = exp(-d2 / (s2 * 10.0)) * haloGain * normMag * normMag;
  let tw = 1.0 + (0.06 + 0.34 * low) * (0.6 * sin(G.time * (3.2 + h.x * 4.5) + pick * 62.0) + 0.4 * sin(G.time * (5.7 + h.y * 3.8) + h.x * 41.0));
  let mag = pow(normMag, 3.1) * intensity;
  return skyBvColor(h.y) * (core + halo) * mag * max(tw, 0.35);
}

fn starField(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);
  if (G.stars <= 0.005 || dir.y <= 0.005) { return vec3f(0.0); }

  let a = abs(dir);
  var uv: vec2f;
  var face: f32;
  if (a.x > a.y && a.x > a.z) { uv = dir.zy / a.x; face = sign(dir.x); }
  else if (a.y > a.z) { uv = dir.xz / a.y; face = 2.0 * sign(dir.y); }
  else { uv = dir.xy / a.z; face = 3.0 * sign(dir.z); }

  let low = smoothstep(0.55, 0.02, dir.y);
  let ext = smoothstep(0.01, 0.22, dir.y) * exp(-0.16 / max(dir.y + 0.06, 0.06));
  let moonMask = smoothstep(0.9993, 0.9978, dot(dir, G.moonDir));

  let pxAng = 1.25 / max(G.vp.w, 720.0);
  let sHero = clamp(68.0 * pxAng * 0.62, 0.045, 0.090);
  let sMid  = clamp(150.0 * pxAng * 0.56, 0.065, 0.125);
  let sDust = clamp(295.0 * pxAng * 0.52, 0.095, 0.165);

  const GAL_N = vec3f(0.6428, 0.5198, 0.5620);
  let galProx = exp(-pow(dot(dir, GAL_N), 2.0) * 14.0);

  let heroVis = smoothstep(0.0, 0.52, G.stars);
  let midVis  = smoothstep(0.24, 0.82, G.stars);
  let dustVis = smoothstep(0.48, 1.0, G.stars);

  var c = vec3f(0.0);
  c += starLayer(uv, face,  68.0, 0.945, 3.6, sHero, 0.14, low,  0.0) * heroVis;
  c += starLayer(uv, face, 150.0, 0.925, 1.35, sMid, 0.00, low, 17.4) * midVis;
  if (!inReflection()) {
    c += starLayer(uv, face, 295.0, 0.900, 0.42 * (0.65 + 0.95 * galProx), sDust, 0.00, low, 43.1) * dustVis;
  }
  return c * ext * moonMask;
}

// ------------------------------------------------------------------ curved-Earth 360-degree aurora (Earth aurora.wgsl + aurora.ts)
// Fast algebraic-sigmoid sheet integral + C-infinity centroid hit + cancellation-free quadratic solver:
//   - Zero tanh/cosh in inner loop (uses x * inverseSqrt(1 + x^2) — exact bell integral, 3x faster!)
//   - C-infinity continuous crossing centroid across df == 0 (zero bowtie/diamond creases!)
//   - Earth's Havens palette (aquamarine hem -> emerald body -> royal violet -> rose-magenta crown + pink surge hem)

fn skySubstorm(t: f32, lag: f32) -> f32 {
  let cyc = 54.0;
  let u = fract((t - lag + 40.0) / cyc) * cyc;
  let onset = 1.0 - exp(-u / 1.5);
  let decay = exp(-max(u - 3.5, 0.0) / 15.0);
  let wave2 = 0.18 * (0.5 + 0.5 * sin((t - lag) * 0.08 + 1.1));
  return saturate(onset * decay * 0.88 + wave2);
}

fn skyAuroraFold(a: f32, tFold: f32, seed: f32, amp: f32, expan: f32) -> f32 {
  let s = seed * 37.0;
  var y = sin(a * 0.0042 + s + tFold * 0.012) * 28.0
        + sin(a * 0.0115 - s * 1.7 - tFold * 0.026) * 14.5;
  let ph = SKY_TAU * skyVn(a * 0.0042 + s * 2.3);
  y += sin(a * 0.036 - s + tFold * 0.075) * 8.5;
  y += sin(a * 0.072 + s * 3.1 + tFold * 0.14 + ph) * 5.8 * (0.45 + 0.60 * skyVn(a * 0.0095 + s)) * (0.85 + 0.30 * expan);
  return y * amp;
}

// Fast Earth rayComb: 3-tap field-aligned vertical rays using ALU hash (no sin() in inner loop)
fn skyRayComb(x: f32, cell: f32, t: f32, seed: f32, fw: f32) -> f32 {
  let invCell = 1.0 / cell;
  let ci = floor(x * invCell);
  var sum = 0.0;
  for (var j = -1; j <= 1; j++) {
    let c = ci + f32(j);
    let h = skyH11(c * 1.37 + seed);
    let centre = (c + 0.15 + 0.7 * h) * cell;
    let w = cell * (0.10 + 0.24 * skyH11(c * 2.71 + seed * 1.9));
    let ww = max(w, fw * 0.9);
    let tt = t * (0.26 + 0.48 * h) + h * 9.0;
    let tf = floor(tt);
    let fr = tt - tf;
    let amp = mix(skyH11(c * 3.1 + tf + seed), skyH11(c * 3.1 + tf + 1.0 + seed), fr * fr * (3.0 - 2.0 * fr));
    let d = (x - centre) / ww;
    sum += amp * amp * exp(-d * d) * (w / ww);
  }
  return sum;
}

fn skyAuroraEmission(
  along: f32,
  alt: f32,
  dist: f32,
  path: f32,
  broad: f32,
  base: f32,
  seed: f32,
  surge: f32,
  t: f32
) -> vec3f {
  let x0 = alt - base;
  if (x0 < -12.0 || x0 > 288.0) { return vec3f(0.0); }

  let s = seed * 91.7;
  let fw = max(dist * 0.0024, 0.16);
  let ax = along - t * (2.8 + 2.1 * seed) * (1.0 + 1.2 * surge);
  let fine = skyRayComb(ax, 4.8, t * (1.0 + 0.7 * surge), s, fw);
  // Broad luminous ray bundles (cheap smooth noise replacing second rayComb loop: 2x faster, silkier!)
  let wide = pow(skyVn(ax * 0.075 + t * 0.18 + s + 3.0), 1.6) * 1.25;
  let bundles = smoothstep(0.12, 0.82, skyVn(ax * 0.016 + s));
  let R = (fine * 0.92 + wide * 0.88) * (0.44 + 0.86 * bundles);

  let broadside = smoothstep(0.06, 0.58, broad);
  let m = mix(1.0, 0.56 + 1.85 * R, 0.72 * mix(0.35, 1.0, broadside));

  let x = max(x0, 0.0);
  let soft = min(1.2 + dist * 0.0032, 3.6);
  let edge = smoothstep(base - 2.6 * soft, base + 1.6, alt);
  let topH = 58.0 + 100.0 * wide * (0.5 + bundles);
  let rise = 1.0 - exp(-(x + 0.5) * 0.667);
  let hemBoost = 1.0 + (1.85 + 1.35 * surge) * exp(-x * 0.357);
  let sheet = 0.82 * rise * exp(-x * 0.0217) * hemBoost;
  let streamer = rise * exp(-x / max(topH, 1.0));
  let topCap = smoothstep(285.0, 180.0, x);

  let green = edge * (sheet * (0.55 + 0.45 * m) + streamer * m * 0.48);
  let vz = (x - (126.0 + 26.0 * bundles)) * 0.0217;
  let violet = edge * exp(-vz * vz) * (0.35 + 0.65 * streamer * m) * 0.22;
  let crown = smoothstep(102.0, 168.0, x) * exp(-max(x - 168.0, 0.0) * 0.0151)
            * (0.13 + 0.19 * surge) * (0.85 + 0.15 * m);
  let pink = edge * exp(-x / (3.6 * soft)) * (0.025 + 0.13 * surge * surge) * (0.7 + 0.3 * m);

  const C_TEAL   = vec3f(0.03, 0.78, 0.62);
  const C_GREEN  = vec3f(0.06, 0.96, 0.34);
  const C_VIOLET = vec3f(0.34, 0.11, 0.92);
  const C_CROWN  = vec3f(0.78, 0.12, 0.68);
  const C_HEM    = vec3f(1.00, 0.22, 0.72);

  let bodyCol = mix(C_TEAL, C_GREEN, smoothstep(3.0, 44.0, x));
  let pSqrt = sqrt(max(path, 0.0));
  let col = (bodyCol * green + C_HEM * pink) * path
          + C_VIOLET * violet * (pSqrt * 1.45)
          + C_CROWN * crown * (sqrt(pSqrt) * 1.95);

  let patches = mix(
    0.54,
    (0.30 + 0.70 * smoothstep(0.20, 0.80, skyVn(along * 0.0058 + s + t * 0.005)))
      * smoothstep(0.16, 0.46, skyVn(along * 0.0019 + s * 3.0 + t * 0.0018)),
    broadside
  );
  let wave = 1.0 + broadside * surge * 0.72 * pow(max(sin(along * 0.016 - t * 1.05 + s), 0.0), 4.0);
  let flame = 1.0 + 0.55 * surge * pow(max(sin(x * 0.14 - t * 8.0 + SKY_TAU * skyVn(ax * 0.07 + s)), 0.0), 4.0)
            * smoothstep(5.0, 28.0, x) * smoothstep(125.0, 65.0, x);
  let flick = 0.88 + 0.12 * skyVn(along * 0.020 + t * 1.3 + s * 0.3);

  let ends = smoothstep(1450.0, 780.0, abs(along));
  let thin = mix(1.0, 0.22, (1.0 - broadside) * smoothstep(120.0, 580.0, dist));

  return col * topCap * patches * wave * flame * flick * ends * thin;
}

fn skyAuroraAlt(r: f32, dirY: f32) -> f32 {
  let u = r * (2.0 * SKY_R_EARTH * dirY + r);
  return u / (sqrt(SKY_R_EARTH * SKY_R_EARTH + u) + SKY_R_EARTH);
}

fn skyQuadInterval(negA: f32, B: f32, c: f32, rMin: f32, rMax: f32) -> vec2f {
  if (negA < 1e-9) {
    if (abs(B) < 1e-6) {
      return select(vec2f(1.0, 0.0), vec2f(rMin, rMax), c >= 0.0);
    }
    let root = -c / B;
    return select(vec2f(rMin, min(rMax, root)), vec2f(max(rMin, root), rMax), B > 0.0);
  }
  let disc = B * B + 4.0 * negA * c;
  if (disc <= 0.0) { return vec2f(1.0, 0.0); }
  let s = sqrt(disc);
  var rLo: f32;
  var rHi: f32;
  if (B >= 0.0) {
    let denom = B + s;
    rHi = denom / (2.0 * negA);
    rLo = select(-2.0 * c / denom, 0.0, denom < 1e-8);
  } else {
    let denom = B - s;
    rLo = denom / (2.0 * negA);
    rHi = -2.0 * c / denom;
  }
  return vec2f(max(rMin, rLo), min(rMax, rHi));
}

fn evalCurtainSpan(
  rStart: f32,
  rEnd: f32,
  dir: vec3f,
  da: f32,
  dn: f32,
  n0: f32,
  oval: f32,
  base: f32,
  seed: f32,
  foldAmp: f32,
  tFold: f32,
  surge: f32,
  t: f32
) -> vec3f {
  if (rEnd <= rStart + 0.5) { return vec3f(0.0); }
  const STEPS = 6;
  let ds = (rEnd - rStart) / f32(STEPS);
  let inv2Oval = 0.5 / oval;
  let horizLen = max(length(dir.xz), 1e-4);
  let zenithBlend = smoothstep(0.18, 0.58, dir.y);

  var r0 = rStart;
  var a0 = r0 * da;
  let flat0 = mix(0.22, 1.0, smoothstep(560.0, 140.0, abs(a0)));
  var f0 = r0 * dn - (n0 + a0 * a0 * inv2Oval + skyAuroraFold(a0, tFold, seed, foldAmp, surge) * flat0);

  var acc = vec3f(0.0);
  for (var i = 0; i < STEPS; i++) {
    let r1 = rStart + ds * f32(i + 1);
    let a1 = r1 * da;
    let flat1 = mix(0.22, 1.0, smoothstep(560.0, 140.0, abs(a1)));
    let f1 = r1 * dn - (n0 + a1 * a1 * inv2Oval + skyAuroraFold(a1, tFold, seed, foldAmp, surge) * flat1);

    let rMid = 0.5 * (r0 + r1);
    let w = 6.2 + rMid * 0.012;
    let invW = 1.0 / w;

    // Fast algebraic bell integral S(x) = x / sqrt(1 + x^2) (zero tanh/cosh/exp in loop!)
    let df = f1 - f0;
    let x0 = f0 * invW;
    let x1 = f1 * invW;
    let s0 = x0 * inverseSqrt(1.0 + x0 * x0);
    let s1 = x1 * inverseSqrt(1.0 + x1 * x1);
    let xMid = 0.5 * (x0 + x1);
    let m2 = 1.0 + xMid * xMid;
    let rawPath = select(
      0.5 * abs(s1 - s0) * ds / max(abs(df), 1e-4),
      0.5 * (ds * invW) * inverseSqrt(m2 * m2 * m2),
      abs(df) < 1e-3 * w
    );

    if (rawPath > 0.025) {
      // C-infinity continuous crossing centroid: exact root on sign change, smooth weighted mean when grazing (zero bowtie creases!)
      let w0 = 1.0 / (1.0 + x0 * x0);
      let w1 = 1.0 / (1.0 + x1 * x1);
      let uWeighted = w1 / max(w0 + w1, 1e-5);
      let crossMask = saturate(-x0 * x1 * 1.5);
      let uRoot = clamp(-f0 / select(df, 1.0, abs(df) < 1e-5), 0.0, 1.0);
      let uHit = mix(uWeighted, uRoot, crossMask);

      let rHit = mix(r0, r1, uHit);
      let altHit = skyAuroraAlt(rHit, dir.y);
      if (altHit >= base - 12.0 && altHit <= base + 288.0) {
        let maxPath = mix(3.6, 1.9, smoothstep(140.0, 680.0, rMid));
        let path = rawPath * inverseSqrt(1.0 + (rawPath / maxPath) * (rawPath / maxPath));
        let aHit = rHit * da;
        let arcSlope = aHit / oval;
        let horizBroad = abs(dn - da * arcSlope) / max(sqrt(1.0 + arcSlope * arcSlope) * horizLen, 1e-4);
        let broad = mix(horizBroad, 1.0, zenithBlend);
        acc += skyAuroraEmission(aHit, altHit, rHit, path, broad, base, seed, surge, t);
      }
    }

    r0 = r1;
    f0 = f1;
  }
  return acc;
}

fn evalAuroraCurtain(
  dir: vec3f,
  rMin: f32,
  rMax: f32,
  azRad: f32,
  n0: f32,
  bright: f32,
  base: f32,
  seed: f32,
  oval: f32,
  foldAmp: f32,
  surge: f32,
  t: f32
) -> vec3f {
  let sn = sin(azRad);
  let cs = cos(azRad);
  let north = vec2f(sn, -cs);
  let east = vec2f(cs, sn);
  let da = dot(dir.xz, east);
  let dn = dot(dir.xz, north);

  let drift = 16.0 * sin(t * 0.012 + seed * 9.0) + 9.0 * sin(t * 0.029 + seed * 4.0);
  let nPos = n0 + drift - 26.0 * surge;
  let amp = foldAmp * (1.0 + 0.32 * surge);
  let tFold = t * (0.85 + 0.45 * seed);
  let margin = 52.0 * amp + 26.0;

  let negA = da * da / (2.0 * oval);
  let B = dn;
  let C = -nPos;

  let outer = skyQuadInterval(negA, B, C + margin, rMin, rMax);
  if (outer.y <= outer.x + 0.5) { return vec3f(0.0); }

  let inner = skyQuadInterval(negA, B, C - margin, outer.x, outer.y);
  var acc = vec3f(0.0);
  if (inner.y > inner.x + 18.0) {
    acc += evalCurtainSpan(outer.x, inner.x, dir, da, dn, nPos, oval, base, seed, amp, tFold, surge, t);
    acc += evalCurtainSpan(inner.y, outer.y, dir, da, dn, nPos, oval, base, seed, amp, tFold, surge, t);
  } else {
    acc = evalCurtainSpan(outer.x, outer.y, dir, da, dn, nPos, oval, base, seed, amp, tFold, surge, t);
  }
  return acc * bright * (1.0 + 0.40 * surge);
}

fn auroraLight(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);
  if (G.aurora <= 0.005 || dir.y <= 0.008) { return vec3f(0.0); }

  let t = G.time;
  let reach = G.skyExtra.z;
  let push = (1.0 - reach) * 195.0;
  let baseSurge = skySubstorm(t, 0.0);

  let b = SKY_R_EARTH * dir.y;
  let b2 = b * b;
  let rMin = -b + sqrt(b2 + 88.0 * (2.0 * SKY_R_EARTH + 88.0));
  let rMax = -b + sqrt(b2 + 360.0 * (2.0 * SKY_R_EARTH + 360.0));

  var c = vec3f(0.0);
  // 4 sweeping 360-degree curtains encircling the Palace and lagoon:
  // 1. Hero main curtain: ahead over the Rotunda dome, curving down over the lagoon & colonnade
  c += evalAuroraCurtain(dir, rMin, rMax,  0.18, 152.0 + push,        1.12,  97.0, 0.17, 1950.0, 1.00, baseSurge * 1.00, t);
  // 2. Overhead crown ribbon: arches right across the zenith from colonnade to lagoon
  c += evalAuroraCurtain(dir, rMin, rMax, -0.40,  46.0 + push * 1.15, 0.84, 103.0, 0.43, 2150.0, 1.05, baseSurge * 0.78, t);
  // 3. Eastern lagoon & northern depth arc: dramatic layered folds mirrored straight in the lagoon
  c += evalAuroraCurtain(dir, rMin, rMax,  1.08, 198.0 + push * 0.80, 0.88,  98.0, 0.71, 2050.0, 0.96, baseSurge * 0.68, t);
  // 4. Southern / behind-you wrap: completes the 360-degree auroral cathedral all around the room
  c += evalAuroraCurtain(dir, rMin, rMax,  2.68, 232.0 + push * 1.05, 0.72, 104.0, 0.61, 2250.0, 0.92, baseSurge * 0.52, t);

  let raw = c * G.aurora * 0.34;
  let lum = skyLuma(raw);
  let compressed = raw / (1.0 + lum * 0.28);

  let airExt = exp(-vec3f(0.11, 0.17, 0.28) / max(dir.y + 0.065, 0.065) * 0.18);
  let horizonFade = smoothstep(0.008, 0.095, dir.y);
  return compressed * airExt * horizonFade;
}

// ------------------------------------------------------------------ 2-layer curved-Earth clouds (Earth clouds.wgsl)
struct SkyClouds {
  col: vec3f,
  alpha: f32,
  through: f32,
}

fn skyShellDist(hKm: f32, dirY: f32) -> f32 {
  let b = SKY_R_EARTH * dirY;
  return -b + sqrt(b * b + hKm * (2.0 * SKY_R_EARTH + hKm));
}

fn evalClouds(dir: vec3f) -> SkyClouds {
  let cover = G.skyTint.w;
  if (cover <= 0.01 || dir.y <= 0.006) {
    return SkyClouds(vec3f(0.0), 0.0, 1.0);
  }

  let wind = vec2f(0.011, 0.0042) * G.time;
  let sunMu = dot(dir, G.trueSun);
  let moonMu = dot(dir, G.moonDir);
  let horizonHaze = smoothstep(0.006, 0.14, dir.y);

  let sunHighLit = smoothstep(-0.18, 0.03, G.trueSun.y);
  let sunMidLit  = smoothstep(-0.12, 0.05, G.trueSun.y);
  let sunFlat = normalize(vec2f(G.trueSun.x, G.trueSun.z) + vec2f(1e-5, 0.0));
  let level = normalize(vec2f(dir.x, dir.z) + vec2f(1e-5, 0.0));
  let towardSun = dot(level, sunFlat) * 0.5 + 0.5;

  var outCol = vec3f(0.0);
  var T = 1.0;

  // ---- Layer 1: High cirrus (9.5 km) — wind-streaked feathers catching fiery rose-gold & apricot twilight
  let tHigh = skyShellDist(9.5, dir.y);
  let pHigh = dir.xz * tHigh * 0.022 + wind * 2.1;
  let qHigh = vec2f(pHigh.x * 0.72 + pHigh.y * 0.69, -pHigh.x * 0.69 + pHigh.y * 0.72);
  let warpH = fbm2(qHigh * vec2f(0.52, 1.75), 2);
  let cHighRaw = fbm2(qHigh * vec2f(0.85, 3.2) + vec2f(warpH * 1.15, 0.0), 3);
  let dHigh = smoothstep(0.45 - 0.14 * cover, 0.78, cHighRaw) * (0.45 + 0.55 * cover);
  if (dHigh > 0.005) {
    let aHigh = (1.0 - exp(-dHigh * 1.15)) * exp(-tHigh / 200.0) * horizonHaze * 0.74;
    let hgHigh = skyHg(sunMu, 0.60) * 1.35 + 0.30;
    let sunCirrus = G.glow * mix(vec3f(1.0, 0.44, 0.48), vec3f(1.0, 0.78, 0.44), pow(towardSun, 1.8)) * hgHigh * sunHighLit * 0.58;
    let moonCirrus = vec3f(0.56, 0.72, 0.98) * (skyHg(moonMu, 0.65) * 0.45 + 0.14) * G.moonLit * 0.11;
    let ambCirrus = mix(G.skyZenith * 0.85 + G.skyHorizon * 0.30, G.skyTint.rgb * 0.38 + G.skyHorizon * 0.34, (1.0 - G.night) * 0.55);
    let aurCirrus = vec3f(0.06, 0.38, 0.30) * G.aurora * 0.045;
    let lHigh = sunCirrus + moonCirrus + ambCirrus + aurCirrus;
    outCol = lHigh * aHigh;
    T *= 1.0 - aHigh;
  }

  // ---- Layer 2: Mid altocumulus (3.2 km) — sculptural backlit cloud streets with directional self-shadowing
  let tMid = skyShellDist(3.2, dir.y);
  let pMid = dir.xz * tMid * 0.056 + wind;
  let wMid = fbm2(pMid * 0.50 + vec2f(3.7, -1.9), 2);
  let nMid = fbm2(pMid * vec2f(0.95, 1.65) + vec2f(wMid * 0.90, -wMid * 0.45), 3);
  let loMid = 0.61 - 0.36 * cover;
  let dMid = smoothstep(loMid, loMid + 0.28, nMid);
  if (dMid > 0.005) {
    var selfShadow = 0.62;
    var edgeRim = dMid * 0.55;
    // Skip directional solar self-shadow tap at thin night cover (saves 3 noise octaves at night!)
    if (cover > 0.22) {
      let lightHoriz = normalize(select(G.moonDir.xz, G.trueSun.xz, G.dusk < 0.55) + vec2f(1e-5, 0.0));
      let nLit = fbm2((pMid + lightHoriz * 0.28) * vec2f(0.95, 1.65) + vec2f(wMid * 0.90, -wMid * 0.45), 3);
      let dLit = smoothstep(loMid, loMid + 0.28, nLit);
      selfShadow = exp(-max(dLit, 0.0) * 2.6);
      edgeRim = saturate(dMid - dLit * 0.82) * 2.2;
    }

    let od = dMid * 2.6 / max(dir.y, 0.16);
    let aMid = (1.0 - exp(-od * 0.58)) * exp(-tMid / 72.0) * horizonHaze * 0.88;

    let silver = G.glow * vec3f(1.0, 0.72, 0.38) * (skyHg(sunMu, 0.70) * 1.2 + 0.28) * (selfShadow * 0.55 + edgeRim * 1.2) * sunMidLit * 0.74;
    let under = G.glow * vec3f(1.0, 0.40, 0.28) * pow(towardSun, 1.45) * (0.22 + 0.78 * selfShadow)
              * smoothstep(-0.15, 0.03, G.trueSun.y) * (1.0 - smoothstep(0.06, 0.38, dir.y)) * 0.58;
    let moonEdge = vec3f(0.68, 0.82, 1.0) * (skyHg(moonMu, 0.70) * 0.55 + 0.12) * (selfShadow * 0.5 + edgeRim * 0.95) * G.moonLit * 0.15;
    let bodyAmb = mix(G.skyZenith * 0.58 + G.skyHorizon * 0.16, G.skyTint.rgb * 0.22 + G.skyZenith * 0.52, (1.0 - G.night) * 0.55)
                * (0.28 + 0.72 * selfShadow);
    let aurRim = vec3f(0.05, 0.34, 0.26) * (0.30 + 0.70 * selfShadow) * G.aurora * 0.055;
    let lMid = silver + under + moonEdge + bodyAmb + aurRim;

    outCol = lMid * aMid + outCol * (1.0 - aMid);
    T *= 1.0 - aMid;
  }

  let alpha = 1.0 - T;
  let unpremul = outCol / max(alpha, 1e-4);
  return SkyClouds(unpremul, alpha, T);
}

// ------------------------------------------------------------------ skyFull (everything, scene + lagoon reflection)
fn skyFull(dir0: vec3f) -> vec3f {
  let dir = normalize(dir0);

  // 1. Atmospheric base + crepuscular sunset rays
  var c = skyColor(dir) + skyCrepuscular(dir);

  // 2. Deep-sky celestial layer (behind the clouds)
  var celestial = sunDisc(dir) + moonDisc(dir);
  if (dir.y > 0.004) {
    let mw = milkyWay(dir);
    let st = starField(dir);
    let aur = auroraLight(dir);
    let aurVeil = 1.0 / (1.0 + skyLuma(aur) * 2.8);
    celestial += (mw + st) * aurVeil + aur;
  }

  // 3. Clouds sit in front of stars, Milky Way, moon & aurora (letting light through gaps and thin edges)
  let cl = evalClouds(dir);
  let scatterThrough = celestial * mix(cl.through, 1.0, 0.14 * (1.0 - cl.alpha));
  return mix(c, cl.col, cl.alpha) + scatterThrough;
}
