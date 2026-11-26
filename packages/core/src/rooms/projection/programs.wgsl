// Solarpunk projection-mapping visual programs.
// Pure WGSL library — no bindings, no @group, no entry points, no #include.
// Included by the projection compute shader; all helpers/consts are prefixed `pj_`.
//
// Program directory (index -> name -> intent):
//   0 -> lagoon_caustics        -> Sunlit water refraction webs and bright focusing cusps drifting across stone.
//   1 -> komorebi               -> Dappled warm sunlight filtering through a slowly swaying layered leaf canopy.
//   2 -> art_nouveau_vines      -> Maybeck / Art Nouveau botanical arches, sinuous tendrils, and glowing buds.
//   3 -> stained_venation       -> Leaf-vein and dragonfly-wing cellular filigree lit like conservatory stained glass.
//   4 -> sunflower_phyllotaxis  -> Golden-angle Fibonacci botanical rosette slowly turning and breathing (dome oculus).
//   5 -> unfurling_ferns        -> Arching fern fronds and curled fiddlehead tips swaying in emerald and gilded light.
//   6 -> mycelial_pulse         -> Organic mycelial and root light filaments carrying slow bioluminescent pulses.
//   7 -> pollen_drift           -> Weightless dandelion seed tufts and golden pollen motes on evening air currents.

const PROGRAM_COUNT: u32 = 8u;

// ---------------------------------------------------------------- constants & linear palette
const pj_PI: f32 = 3.14159265;
const pj_TAU: f32 = 6.28318530;

// Restrained linear-RGB solarpunk palette (calibrated for additive projection on cream/ochre/salmon stone)
const pj_IVORY: vec3f = vec3f(1.00, 0.90, 0.68);
const pj_GOLD: vec3f  = vec3f(0.96, 0.56, 0.14);
const pj_AMBER: vec3f = vec3f(0.82, 0.34, 0.06);
const pj_LEAF: vec3f  = vec3f(0.16, 0.58, 0.17);
const pj_SAGE: vec3f  = vec3f(0.32, 0.56, 0.23);
const pj_TEAL: vec3f  = vec3f(0.07, 0.54, 0.47);
const pj_CORAL: vec3f = vec3f(0.90, 0.27, 0.18);

// ---------------------------------------------------------------- time, math & noise helpers
fn pj_phase(t: f32, period: f32, offset: f32) -> f32 {
  return fract(t / period + offset) * pj_TAU;
}

fn pj_breath(t: f32, period: f32, seed: f32) -> f32 {
  return 0.87 + 0.13 * sin(pj_phase(t, period, seed));
}

fn pj_rot(a: f32) -> mat2x2f {
  let c = cos(a);
  let s = sin(a);
  return mat2x2f(c, -s, s, c);
}

fn pj_wrapCell(id: vec2f, tile: f32) -> vec2f {
  return id - floor(id / tile) * tile;
}

fn pj_hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn pj_hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

fn pj_noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  // Quintic interpolation keeps gradients smooth on curved architectural surfaces
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = pj_hash12(i);
  let b = pj_hash12(i + vec2f(1.0, 0.0));
  let c = pj_hash12(i + vec2f(0.0, 1.0));
  let d = pj_hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn pj_fbm2(p: vec2f) -> f32 {
  var s = 0.0;
  s += 0.62 * pj_noise2(p);
  s += 0.38 * pj_noise2(p * 2.04 + vec2f(13.7, 7.9));
  return s;
}

// Single 3x3 animated Voronoi pass returning:
//   x: distance to cell border (sqrt(d2) - sqrt(d1))
//   y: proximity to triple junction (sqrt(d3) - sqrt(d1))
//   z: closest cell hash A (0..1)
//   w: closest cell hash B (0..1)
fn pj_voronoi3(p: vec2f, driftPhase: f32, driftAmp: f32) -> vec4f {
  let n = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  var d3 = 8.0;
  var id = vec2f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let h = pj_hash22(n + g);
      let o = 0.5 + driftAmp * sin(driftPhase + h * pj_TAU);
      let r = g + o - f;
      let d = dot(r, r);
      if (d < d1) {
        d3 = d2;
        d2 = d1;
        d1 = d;
        id = h;
      } else if (d < d2) {
        d3 = d2;
        d2 = d;
      } else if (d < d3) {
        d3 = d;
      }
    }
  }
  let s1 = sqrt(d1);
  let s2 = sqrt(d2);
  let s3 = sqrt(d3);
  return vec4f(s2 - s1, s3 - s1, id.x, id.y);
}

// Pointed botanical leaf SDF in local coords (origin at base, grows along +y to length `len`)
fn pj_sdLeaf(p: vec2f, len: f32, wid: f32) -> f32 {
  let s = clamp(p.y / max(len, 1e-4), 0.0, 1.0);
  // Graceful almond profile: fuller at ~38% height, pointed tip and slender stem base
  let profile = sin(pow(s, 0.80) * pj_PI) * wid;
  let dy = max(max(-p.y, p.y - len), 0.0);
  let dx = abs(p.x) - profile;
  if (dy > 0.0) {
    return length(vec2f(max(dx, 0.0), dy));
  }
  return dx;
}

// ================================================================ 0: LAGOON CAUSTICS
// Iterative curled-phase water refraction caustic network: crisp luminous webbing
// with bright focal cusps, calm dark water pockets, and subtle gold/sea-glass dispersion.
fn pj_causticWeb(p: vec2f, ph: f32) -> f32 {
  // Shift into the -250 domain so refractive fold inversion stays well-conditioned everywhere
  let q = p * pj_TAU - vec2f(250.0);
  var i = q;
  var c = 1.0;
  let inten = 0.0052;

  for (var n = 0; n < 4; n++) {
    // Integer multiples of `ph` guarantee 100% seamless periodicity with zero pop at wrap
    let dir = select(-1.0, 1.0, (n & 1) == 0);
    let tn = ph * dir * f32(1 + (n / 2));
    i = q + vec2f(
      cos(tn - i.x) + sin(tn + i.y),
      sin(tn - i.y) + cos(tn + i.x)
    );
    let sx = sin(i.x + tn);
    let cy = cos(i.y + tn);
    let vx = q.x / (sx / inten + select(-0.001, 0.001, sx >= 0.0));
    let vy = q.y / (cy / inten + select(-0.001, 0.001, cy >= 0.0));
    c += 1.0 / max(length(vec2f(vx, vy)), 0.001);
  }
  c /= 4.0;
  c = 1.13 - pow(max(c, 0.0), 1.42);
  let sharp = pow(saturate(c), 9.0);
  // Crisp dark trough cutoff so water pockets stay calm dark stone (~26-36% coverage)
  return smoothstep(0.05, 0.92, sharp) * 1.32;
}

