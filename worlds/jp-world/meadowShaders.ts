import * as THREE from 'three/webgpu';
import {
  Fn,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  uv,
  time,
  sin,
  cos,
  length,
  mix,
  pow,
  dot,
  normalize,
  max,
  smoothstep,
  clamp,
  attribute,
  positionLocal,
  positionWorld,
  cameraPosition,
} from 'three/tsl';

/**
 * Meadow terrain height function for JP's Solarpunk Meadow
 * so grass roots, wildflowers, and player feet align seamlessly.
 */
export function sampleMeadowHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  // Keep a gentle sunlit central glade flat enough for comfortable walking & portals
  const gladeFlatten = Math.min(1, Math.max(0, (r - 10) / 18));
  const rolling =
    Math.sin(x * 0.085) * Math.cos(z * 0.075) * 1.45 +
    Math.sin(x * 0.19 + z * 0.14) * 0.48 +
    Math.cos(x * 0.045 - z * 0.055) * 1.1;
  // Soft bowl rim further out so the horizon feels like California coastal hills
  const outerHills = Math.max(0, (r - 30) * 0.16);
  return rolling * (0.28 + 0.72 * gladeFlatten) + outerHills;
}

/**
 * Build a tapered, segmented grass blade BufferGeometry modeled after the World
 * project's `blade.wgsl` taper curve:
 *   taper(t) = pow(max(1 - t, 0), 0.7) * (1 - 0.15 * t)
 * Stored with local `y` in [0..1] (t along blade) and `x` in [-0.5..0.5] scaled by taper.
 */
export function createMeadowBladeGeometry(segments = 5): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const widthFactor = Math.pow(Math.max(1 - t, 0), 0.7) * (1 - 0.15 * t);
    const halfW = 0.5 * widthFactor;
    if (i === segments) {
      // Tapered tip vertex
      positions.push(0, 1, 0);
      uvs.push(0.5, 1);
    } else {
      // Slight subtle V-crease camber in Z so blades catch sunlight realistically
      const crease = 0.08 * (1 - t);
      positions.push(-halfW, t, crease);
      uvs.push(0, t);
      positions.push(halfW, t, crease);
      uvs.push(1, t);
    }
  }

  for (let i = 0; i < segments - 1; i++) {
    const row = i * 2;
    const next = (i + 1) * 2;
    indices.push(row, row + 1, next);
    indices.push(row + 1, next + 1, next);
  }
  const lastRow = (segments - 1) * 2;
  const tipIdx = segments * 2;
  indices.push(lastRow, lastRow + 1, tipIdx);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * TSL Instanced Grass material inspired directly by Eric's World project meadow
 * (`blade.wgsl`, `wind.wgsl`, `sheen.wgsl`, `canopy.wgsl`, `kinds.ts`):
 * - Cubic Bezier elastica bend preserving arc length (`bentCtrl`)
 * - Coherent rolling breeze swells across the meadow + gentle per-blade phase variation
 * - Deep painterly roots graded into warm sunlit yellow-green & golden-oat tips
 * - Wind sheen (`windSheen`): blades leaning away catch silvery light, creating visible wind waves
 * - Warm yellow-green forward sun translucency through thin grass tips
 *
 * Expects per-instance attributes on geometry:
 * - `aRoot` (vec4): xyz world root, w blade height
 * - `aBlade` (vec4): x width, y facing angle (rad), z rest lean, w random seed [0..1]
 * - `aRootCol` (vec3): linear root RGB
 * - `aTipCol` (vec3): linear tip RGB
 */
