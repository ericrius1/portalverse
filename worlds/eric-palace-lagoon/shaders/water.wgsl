// The lagoon: still water with a breeze on it. The Palace mirrored in it (a planar reflection drawn from below the
// surface into `refl` the same frame), wobbled by the ripples; the sky where the reflection has nothing; the sun's
// glitter; and under it the water's own green-teal, deepening with the depth over the bed (the land's height
// function gives the depth here, so no depth buffer is read back). The banks hide the edges of its one quad.
#include "./common"

@group(2) @binding(0) var refl: texture_2d<f32>;


struct WOut { @builtin(position) pos: vec4f, @location(0) world: vec3f }

@vertex fn vs(@builtin(vertex_index) vi: u32) -> WOut {
  let u = f32((26u >> vi) & 1u);
  let v = f32((52u >> vi) & 1u);
  // (one quad spanning both the main east lagoon and the north reflecting cove, edges hidden under the banks)
  let lo = min(G.lagoon.xy - G.lagoon.zw - 8.0, vec2f(-26.0, 14.0));
  let hi = max(G.lagoon.xy + G.lagoon.zw + 8.0, vec2f(52.0, 38.0));
  let p = vec3f(mix(lo.x, hi.x, u), G.waterY, mix(lo.y, hi.y, v));
  var o: WOut;
  o.world = p;
  o.pos = clipAt(p);
  return o;
}

fn swell(xz: vec2f, t: f32, d: vec2f, f: f32, a: f32, sp: f32) -> vec2f {
  return d * cos(dot(xz, d) * f + t * sp) * f * a;
}

/** the surface's slope: a few long swells and the breeze's cat's-paws */
fn waterNormal(xz: vec2f, t: f32, dist: f32) -> vec3f {
  // (four swells written out: a runtime-indexed table stalls Metal's compiler)
  var g = swell(xz, t, vec2f(0.94, 0.34), 0.55, 0.022, 0.7);
  g += swell(xz, t, vec2f(0.62, -0.78), 0.9, 0.014, 0.95);
  g += swell(xz, t, vec2f(-0.2, 0.98), 1.6, 0.009, 1.3);
  g += swell(xz, t, vec2f(0.99, -0.12), 2.7, 0.006, 1.7);
  // fine ripples fade with distance so they don't shimmer
  let fine = 1.0 - smoothstep(20.0, 120.0, dist);
  let e = 0.15;
  let q = xz * 2.2 + vec2f(t * 0.6, t * 0.25);
  let nx = noise2(q + vec2f(e, 0.0)) - noise2(q - vec2f(e, 0.0));
  let nz = noise2(q + vec2f(0.0, e)) - noise2(q - vec2f(0.0, e));
  let gust = smoothstep(0.35, 0.8, fbm2(xz * 0.03 - vec2f(t * 0.05, 0.0), 2));
  g += vec2f(nx, nz) * (0.05 + 0.12 * gust) * fine;
  return normalize(vec3f(-g.x, 1.0, -g.y));
}

@fragment fn fs(i: WOut) -> @location(0) vec4f {
  let p = i.world;
  let to = p - frame.camPos;
  let dist = length(to);
  let v = -to / max(dist, 1e-3);
  let n = waterNormal(p.xz, G.time, dist);
  let depth = max(G.waterY - terrainHeight(p.xz), 0.0);

  // the reflection, nudged by the slope (less far off, where the ripples are fine)
  let dims = vec2f(textureDimensions(refl));
  let off = n.xz * vec2f(1.0, -1.0) * G.vp.w * 0.07 / (1.0 + dist * 0.02);
  let lo = G.vp.xy + 0.5;
  let hi = G.vp.xy + G.vp.zw - 0.5;
  let px = clamp(i.pos.xy + off, lo, hi);
  var mirrored = textureSampleLevel(refl, samp_linear, px / dims, 0.0).rgb;
  let r = reflect(-v, n);
  // (below the horizon, the reflection only ever sees what's drawn: keep the sky behind it)
  mirrored = select(skyColor(vec3f(r.x, max(r.y, 0.01), r.z)), mirrored, dot(mirrored, vec3f(1.0)) > 1e-4);

  // the water itself: the bed seen through the shallows, green-teal deepening
  let cosv = max(dot(n, v), 0.0);
  let absorb = exp(-depth * vec3f(1.1, 0.55, 0.62) / max(cosv, 0.2));
  let bed = vec3f(0.07, 0.065, 0.04) * (G.sunColor * 0.5 + ambient(vec3f(0.0, 1.0, 0.0)));
  let deep = vec3f(0.012, 0.045, 0.04) * (G.sunColor * 0.35 + G.ambSky * 1.4);
  let body = mix(deep, bed, absorb);

  let fres = 0.02 + 0.98 * pow(1.0 - cosv, 5.0);
  var c = mix(body, mirrored, saturate(fres * 1.1 + 0.08));
  // the sun's glitter
  let vis = sunShadow(p, vec3f(0.0, 1.0, 0.0));
  let spec = pow(saturate(dot(r, G.sunDir)), 900.0) * 60.0 + pow(saturate(dot(r, G.sunDir)), 90.0) * 0.6;
  c += G.sunColor * spec * vis;
  // a soft edge where the water thins over the bank
  let shallow = smoothstep(0.0, 0.12, depth);
  c = mix(bed * 1.2, c, shallow);
  return vec4f(haze(c, p), 1.0);
}