fn pj_lagoonCaustics(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let centered = (uv - 0.5) * vec2f(aspect, 1.0);
  let rotAngle = seed * 2.4 - 1.2;
  // Slow periodic drift — zero float precision drift for large t
  let driftPh = pj_phase(t, 56.0, seed);
  let drift = vec2f(sin(driftPh) * 0.16, cos(driftPh + seed * 3.0) * 0.14);
  let p = pj_rot(rotAngle) * centered * 1.18 + drift;

  let ph = pj_phase(t, 36.0, seed * 1.37);

  // Subtle physical optical dispersion (warm honey-gold edge vs cool sea-glass teal edge)
  let disp = vec2f(cos(ph), sin(ph)) * 0.011;
  let cWarm = pj_causticWeb(p + disp, ph);
  let cMid  = pj_causticWeb(p, ph);
  let cCool = pj_causticWeb(p - disp, ph);

  // Soft lagoon pool modulation so light gently pools & darkens across the frame
  let poolPh = pj_phase(t, 44.0, seed * 2.3);
  let pool = 0.35 + 0.65 * smoothstep(0.18, 0.85, pj_noise2(p * 1.65 + vec2f(sin(poolPh), cos(poolPh)) * 0.65));
  let breath = pj_breath(t, 14.0, seed);

  var col = vec3f(0.0);
  col += pj_TEAL * cCool * 0.98;
  col += pj_GOLD * cWarm * 1.14;
  // Crisp sunlit ivory cores only at true caustic cusps (peaks ~2.2-2.5)
  col += pj_IVORY * pow(saturate(cMid), 1.65) * 1.48;
  col *= pool * breath;

  return min(max(col, vec3f(0.0)), vec3f(2.6));
}

// ================================================================ 1: KOMOREBI CANOPY
// Lush layered overhead foliage carving dappled late-afternoon golden sun-discs,
// with translucent backlit chlorophyll leaf rims and calm dark leafy shadow.
fn pj_canopyLayer(p: vec2f, scale: f32, sway: f32, seed: f32, soft: f32) -> vec2f {
  // Returns (leafShadow 0..1, backlitRim 0..1)
  let q = p * scale;
  let cell = floor(q);
  let f = fract(q);
  var occ = 0.0;
  var rim = 0.0;

  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let id = cell + g;
      let h = pj_hash22(id + seed * 19.3);
      // ~82% of cells hold lush overlapping foliage; ~18% open into dappled sun apertures
      if (h.x < 0.82) {
        let h2 = pj_hash22(id * 1.7 + vec2f(4.3, 9.1));
        let anchor = g + 0.16 + 0.68 * h2;
        let localSway = sway * (0.65 + 0.65 * h.y) * cos(h.x * pj_TAU + sway * 0.9);
        let baseAng = (h.y - 0.5) * 3.1 + localSway * 0.30;

        let rel = f - anchor;
        // Lush three-leaf botanical sprig per branchlet
        let r1 = pj_rot(baseAng) * rel;
        let d1 = pj_sdLeaf(r1 + vec2f(0.0, 0.22), 0.96 + 0.26 * h2.x, 0.26 + 0.06 * h2.y);

        let r2 = pj_rot(baseAng + 0.74) * rel;
        let d2 = pj_sdLeaf(r2 + vec2f(0.0, 0.14), 0.82 + 0.22 * h2.y, 0.22 + 0.05 * h2.x);

        let r3 = pj_rot(baseAng - 0.78) * rel;
        let d3 = pj_sdLeaf(r3 + vec2f(0.0, 0.14), 0.76 + 0.22 * h.y, 0.21 + 0.05 * h2.y);

        let d = min(d1, min(d2, d3));
        let leafMask = 1.0 - smoothstep(-soft, soft, d);
        occ = max(occ, leafMask);
        // Backlit chlorophyll margin where sunlight grazes the leaf edge
        let edgeGlow = exp(-pow(d / max(soft * 1.35, 0.03), 2.0)) * (1.0 - leafMask * 0.55);
        rim = max(rim, edgeGlow);
      }
    }
  }
  return vec2f(occ, rim);
}