export function createWorldMeadowGrassMaterial(sunDir = new THREE.Vector3(0.55, 0.52, -0.65).normalize()): THREE.MeshBasicNodeMaterial {
  const uSunDir = uniform(sunDir.clone().normalize());
  const uWindDir = uniform(new THREE.Vector2(0.84, 0.54).normalize());

  const material = new THREE.MeshBasicNodeMaterial();
  material.side = THREE.DoubleSide;

  // Compute coherent wind bend + elastica Bezier curve in vertex stage
  const computeBladeData = Fn(() => {
    const aRoot = attribute('aRoot', 'vec4');
    const aBlade = attribute('aBlade', 'vec4');

    const rootPos = aRoot.xyz;
    const height = aRoot.w;
    const width = aBlade.x;
    const facing = aBlade.y;
    const restLean = aBlade.z;
    const rnd = aBlade.w;

    const t = positionLocal.y; // 0 at root .. 1 at tip
    const across = positionLocal.x; // -0.5..0.5 tapered

    const windSide = vec2(uWindDir.y.negate(), uWindDir.x);

    // Coherent rolling breeze front moving along windDir (world/meadow/wind.wgsl)
    const alongWind = dot(rootPos.xz, uWindDir);
    const crossWind = dot(rootPos.xz, windSide);
    const gustFront = sin(alongWind.mul(0.22).sub(time.mul(1.35)).add(sin(crossWind.mul(0.11)).mul(1.1)))
      .mul(0.5)
      .add(0.5);
    const fineWave = sin(alongWind.mul(0.62).sub(time.mul(2.15)).add(crossWind.mul(0.25)));
    // Slight per-blade phase offset (< 1/3 turn) so field undulates together, never jittering individually
    const swayPhase = alongWind.mul(0.95).sub(time.mul(2.35)).add(rnd.sub(0.5).mul(1.6));
    const sway = sin(swayPhase).mul(float(0.055).add(gustFront.mul(0.11)));

    const restDir = vec2(cos(facing), sin(facing));
    const windBendAmt = float(0.14).add(gustFront.mul(0.38)).add(fineWave.mul(0.1)).add(sway);
    const bend = restDir.mul(restLean).add(uWindDir.mul(windBendAmt)).add(windSide.mul(sin(swayPhase.mul(0.7)).mul(0.045)));

    // Cubic Bezier elastica control points (`blade.wgsl` bentCtrl)
    const bendLen = length(bend);
    const bendClamped = clamp(bendLen, 0.0, 1.42);
    const bd = bend.div(max(bendLen, 0.0001));

    const a1 = bendClamped.mul(0.12);
    const a2 = bendClamped.mul(0.5);
    const a3 = bendClamped;
    const segLen = height.div(3.0);

    const e1 = vec3(bd.x.mul(sin(a1)), cos(a1), bd.y.mul(sin(a1)));
    const e2 = vec3(bd.x.mul(sin(a2)), cos(a2), bd.y.mul(sin(a2)));
    const e3 = vec3(bd.x.mul(sin(a3)), cos(a3), bd.y.mul(sin(a3)));

    const p1Raw = e1.mul(segLen);
    const p2Raw = p1Raw.add(e2.mul(segLen));
    const p3Raw = p2Raw.add(e3.mul(segLen));

    // Gravesen arc-length preservation
    const approxLen = length(p3Raw).add(height).mul(0.5);
    const lenScale = height.div(max(approxLen, 0.001));
    const p1 = p1Raw.mul(lenScale);
    const p2 = p2Raw.mul(lenScale);
    const p3 = p3Raw.mul(lenScale);

    const oneMinusT = float(1.0).sub(t);
    const curvePos = p1
      .mul(float(3.0).mul(oneMinusT).mul(oneMinusT).mul(t))
      .add(p2.mul(float(3.0).mul(oneMinusT).mul(t).mul(t)))
      .add(p3.mul(t.mul(t).mul(t)));

    // Ribbon side vector rotated by facing angle
    const sideVec = vec3(cos(facing), 0.0, sin(facing).negate());
    const worldPos = rootPos.add(curvePos).add(sideVec.mul(across.mul(width)));
    return worldPos;
  });

  material.positionNode = computeBladeData();

  material.colorNode = Fn(() => {
    const aRoot = attribute('aRoot', 'vec4');
    const aBlade = attribute('aBlade', 'vec4');
    const aRootCol = attribute('aRootCol', 'vec3');
    const aTipCol = attribute('aTipCol', 'vec3');

    const rootPos = aRoot.xyz;
    const rnd = aBlade.w;
    const t = uv().y;

    // Painterly root deepening & tip warming (`canopy.wgsl` grassDeep / grassWarm / grassGrade)
    const deepRoot = aRootCol.mul(vec3(0.62, 0.72, 0.56));
    const warmTip = aTipCol.mul(vec3(1.12, 1.05, 0.88));
    const smoothT = t.mul(t).mul(float(3.0).sub(t.mul(2.0))).mul(0.85).add(t.mul(0.15));

    // Broken painterly patch mottle across the meadow (`canopy.wgsl` grassMottle)
    const mottleWave = sin(rootPos.x.mul(0.28).add(1.3)).mul(cos(rootPos.z.mul(0.24).sub(0.7))).mul(0.08)
      .add(sin(rootPos.x.mul(0.75).sub(rootPos.z.mul(0.6))).mul(0.05));
    const mottle = vec3(
      float(1.0).add(mottleWave.mul(1.25)),
      float(1.0).add(mottleWave),
      float(1.0).add(mottleWave.mul(0.55)),
    );

    const albedo = mix(deepRoot, warmTip, smoothT).mul(mottle);

    // Recompute local wind lean for `windSheen` wave bands visible from above & eye height
    const alongWind = dot(rootPos.xz, uWindDir);
    const windSide = vec2(uWindDir.y.negate(), uWindDir.x);
    const crossWind = dot(rootPos.xz, windSide);
    const gustFront = sin(alongWind.mul(0.22).sub(time.mul(1.35)).add(sin(crossWind.mul(0.11)).mul(1.1)))
      .mul(0.5)
      .add(0.5);
    const fieldLean = uWindDir.mul(float(0.18).add(gustFront.mul(0.45)));

    // `sheen.wgsl` windSheen: leaning away catches silvery sunlight; leaning toward shows deep stems
    const toPoint = normalize(positionWorld.sub(cameraPosition));
    const horizLen = max(length(toPoint.xz), 0.001);
    const horizDir = toPoint.xz.div(horizLen);
    const lookingDown = clamp(toPoint.y.negate().mul(1.6), 0.0, 1.0);
    const away = dot(fieldLean, horizDir);
    const ws = clamp(
      float(1.0)
        .add(away.mul(0.95).mul(float(1.0).sub(lookingDown.mul(0.45))))
        .add(length(fieldLean).mul(0.65).mul(float(0.45).add(lookingDown.mul(0.55)))),
      0.68,
      1.52,
    );

    // Canopy self-shadowing down among the stems + warm forward sun scatter through thin tips
    const ao = mix(float(0.42), float(1.0), pow(t, 0.65));
    const sunAlign = max(dot(toPoint, uSunDir), 0.0);
    const translucency = pow(sunAlign, 3.0).mul(t.mul(t)).mul(0.65);

    const sunColor = vec3(1.08, 0.99, 0.84);
    const skyAmb = vec3(0.42, 0.58, 0.52); // Keeps grass lush green in shade (`canopy.wgsl` grassShade)
    const tipSparkle = mix(float(1.0), ws, float(0.45).add(t.mul(0.55)));

    const directLit = albedo.mul(sunColor).mul(float(0.75).add(t.mul(0.45)));
    const ambientLit = albedo.mul(skyAmb);
    const backScatter = vec3(0.82, 0.92, 0.36).mul(translucency);

    // Subtle sunlit golden glint on tall blades catching the gust crest
    const gustSilver = vec3(0.95, 0.98, 0.86).mul(gustFront.mul(t.mul(t)).mul(0.14).mul(float(0.6).add(rnd.mul(0.4))));

    const lit = directLit.add(ambientLit).mul(ao).mul(tipSparkle).add(backScatter).add(gustSilver);
    return vec4(lit, 1.0);
  })();

  return material;
}