fn pj_komorebi(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let windPh1 = pj_phase(t, 22.0, seed);
  let windPh2 = pj_phase(t, 36.0, seed * 2.1);

  // Slow diagonal breeze rippling through the boughs
  let gust = sin(windPh1 + p.x * 2.2 - p.y * 1.5) * 0.58
           + sin(windPh2 - p.x * 1.6 + p.y * 2.4) * 0.42;
  let swayOffset = vec2f(gust * 0.024, gust * 0.013);

  // Drifting golden sunbeam patches (keeps ~65-72% of stone in calm dappled shade)
  let beamDrift = vec2f(sin(windPh2) * 0.34, cos(windPh1) * 0.26);
  let beamField = pj_fbm2(p * 2.8 + beamDrift + seed * 7.3);
  let sunBeams = smoothstep(0.45, 0.81, beamField);

  // Upper bokeh canopy (soft circular sun penumbra) + lower crisp leaves
  let farCanopy  = pj_canopyLayer(p + swayOffset * 0.60 + vec2f(0.37, -0.21), 2.6, gust, seed + 0.17, 0.13);
  let nearCanopy = pj_canopyLayer(p + swayOffset * 1.15, 3.8, gust * 1.25, seed + 0.63, 0.055);

  // Sunlight streams through gaps where BOTH canopy layers part
  let openFar  = 1.0 - farCanopy.x * 0.88;
  let openNear = 1.0 - nearCanopy.x * 0.96;
  let dapple = sunBeams * openFar * openNear;

  let dappleCore = pow(saturate(dapple), 1.35);
  let dappleHot  = pow(saturate(dapple), 2.4);

  // Translucent backlit leaf glow only where leaves border an illuminated sunbeam
  let nearBacklit = nearCanopy.y * openFar * sunBeams;
  let farBacklit  = farCanopy.y * (1.0 - nearCanopy.x * 0.65) * sunBeams * 0.40;
  let leafRim = nearBacklit * 0.92 + farBacklit;
  let breath = pj_breath(t, 15.0, seed);

  var col = vec3f(0.0);
  col += pj_GOLD * dappleCore * 1.15;
  col += pj_IVORY * dappleHot * 1.35;
  col += mix(pj_LEAF, pj_SAGE, 0.38) * leafRim * 0.78;
  // Subtle honey penumbra warmth where sunlight grazes shadow edges
  col += pj_AMBER * smoothstep(0.04, 0.36, dapple) * (1.0 - dappleCore) * 0.36;
  col *= breath;

  return min(max(col, vec3f(0.0)), vec3f(2.5));
}

// ================================================================ 2: ART NOUVEAU VINES
// Maybeck / Mucha architectural botanical scrollwork: arching sinuous stems,
// connected whiplash spiral tendrils, slender veined leaves, and glowing buds.
// Staggered phase waves keep the frame continuously alive (never all-black).
fn pj_archVine(
  p: vec2f,
  xBase: f32,
  archPull: f32,
  amp: f32,
  freq: f32,
  phase: f32,
  sway: f32,
  bloomPhase: f32,
  seed: f32
) -> vec4f {
  // Returns (stemGold, leafGreen, budCoral, sapIvory)
  let yNorm = saturate(p.y + 0.5); // 0 bottom .. 1 top

  // Graceful architectural arch: outer stems bow subtly inward near the crown
  let archCurve = archPull * yNorm * yNorm;
  let wave = sin(p.y * freq + phase) * amp + sin(p.y * freq * 0.52 - phase * 0.7) * amp * 0.35;
  let stemX = xBase + archCurve + wave + sway * yNorm * 0.025;
  let dArch = 2.0 * archPull * yNorm;
  let dWave = cos(p.y * freq + phase) * amp * freq
            + cos(p.y * freq * 0.52 - phase * 0.7) * amp * 0.35 * freq * 0.52;
  let dStem = abs(p.x - stemX) / sqrt(1.0 + (dArch + dWave) * (dArch + dWave));

  // Taper stem gently from strong architectural base to fine crown tip
  let stemW = mix(0.0088, 0.0042, yNorm);
  let mainStem = smoothstep(stemW * 2.0, stemW * 0.32, dStem);
  // Subtle Mucha double-rib accent line hugging the stem
  let accentRib = smoothstep(0.0056, 0.0014, abs(dStem - 0.015)) * 0.38 * (1.0 - 0.30 * yNorm);

  // Slow luminous sap wave gliding continuously upward
  let sapWave = pow(0.5 + 0.5 * sin(yNorm * 7.5 - bloomPhase), 3.6);
  // Smooth continuous breathing vitality along the stem (never vanishes to zero)
  let vitality = 0.42 + 0.58 * (0.5 + 0.5 * sin(yNorm * 3.8 - bloomPhase * 0.5));

  // Check nearest 2 botanical nodes along the stem (O(1))
  let nodeSpacing = 0.22;
  let kBase = floor((p.y + 0.44) / nodeSpacing);
  var leafOut = 0.0;
  var tendrilOut = 0.0;
  var budOut = 0.0;

  for (var n = 0; n <= 1; n++) {
    let k = kBase + f32(n);
    let nodeY = k * nodeSpacing - 0.44;
    let ny = nodeY + 0.5;
    if (ny > 0.06 && ny < 0.95) {
      let nArch = archPull * ny * ny;
      let nWave = sin(nodeY * freq + phase) * amp + sin(nodeY * freq * 0.52 - phase * 0.7) * amp * 0.35;
      let nodePos = vec2f(xBase + nArch + nWave + sway * ny * 0.025, nodeY);
      let side = select(-1.0, 1.0, fract(k * 0.5 + seed * 0.25) > 0.25);
      // Individual node breathing bloom (0.55..1.0)
      let nodeBloom = 0.62 + 0.38 * (0.5 + 0.5 * sin(bloomPhase * 0.6 - ny * 4.5 + k));
      let rel = p - nodePos;

      // Slender curving willow/iris botanical leaf emerging cleanly from the stem
      let leafAng = side * (-0.72 - 0.16 * (1.0 - nodeBloom)) + sway * 0.05;
      let lp = pj_rot(leafAng) * rel;
      let leafLen = 0.145 * nodeBloom;
      let leafWid = 0.026 * nodeBloom;
      let lpCurved = vec2f(lp.x - lp.y * lp.y * side * 1.9, lp.y);
      let dl = pj_sdLeaf(lpCurved, leafLen, leafWid);
      let leafOutline = smoothstep(0.0085, 0.001, abs(dl)) * 0.72;
      let leafFill = smoothstep(0.004, -0.007, dl) * 0.48;
      let leafVein = smoothstep(0.0045, 0.001, abs(lpCurved.x))
                   * smoothstep(0.0, leafLen * 0.88, lpCurved.y)
                   * smoothstep(leafLen, leafLen * 0.55, lpCurved.y) * 0.75;
      leafOut = max(leafOut, (leafFill + leafOutline * 0.65) * nodeBloom);
      tendrilOut = max(tendrilOut, leafVein * nodeBloom * 0.55);

      // Connected Art Nouveau whiplash spiral tendril curving directly off the opposite side
      let petioleEnd = nodePos + vec2f(-side * 0.044 * nodeBloom, 0.030 * nodeBloom);
      // Short curved connecting petiole from stem to curl
      let pa = p - nodePos;
      let ba = petioleEnd - nodePos;
      let hSeg = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
      let dPet = length(pa - ba * hSeg);
      let petLine = smoothstep(0.0068, 0.0015, dPet);

      let curlCenter = petioleEnd + vec2f(-side * 0.014 * nodeBloom, 0.018 * nodeBloom);
      let cp = p - curlCenter;
      let cr = length(cp);
      let cang = atan2(cp.y, -side * cp.x);
      let targetR = (0.007 + 0.0062 * (cang + pj_PI)) * nodeBloom;
      let curlArc = smoothstep(0.0065, 0.0014, abs(cr - targetR))
                  * smoothstep(0.056 * nodeBloom, 0.009, cr);
      tendrilOut = max(tendrilOut, max(petLine * 0.85, curlArc * 0.85) * nodeBloom);

      // Luminous coral-ivory bud pearl nestled inside the spiral scroll
      let budR = 0.013 * nodeBloom;
      let budCore = exp(-dot(cp, cp) / max(budR * budR * 0.85, 1e-5));
      budOut = max(budOut, budCore * (0.55 + 0.45 * nodeBloom));
    }
  }

  let gold = (mainStem + accentRib + tendrilOut) * vitality;
  let sap  = sapWave * (mainStem + tendrilOut * 0.5);
  return vec4f(gold, leafOut * vitality, budOut, sap);
}