/**
 * Sunlit painted meadow ground beneath the instanced grass blades so roots blend
 * effortlessly into rolling California golden-green hills.
 */
export function createMeadowGroundMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.92,
    metalness: 0.0,
  });

  material.colorNode = Fn(() => {
    const p = positionWorld.xz;
    const dist = length(p);
    const mottle1 = sin(p.x.mul(0.16)).mul(cos(p.y.mul(0.14))).mul(0.5).add(0.5);
    const mottle2 = sin(p.x.mul(0.42).add(p.y.mul(0.36))).mul(0.5).add(0.5);

    const lushDeep = vec3(0.11, 0.24, 0.07);
    const warmMeadow = vec3(0.24, 0.39, 0.12);
    const goldenSlope = vec3(0.48, 0.44, 0.18);

    const base = mix(lushDeep, warmMeadow, mottle1.mul(0.7).add(mottle2.mul(0.3)));
    const hillGold = smoothstep(float(18.0), float(46.0), dist).mul(0.45);
    // Warm sunlit stepping-stone clearing tint in the very center
    const gladePath = smoothstep(float(9.0), float(2.5), dist).mul(0.16);
    const pathTint = vec3(0.52, 0.49, 0.35);

    const finalCol = mix(mix(base, goldenSlope, hillGold), pathTint, gladePath);
    return vec4(finalCol, 1.0);
  })();

  return material;
}