fn pj_artNouveauVines(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  // Bottom-up coords: y = -0.5 bottom, +0.5 top
  let p = vec2f((uv.x - 0.5) * aspect, 0.5 - uv.y);

  let bloomPh = pj_phase(t, 28.0, seed);
  let sway = sin(pj_phase(t, 18.0, seed)) * 0.65 + sin(pj_phase(t, 31.0, seed * 1.9)) * 0.35;
  let breath = pj_breath(t, 13.0, seed);

  // Architectural triad: left & right stems arch gracefully inward to frame a central finial stem
  let vL = pj_archVine(p, -0.34 * aspect,  0.11 * aspect, 0.048, 6.0, seed * pj_TAU + 0.4, sway, bloomPh, seed + 0.13);
  let vC = pj_archVine(p,  0.00,           0.00,          0.058, 5.2, seed * pj_TAU + 2.3, sway * 0.8, bloomPh + 2.1, seed + 0.47);
  let vR = pj_archVine(p,  0.34 * aspect, -0.11 * aspect, 0.048, 6.2, seed * pj_TAU + 4.1, -sway * 0.9, bloomPh + 4.2, seed + 0.81);

  // Delicate crowning Art Nouveau floral arch line linking the upper triad
  let archP = vec2f(p.x / max(0.30 * aspect, 0.1), (p.y - 0.24) / 0.18);
  let archR = length(archP);
  let crownArch = smoothstep(0.055, 0.012, abs(archR - 1.0)) * smoothstep(-0.05, 0.22, archP.y) * 0.62;

  let stem = max(max(vL.x, vC.x), max(vR.x, crownArch));
  let leaf = max(vL.y, max(vC.y, vR.y));
  let bud  = max(vL.z, max(vC.z, vR.z));
  let sap  = max(vL.w, max(vC.w, vR.w));

  var col = vec3f(0.0);
  col += pj_GOLD * stem * 0.98;
  col += pj_IVORY * sap * 1.15;
  col += mix(pj_LEAF, pj_SAGE, 0.52) * leaf * 0.82;
  col += mix(pj_CORAL, pj_IVORY, 0.40) * bud * 1.38;
  col *= breath;

  return min(max(col, vec3f(0.0)), vec3f(2.6));
}

// ================================================================ 3: STAINED VENATION
// Botanical leaf-vein & dragonfly-wing cellular filigree lit like Tiffany stained glass.
fn pj_stainedVenation(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let centered = (uv - 0.5) * vec2f(aspect, 1.0);
  let orient = (seed - 0.5) * 1.1;
  let p = pj_rot(orient) * centered;

  // Elongate and fan gently along a graceful botanical midrib curve
  let midribCurve = sin(p.y * 2.5 + seed * 3.0) * 0.065;
  let dxMid = p.x - midribCurve;
  let fanWarp = vec2f(dxMid * 1.30, p.y * 0.92 - abs(dxMid) * 0.45);
  let organicShift = vec2f(
    pj_noise2(fanWarp * 2.5 + vec2f(3.1, 1.7)) - 0.5,
    pj_noise2(fanWarp * 2.5 + vec2f(8.9, 5.2)) - 0.5
  ) * 0.14;

  let driftPh = pj_phase(t, 48.0, seed);
  let vor = pj_voronoi3((fanWarp + organicShift) * 5.0, driftPh, 0.28);
  let edgeDist = vor.x;
  let juncDist = vor.y;
  let cellH1 = vor.z;
  let cellH2 = vor.w;

  // Primary sculptural veins + glowing junction pearls
  let primaryVein = smoothstep(0.082, 0.016, edgeDist);
  let veinHalo    = smoothstep(0.16, 0.02, edgeDist) * 0.18;
  let nodePearl   = smoothstep(0.13, 0.02, juncDist);

  // Tapered golden botanical midrib spine (wider toward base, slender toward apex)
  let midTaper = mix(0.012, 0.005, saturate(0.5 - p.y));
  let midrib = smoothstep(midTaper * 1.7, midTaper * 0.35, abs(dxMid)) * 0.95;

  // Slow sunset light wave illuminating ~24-34% of stained-glass panes at any instant
  let wavePh = pj_phase(t, 30.0, seed * 1.9);
  let sweep = sin(p.y * 3.4 - p.x * 2.0 - wavePh + cellH1 * 4.2);
  let paneActive = smoothstep(0.36, 0.88, sweep);
  let paneBevel = smoothstep(0.04, 0.24, edgeDist);
  // Subtle internal sub-vein grain inside lit glass cells
  let subVein = 0.72 + 0.28 * smoothstep(0.35, 0.75, pj_noise2(fanWarp * 14.0 + cellH2 * 7.0));

  // Curated Tiffany-glass solarpunk tints per pane
  var paneTint = pj_GOLD;
  if (cellH2 < 0.34) {
    paneTint = pj_TEAL;
  } else if (cellH2 < 0.66) {
    paneTint = mix(pj_LEAF, pj_SAGE, cellH1);
  } else if (cellH2 > 0.86) {
    paneTint = mix(pj_GOLD, pj_CORAL, 0.45);
  }

  let veinLight = 0.22 + 0.78 * smoothstep(-0.35, 0.72, sweep);
  let breath = pj_breath(t, 14.0, seed);

  var col = vec3f(0.0);
  col += paneTint * paneActive * paneBevel * subVein * 0.56;
  col += mix(pj_AMBER, pj_GOLD, 0.72) * (primaryVein + veinHalo + midrib) * veinLight * 0.96;
  col += pj_IVORY * (nodePearl * 0.82 + midrib * 0.42) * veinLight;
  col *= breath;

  return min(max(col, vec3f(0.0)), vec3f(2.5));
}

// ================================================================ 4: SUNFLOWER PHYLLOTAXIS
// Seamless dual-parastichy (13, 21) golden-angle Fibonacci botanical rosette with
// lush nested floret rings and crisp 13-petal sea-glass calyx crown (dome oculus).
fn pj_sunflowerPhyllotaxis(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let rRaw = length(p);
  let breathWave = sin(pj_phase(t, 14.0, seed * 1.7));
  let r = rRaw * (1.0 - 0.028 * breathWave);
  let ang = atan2(p.y, p.x);

  // Serene rotation (~1 full turn per 64 seconds)
  let rot = pj_phase(t, 64.0, seed);
  let theta = ang + rot;

  // Higher monotonic radial twist produces 5 lush concentric nested Fibonacci floret rings
  let twist = 4.65 * pow(max(r, 0.001), 0.74);
  let u1 = 13.0 * theta / pj_TAU + twist;
  let u2 = 21.0 * theta / pj_TAU - twist;

  let f1 = fract(u1) - 0.5;
  let f2 = fract(u2) - 0.5;

  // Sculpted diamond-lozenge Fibonacci florets at every (13, 21) spiral intersection
  let seedDist = length(vec2f(f1 * 1.08, f2 * 0.96));
  let seedSize = mix(0.26, 0.34, smoothstep(0.06, 0.38, r));
  let seedPetal = smoothstep(seedSize + 0.08, seedSize - 0.08, seedDist);
  let seedCore  = smoothstep(seedSize * 0.58, 0.02, seedDist);

  // Delicate spiral parastichy threads
  let line1 = smoothstep(0.09, 0.018, abs(f1));
  let line2 = smoothstep(0.09, 0.018, abs(f2));

  // Counter-travelling golden pollen waves spiralling gently outward
  let waveOut  = 0.5 + 0.5 * sin(r * 19.0 - pj_phase(t, 16.0, seed));
  let waveSpin = 0.5 + 0.5 * sin(theta * 3.0 + r * 10.0 - pj_phase(t, 28.0, seed * 2.3));
  let activeFloret = 0.25 + 0.75 * pow(waveOut, 1.7) * (0.50 + 0.50 * waveSpin);

  // Clean oculus envelope: warm central stamen core -> Fibonacci florets -> sculpted outer petals
  let innerCut = smoothstep(0.048, 0.105, r);
  let outerCut = 1.0 - smoothstep(0.33, 0.39, r);
  let ringMask = innerCut * outerCut;

  // Warm golden-coral stamen heart (eliminates center aliasing)
  let heartGlow = exp(-r * r * 260.0);
  let stamenRing = exp(-pow((r - 0.062) / 0.018, 2.0)) * (0.55 + 0.45 * cos(theta * 13.0));

  // Crisp 13-petal botanical calyx halo framing the Fibonacci disc
  let petalPhase = fract(13.0 * theta / pj_TAU + 0.5) - 0.5;
  let petalArch = 0.375 + 0.075 * pow(max(1.0 - abs(petalPhase) * 2.15, 0.0), 1.35);
  let dPetalEdge = abs(r - petalArch);
  let petalLine = smoothstep(0.012, 0.0025, dPetalEdge) * smoothstep(0.34, 0.38, r);
  let petalFill = smoothstep(petalArch + 0.006, petalArch - 0.018, r) * smoothstep(0.355, 0.395, r) * 0.42;
  let petalVein = smoothstep(0.06, 0.01, abs(petalPhase)) * smoothstep(0.35, 0.43, r) * smoothstep(petalArch + 0.005, petalArch - 0.01, r) * 0.55;

  // Radial botanical color harmony: coral-gold core -> honey-amber florets -> sea-glass/sage petals
  let floretTint = mix(mix(pj_CORAL, pj_GOLD, smoothstep(0.07, 0.20, r)), pj_AMBER, smoothstep(0.28, 0.38, r));

  var col = vec3f(0.0);
  col += floretTint * seedPetal * activeFloret * ringMask * 0.98;
  col += pj_IVORY * seedCore * pow(waveOut, 2.2) * ringMask * 1.18;
  col += pj_AMBER * (line1 * 0.24 + line2 * 0.20) * (0.35 + 0.65 * waveSpin) * ringMask;
  col += mix(pj_GOLD, pj_IVORY, 0.55) * (heartGlow * 1.25 + stamenRing * 0.78);
  col += mix(pj_TEAL, pj_SAGE, 0.45) * (petalFill + petalLine * 0.95) * (0.55 + 0.45 * waveSpin);
  col += pj_GOLD * petalVein * 0.75;

  return min(max(col * pj_breath(t, 14.0, seed), vec3f(0.0)), vec3f(2.6));
}

// ================================================================ 5: UNFURLING FERNS
// Graceful arching Pacific sword-fern fronds and curled fiddlehead croziers swaying
// in sunlit emerald and gilded light, with a faint mist of hovering spores.
fn pj_fernFrond(
  p: vec2f,
  origin: vec2f,
  angle: f32,
  len: f32,
  bend: f32,
  unfurl: f32,
  sway: f32
) -> vec3f {
  // Returns (pinnaFill, rachisAndVein, dewRim)
  let rel = p - origin;
  let q = pj_rot(-(angle + sway)) * rel;
  let s = q.y / len;
  if (s < -0.05 || s > unfurl + 0.16) {
    return vec3f(0.0);
  }

  // Graceful arching spine
  let spineX = bend * s * s * len;
  let d = q.x - spineX;
  let ad = abs(d);

  // Lush sword-fern width silhouette
  let sNorm = clamp(s / max(unfurl, 0.2), 0.0, 1.0);
  let envW = len * 0.25 * sin(pow(sNorm, 0.70) * pj_PI) * (1.0 - 0.15 * sNorm);

  // Central rachis stem (tapered golden spine)
  let stemMask = smoothstep(-0.02, 0.03, s) * (1.0 - smoothstep(unfurl - 0.015, unfurl + 0.015, s));
  let stemW = mix(0.0085, 0.0032, sNorm);
  let rachis = smoothstep(stemW * 1.8, stemW * 0.35, ad) * stemMask;

  // Paired curved pinnae (leaflets) sweeping gently upward along the frond
  let pairCount = 12.5;
  let adN = ad / max(len, 0.1);
  let sweepCoord = s * pairCount - adN * 12.0 - adN * adN * 14.0;
  let fPinna = fract(sweepCoord) - 0.5;
  let alongPinna = saturate(ad / max(envW, 0.004));
  let pinnaHalfH = mix(0.31, 0.05, alongPinna * alongPinna);
  let pinnaZone = smoothstep(0.05, 0.14, s) * (1.0 - smoothstep(unfurl - 0.075, unfurl - 0.008, s));
  let inWidth = 1.0 - smoothstep(envW * 0.86, envW * 1.04, ad);
  let pinnaBlade = (1.0 - smoothstep(pinnaHalfH - 0.11, pinnaHalfH + 0.09, abs(fPinna))) * inWidth * pinnaZone;
  let pinnaVein = (1.0 - smoothstep(0.035, 0.11, abs(fPinna))) * inWidth * pinnaZone * (1.0 - alongPinna * 0.65);

  // Curled fiddlehead crozier seamlessly continuing from the rachis apex tangent
  let tipPos = vec2f(bend * unfurl * unfurl * len, unfurl * len);
  let tipSlope = 2.0 * bend * unfurl;
  let tipTan = normalize(vec2f(tipSlope, 1.0));
  let curlSide = select(-1.0, 1.0, bend >= 0.0);
  // Inward normal perpendicular to the spine tangent so the spiral attaches smoothly
  let tipNorm = vec2f(tipTan.y, -tipTan.x) * curlSide;
  let curlRadBase = 0.027 * len;
  let curlCenter = tipPos + tipNorm * curlRadBase;
  let cp = q - curlCenter;
  // Rotate into tip-aligned frame so angle starts cleanly at the spine attachment point
  let cpLocal = vec2f(dot(cp, -tipNorm), dot(cp, tipTan));
  let cr = length(cpLocal);
  let cang = atan2(cpLocal.y, cpLocal.x); // -PI..PI; 0 is spine attachment
  let spiralR = (0.011 + 0.0052 * (cang + pj_PI)) * len;
  let crozier = smoothstep(0.0095, 0.0022, abs(cr - spiralR)) * smoothstep(0.055 * len, 0.008 * len, cr);
  let crozierHeart = exp(-cr * cr / max(0.00038 * len * len, 1e-5)) * 0.90;

  let dewRim = pinnaBlade * smoothstep(0.56, 0.96, alongPinna) + crozierHeart;
  return vec3f(pinnaBlade, max(rachis, max(pinnaVein * 0.55, crozier * 0.95)), dewRim);
}

fn pj_unfurlingFerns(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  // Bottom-up coords: y = -0.5 bottom, +0.5 top
  let p = vec2f((uv.x - 0.5) * aspect, 0.5 - uv.y);

  let swayPh1 = pj_phase(t, 17.0, seed);
  let swayPh2 = pj_phase(t, 26.0, seed * 2.3);
  let unfurlPh = pj_phase(t, 38.0, seed * 1.4);

  let unfurlA = 0.88 + 0.10 * sin(unfurlPh);
  let unfurlB = 0.86 + 0.11 * sin(unfurlPh - 1.1);
  let unfurlC = 0.83 + 0.12 * sin(unfurlPh + 1.4);

  let sA = 0.048 * sin(swayPh1);
  let sB = 0.056 * sin(swayPh2 + 1.2);
  let sC = 0.044 * sin(swayPh1 * 0.5 + swayPh2 * 0.5 + 2.4);

  // Four gracefully spaced arching fronds (clean botanical silhouettes without bottom clutter)
  let f1 = pj_fernFrond(p, vec2f(-0.44 * aspect, -0.54), -0.24, 1.02,  0.24, unfurlA, sA);
  let f2 = pj_fernFrond(p, vec2f( 0.44 * aspect, -0.54),  0.24, 1.00, -0.23, unfurlB, -sB);
  let f3 = pj_fernFrond(p, vec2f(-0.15 * aspect, -0.56), -0.07, 0.90,  0.16, unfurlC, sC);
  let f4 = pj_fernFrond(p, vec2f( 0.17 * aspect, -0.56),  0.09, 0.82, -0.17, unfurlA, -sA * 0.85);

  let blade = max(max(f1.x, f2.x), max(f3.x, f4.x));
  let vein  = max(max(f1.y, f2.y), max(f3.y, f4.y));
  let rim   = max(max(f1.z, f2.z), max(f3.z, f4.z));

  // Faint golden fern-spore specks floating lazily above the fronds
  let spDrift = vec2f(sin(swayPh2) * 0.15, -fract(t / 48.0 + seed) * 16.0);
  let spQ = p * 5.5 + spDrift;
  let spCell = pj_wrapCell(floor(spQ), 16.0);
  let spH = pj_hash22(spCell + seed * 17.3);
  var spore = 0.0;
  if (spH.x > 0.72) {
    let spD = length(fract(spQ) - (0.25 + 0.5 * spH));
    spore = exp(-spD * spD * 85.0) * smoothstep(-0.2, 0.25, p.y)
          * (0.4 + 0.6 * sin(pj_phase(t, 10.0, spH.y)));
  }

  let sunWash = 0.62 + 0.38 * smoothstep(-0.38, 0.42, p.y + p.x * 0.25);
  let breath = pj_breath(t, 13.0, seed);

  var col = vec3f(0.0);
  col += mix(pj_LEAF, pj_SAGE, 0.40 + 0.25 * sunWash) * blade * 0.82;
  col += mix(pj_GOLD, pj_IVORY, 0.48) * vein * 1.12;
  col += pj_IVORY * (rim * 0.82 + spore * 0.75);
  col += pj_GOLD * spore * 0.55;
  col *= sunWash * breath;

  return min(max(col, vec3f(0.0)), vec3f(2.5));
}

// ================================================================ 6: MYCELIAL PULSE
// Organic root / mycelial light filaments threading across dark stone with slow
// bioluminescent nutrient pulses and glowing junction ripples.
fn pj_mycelialPulse(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let driftPh = pj_phase(t, 50.0, seed);
  let pulsePh = pj_phase(t, 16.0, seed * 1.9);
  let colonyPh = pj_phase(t, 56.0, seed * 3.1);

  // Smooth organic domain warp bends Voronoi ridges into sinuous living hyphae
  let warpDrift = vec2f(sin(driftPh) * 0.34, cos(driftPh) * 0.34);
  let w1 = pj_noise2(p * 3.3 + warpDrift + seed * 5.0) - 0.5;
  let w2 = pj_noise2(p * 3.3 - warpDrift + vec2f(11.3, 6.7) + seed * 5.0) - 0.5;
  let q = p * 4.5 + vec2f(w1, w2) * 0.88;

  let vor = pj_voronoi3(q, driftPh, 0.30);
  let edgeDist = vor.x;
  let juncDist = vor.y;

  // Living colony territory mask (~20-30% active, slowly migrating over the stone)
  let colShift = vec2f(cos(colonyPh) * 0.45, sin(colonyPh) * 0.45);
  let colonyField = pj_fbm2(p * 1.85 + colShift + vec2f(4.2, -3.1) + seed * 9.0);
  let colonyMask = smoothstep(0.24, 0.62, colonyField);

  // Delicate crisp primary hyphae + organic bioluminescent junction blooms
  let filament = smoothstep(0.064, 0.012, edgeDist);
  let softAura = smoothstep(0.18, 0.020, edgeDist) * 0.22;
  let junction = smoothstep(0.135, 0.016, juncDist);
  let juncBloom = exp(-juncDist * juncDist * 42.0) * 0.34;

  // Slow radial nutrient surge travelling outward along the network
  let radialFlow = length(p - vec2f(sin(colonyPh) * 0.16, cos(colonyPh) * 0.14));
  let pulseWave = pow(0.5 + 0.5 * sin(radialFlow * 10.5 - pulsePh + w1 * 4.2), 3.6);
  let pulseGlow = filament * pulseWave;
  let nodeFlash = junction * (0.35 + 0.65 * pulseWave);

  let breath = pj_breath(t, 12.0, seed);

  var col = vec3f(0.0);
  // Rich sea-glass teal and deep warm amber resting root network
  col += mix(pj_TEAL, pj_AMBER, 0.42 + 0.32 * w2) * (filament * 0.64 + softAura);
  // Warm honey-gold & ivory nutrient pulses racing between junctions
  col += pj_GOLD * pulseGlow * 1.05;
  col += pj_IVORY * (pulseGlow * 0.62 + nodeFlash * 1.05);
  col += pj_TEAL * (junction * 0.45 + juncBloom * (0.4 + 0.6 * pulseWave));
  col *= colonyMask * breath;

  return min(max(col, vec3f(0.0)), vec3f(2.6));
}

// ================================================================ 7: POLLEN DRIFT
// Buoyant dandelion-seed tufts, sunlit bokeh pollen motes, and gossamer twilight breeze.
fn pj_seedTuftLayer(p: vec2f, scale: f32, t: f32, seed: f32) -> vec3f {
  let tile = 16.0;
  let ph = pj_phase(t, 38.0, seed);
  let drift = vec2f(-fract(t / 118.0 + seed) * tile, -fract(t / 172.0 + seed * 0.7) * tile);
  let q = p * scale + drift;
  let cell = floor(q);
  let f = fract(q);

  var col = vec3f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let id = pj_wrapCell(cell + g, tile);
      let h = pj_hash22(id + seed * 13.7);
      if (h.x > 0.34) {
        let h2 = pj_hash22(id * 2.1 + vec2f(7.1, 3.4));
        let bob = vec2f(sin(ph + h.y * pj_TAU) * 0.14, cos(ph * 1.5 + h.x * pj_TAU) * 0.12);
        let center = g + 0.22 + 0.56 * h2 + bob;
        let tilt = 0.38 * sin(ph + h2.x * pj_TAU);
        let rel = pj_rot(tilt) * (f - center);

        // Glowing warm seed kernel at base of stalk
        let seedPt = rel - vec2f(0.0, 0.14);
        let kernel = exp(-dot(seedPt, seedPt) * 320.0);

        // Slender luminous stem connecting kernel to pappus umbrella
        let stalk = smoothstep(0.014, 0.0025, abs(rel.x))
                  * smoothstep(0.14, 0.10, rel.y)
                  * smoothstep(-0.02, 0.015, rel.y);

        // Luminous backlit dandelion pappus fan (radiating silk filaments)
        let crownPt = rel - vec2f(0.0, -0.025);
        let cr = length(crownPt);
        let cang = atan2(-crownPt.y, crownPt.x); // +PI/2 is straight up
        let inFan = smoothstep(0.08, 0.48, cang) * (1.0 - smoothstep(2.66, 3.06, cang));
        let filaments = 0.46 + 0.54 * pow(0.5 + 0.5 * cos((cang - pj_PI * 0.5) * 14.0), 1.5);
        let crownRad = smoothstep(0.22, 0.055, cr) * smoothstep(0.008, 0.036, cr);
        let pappus = inFan * filaments * crownRad * 0.96;
        let softHalo = exp(-dot(crownPt, crownPt) * 20.0) * 0.30;

        let twinkle = 0.58 + 0.42 * sin(pj_phase(t, 12.0 + h2.y * 8.0, h.y));
        col += (pj_IVORY * (kernel * 1.55 + stalk * 0.65 + pappus * 0.92) + pj_GOLD * softHalo) * twinkle;
      }
    }
  }
  return col;
}

fn pj_moteLayer(p: vec2f, scale: f32, periodX: f32, periodY: f32, t: f32, seed: f32, sharpness: f32) -> vec3f {
  let tile = 24.0;
  let drift = vec2f(-fract(t / periodX + seed) * tile, -fract(t / periodY + seed * 1.3) * tile);
  let q = p * scale + drift;
  let cell = floor(q);
  let f = fract(q);
  let ph = pj_phase(t, 20.0, seed);

  var col = vec3f(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let g = vec2f(f32(i), f32(j));
      let id = pj_wrapCell(cell + g, tile);
      let h = pj_hash22(id + seed * 31.1);
      if (h.x > 0.42) {
        let sway = vec2f(sin(ph + h.y * pj_TAU) * 0.16, cos(ph + h.x * pj_TAU) * 0.14);
        let center = g + 0.18 + 0.64 * h + sway;
        let d = length(f - center);
        let radius = mix(0.065, 0.145, h.y);
        let disc = 1.0 - smoothstep(radius * sharpness, radius, d);
        let core = exp(-d * d / max(radius * radius * 0.18, 1e-4));
        let pulse = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(pj_phase(t, 10.0 + h.x * 7.0, h.y)), 1.4);

        var tint = pj_GOLD;
        if (h.y > 0.76) {
          tint = pj_TEAL;
        } else if (h.y > 0.58) {
          tint = pj_SAGE;
        }
        col += (tint * disc * 0.64 + pj_IVORY * core * 0.85) * pulse;
      }
    }
  }
  return col;
}

fn pj_pollenDrift(uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  let p = (uv - 0.5) * vec2f(aspect, 1.0);
  let breezePh = pj_phase(t, 36.0, seed);

  // Two delicate gossamer twilight air-current ribbons tracing the laminar breeze
  let wave1 = p.y * 3.4 + sin(p.x * 2.5 - breezePh) * 0.58 + sin(p.x * 1.2 + breezePh * 0.5) * 0.35;
  let wave2 = p.y * 2.4 - 0.5 + cos(p.x * 2.0 - breezePh * 0.7 + 1.1) * 0.45;
  let rib1 = pow(0.5 + 0.5 * sin(wave1 * 2.3), 7.5) * 0.18;
  let rib2 = pow(0.5 + 0.5 * sin(wave2 * 2.1), 8.5) * 0.14;
  let ribMask = 0.45 + 0.55 * pj_noise2(p * 2.0 + vec2f(sin(breezePh), cos(breezePh)) * 0.55);

  let tuftsNear = pj_seedTuftLayer(p, 2.05, t, seed);
  let tuftsFar  = pj_seedTuftLayer(p + vec2f(0.42, -0.28), 3.25, t * 0.72, seed + 0.53) * 0.45;
  let nearMotes = pj_moteLayer(p, 4.4, 150.0, 230.0, t, seed + 0.21, 0.28);
  let farMotes  = pj_moteLayer(p + vec2f(0.35, 0.22), 7.0, 250.0, 360.0, t, seed + 0.63, 0.12) * 0.58;

  var col = (pj_GOLD * rib1 + pj_TEAL * rib2) * ribMask;
  col += tuftsNear + tuftsFar + nearMotes + farMotes;
  col *= pj_breath(t, 16.0, seed);

  return min(max(col, vec3f(0.0)), vec3f(2.5));
}

// ================================================================ PUBLIC ENTRY POINT
// program: 0..PROGRAM_COUNT-1
// uv: projector frame, (0,0) top-left, (1,1) bottom-right
// t: continuous seconds (precision-safe for large t)
// seed: 0..1 per projector
// aspect: frame width / height (usually 1.0..1.78)
// Returns linear emitted light (rgb >= 0; 0 = dark, ~1 = full beam, peaks up to ~3 sparingly).
fn projectionProgram(program: u32, uv: vec2f, t: f32, seed: f32, aspect: f32) -> vec3f {
  switch (program % PROGRAM_COUNT) {
    case 0u: { return pj_lagoonCaustics(uv, t, seed, aspect); }
    case 1u: { return pj_komorebi(uv, t, seed, aspect); }
    case 2u: { return pj_artNouveauVines(uv, t, seed, aspect); }
    case 3u: { return pj_stainedVenation(uv, t, seed, aspect); }
    case 4u: { return pj_sunflowerPhyllotaxis(uv, t, seed, aspect); }
    case 5u: { return pj_unfurlingFerns(uv, t, seed, aspect); }
    case 6u: { return pj_mycelialPulse(uv, t, seed, aspect); }
    case 7u: { return pj_pollenDrift(uv, t, seed, aspect); }
    default: { return pj_lagoonCaustics(uv, t, seed, aspect); }
  }
}
