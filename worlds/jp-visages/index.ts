/// <reference types="vite/client" />
/**
 * AVENUE OF VISAGES (`jp-visages`)
 *
 * Two endless rows of colossal, strictly upright ancient stone heads facing inward
 * across a rough matte stone path pooled with glossy red liquid, flanked by jagged
 * ruined monoliths and piles of broken rubble. The rows march far beyond both
 * portals until they vanish into pitch-black darkness.
 *
 * The head mesh (`female_human_head_game.glb`) is split once into its weathered
 * ancient stone visage and its separate glossy obsidian-black eyeballs, then
 * instanced cleanly across the corridor.
 */
import * as THREE from 'three/webgpu';
import {
  abs,
  bumpMap,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  float,
  fract,
  instancedBufferAttribute,
  instanceIndex,
  max,
  min,
  mix,
  mx_noise_float,
  normalGeometry,
  normalView,
  normalWorld,
  normalWorldGeometry,
  positionGeometry,
  positionViewDirection,
  positionWorld,
  pow,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { breathe, seededRandom } from '@portalverse/core/rooms/kit';
import headUrl from './assets/female_human_head_game.glb?url';
import {
  buildVisageScenePlan,
  createVisageCollider,
  terrainHeightAt,
  WALK_BOUNDS,
  type VisageScenePlan,
} from './layout';
import {
  buildPillarGeometries,
  buildRockGeometries,
  copyOfGeometry,
  loadSplitHead,
  type SplitHeadAssets,
} from './headGeometry';
import { NOISE_SIZE, visageNoisePixels } from './noise';

const VOID_DARK = '#04060b';
const SKY_ZENITH = '#03050a';
const SKY_CLOUD = '#152230';
const MOON_DIR = new THREE.Vector3(-0.38, 0.72, 0.58).normalize();
const RIM_DIR = new THREE.Vector3(0.45, 0.62, -0.64).normalize();

/** True distance from the camera over which the endless corridor dissolves into total darkness. */
const DARK_NEAR = 68;
const DARK_FAR = 238;

interface SharedVisageLayout {
  plan: VisageScenePlan;
  headAssets: SplitHeadAssets;
  groundGeometry: THREE.BufferGeometry;
  rockShapes: THREE.BufferGeometry[];
  pillarShapes: THREE.BufferGeometry[];
  headMatrices: THREE.Matrix4[];
  rockMatrices: THREE.Matrix4[][];
  pillarMatrices: THREE.Matrix4[][];
  motes: {
    rest: THREE.InstancedBufferAttribute;
    seed: THREE.InstancedBufferAttribute;
  };
}

let sharedPromise: Promise<SharedVisageLayout> | undefined;

function sharedVisageLayout(): Promise<SharedVisageLayout> {
  sharedPromise ??= buildSharedLayout();
  return sharedPromise;
}

async function buildSharedLayout(): Promise<SharedVisageLayout> {
  const [headAssets] = await Promise.all([loadSplitHead(headUrl), visageNoisePixels()]);
  await breathe();

  const plan = buildVisageScenePlan();
  await breathe();

  // Ground plane extending far past both portals (-340..+340 m) with rubble embankments under the heads.
  const groundGeometry = new THREE.PlaneGeometry(168, 680, 64, 150);
  groundGeometry.rotateX(-Math.PI / 2);
  const gPos = groundGeometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < gPos.count; i++) {
    const x = gPos.getX(i);
    const z = gPos.getZ(i);
    gPos.setY(i, terrainHeightAt(x, z));
  }
  groundGeometry.computeVertexNormals();
  groundGeometry.computeBoundingSphere();
  await breathe();

  const rockShapes = buildRockGeometries();
  const pillarShapes = buildPillarGeometries();
  await breathe();

  // Head instance transforms (strictly upright: pitch = 0, roll = 0, facing inward toward the path).
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  const headMatrices = plan.heads.map(h => {
    euler.set(0, h.yaw, 0, 'YXZ');
    return new THREE.Matrix4().compose(
      pos.set(h.x, h.y, h.z),
      q.setFromEuler(euler),
      scl.set(h.scale, h.scale, h.scale),
    );
  });

  const rockMatrices: THREE.Matrix4[][] = rockShapes.map(() => []);
  for (const r of plan.rubble) {
    euler.set(r.rotX, r.rotY, r.rotZ, 'YXZ');
    rockMatrices[r.variant % rockShapes.length].push(
      new THREE.Matrix4().compose(
        pos.set(r.x, r.y, r.z),
        q.setFromEuler(euler),
        scl.set(r.scaleX, r.scaleY, r.scaleZ),
      ),
    );
  }

  const pillarMatrices: THREE.Matrix4[][] = pillarShapes.map(() => []);
  for (const p of plan.pillars) {
    euler.set(p.tiltX, p.yaw, p.tiltZ, 'YXZ');
    pillarMatrices[p.variant % pillarShapes.length].push(
      new THREE.Matrix4().compose(
        pos.set(p.x, p.y, p.z),
        q.setFromEuler(euler),
        scl.set(p.width, p.height, p.depth),
      ),
    );
  }

  // Sparse cold ash dust motes floating lazily down the monument corridor.
  const moteRand = seededRandom(4093);
  const moteCount = 340;
  const moteRest = new Float32Array(moteCount * 4);
  const moteSeed = new Float32Array(moteCount * 4);
  for (let i = 0; i < moteCount; i++) {
    moteRest[i * 4] = (moteRand() * 2 - 1) * 26;
    moteRest[i * 4 + 1] = 0.6 + moteRand() * 24;
    moteRest[i * 4 + 2] = (moteRand() * 2 - 1) * 220;
    moteRest[i * 4 + 3] = 0.045 + moteRand() * 0.095;
    moteSeed[i * 4] = moteRand();
    moteSeed[i * 4 + 1] = moteRand();
    moteSeed[i * 4 + 2] = moteRand();
    moteSeed[i * 4 + 3] = moteRand();
  }

  return {
    plan,
    headAssets,
    groundGeometry,
    rockShapes,
    pillarShapes,
    headMatrices,
    rockMatrices,
    pillarMatrices,
    motes: {
      rest: new THREE.InstancedBufferAttribute(moteRest, 4),
      seed: new THREE.InstancedBufferAttribute(moteSeed, 4),
    },
  };
}

export default defineRoom('jp-visages', {
  async mount(ctx) {
    const layout = await sharedVisageLayout();
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

    ctx.setTerrainHeight(terrainHeightAt);
    ctx.setWalkBounds(WALK_BOUNDS);
    ctx.setCollider(createVisageCollider(layout.plan.heads, layout.plan.pillars));

    const noise = new THREE.DataTexture(
      await visageNoisePixels(),
      NOISE_SIZE,
      NOISE_SIZE,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    noise.wrapS = THREE.RepeatWrapping;
    noise.wrapT = THREE.RepeatWrapping;
    noise.magFilter = THREE.LinearFilter;
    noise.minFilter = THREE.LinearMipmapLinearFilter;
    noise.generateMipmaps = true;
    noise.colorSpace = THREE.NoColorSpace;
    noise.needsUpdate = true;

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      ctx.scene.backgroundNode = null;
      ctx.scene.fog = null;
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const im of instanced) im.dispose();
      noise.dispose();
    });

    // Brooding pitch-black sky with faint cold storm-cloud bands overhead, black at the horizon.
    {
      const dir = normalWorldGeometry;
      const up = clamp(dir.y, 0, 1);
      const cloudCoord = vec3(dir.x.mul(2.4), dir.y.mul(4.5), dir.z.mul(1.8)).add(vec3(time.mul(0.008), 0, time.mul(-0.005)));
      const clouds = smoothstep(0.18, 0.78, mx_noise_float(cloudCoord).mul(0.5).add(0.5));
      const band = smoothstep(0.06, 0.45, up).mul(float(1).sub(smoothstep(0.65, 0.98, up)));
      const skyBase = mix(color(VOID_DARK), color(SKY_ZENITH), smoothstep(0, 0.55, up));
      ctx.scene.backgroundNode = mix(skyBase, color(SKY_CLOUD), clouds.mul(band).mul(0.65));
    }
    ctx.scene.fog = new THREE.Fog(VOID_DARK, 34, 235);

    // High-contrast cold moonlight chiaroscuro + low crimson bounce from the liquid red pools.
    root.add(new THREE.HemisphereLight('#3b5266', '#1c0508', 0.44));

    const keyMoon = new THREE.DirectionalLight('#d4eaf4', 2.45);
    keyMoon.position.copy(MOON_DIR).multiplyScalar(120);
    root.add(keyMoon);

    const rimMoon = new THREE.DirectionalLight('#86aec6', 1.15);
    rimMoon.position.copy(RIM_DIR).multiplyScalar(120);
    root.add(rimMoon);

    const crimsonBounce = new THREE.DirectionalLight('#a41118', 0.65);
    crimsonBounce.position.set(0, -80, 12);
    root.add(crimsonBounce);

    await ctx.breathe();

    // Shared radial distance blackness so the endless rows vanish seamlessly well before the 450 m far plane.
    const distFromEye = positionWorld.sub(cameraPosition).length();
    const abyssFade = smoothstep(DARK_NEAR, DARK_FAR, distFromEye);
    const keepVis = float(1).sub(abyssFade);

    // Track player feet for subtle live ripples in the crimson liquid pools.
    const playerFeet = uniform(new THREE.Vector3(0, -100, 0));
    const playerSpeed = uniform(0);

    // -------------------------------------------------------------------------
    // 1. ROUGH MATTE STONE GROUND WITH GLOSSY LIQUID RED POOLS
    // -------------------------------------------------------------------------
    {
      const p = positionWorld;
      const groundMat = own(new THREE.MeshStandardNodeMaterial({ metalness: 0, fog: false }));

      const broad = texture(noise, p.xz.mul(0.022));
      const mid = texture(noise, p.xz.mul(0.095).add(vec2(0.37, 0.19)));
      const fine = texture(noise, p.xz.mul(0.34).add(vec2(0.11, 0.73)));
      const grain = texture(noise, p.xz.mul(1.15));

      const stoneTone = broad.r.mul(0.45).add(mid.g.mul(0.35)).add(grain.g.mul(0.2));
      const cracks = float(1).sub(smoothstep(0.025, 0.11, mid.b));
      const microCracks = float(1).sub(smoothstep(0.02, 0.085, fine.b));

      // Pale moonlit ash-slate along the central walkway, darker weathered stone under the heads.
      const corridorMask = float(1).sub(smoothstep(5.5, 22, abs(p.x)));
      const pathStone = mix(color('#6b7b86'), color('#aebec5'), stoneTone);
      const flankStone = mix(color('#232b36'), color('#4e5e6b'), stoneTone);
      const bareStone = mix(flankStone, pathStone, corridorMask)
        .mul(float(1).sub(cracks.mul(0.55)).sub(microCracks.mul(0.22)));

      // Organic domain-warped liquid red pools along and beside the rocky path.
      const warp = vec2(broad.g.sub(0.5), mid.r.sub(0.5)).mul(0.11);
      const poolSampleA = texture(noise, p.xz.mul(0.036).add(warp)).r;
      const poolSampleB = texture(noise, p.xz.mul(0.072).add(vec2(0.42, 0.81)).sub(warp.mul(0.6))).g;
      const poolField = poolSampleA.mul(0.62).add(poolSampleB.mul(0.38));

      // Concentrate pools visibly along the corridor & head margins; keep portal thresholds cleaner.
      const nearPortalA = smoothstep(2.2, 7.5, p.xz.sub(vec2(0, 36.25)).length());
      const nearPortalB = smoothstep(2.2, 7.5, p.xz.sub(vec2(0, -36.25)).length());
      const portalClear = nearPortalA.mul(nearPortalB);
      const corridorBias = float(1).sub(smoothstep(10, 26, abs(p.x)));
      const poolRaw = poolField.mul(float(0.65).add(corridorBias.mul(0.35))).mul(float(0.55).add(portalClear.mul(0.45)));

      const poolMask = smoothstep(0.545, 0.585, poolRaw);
      const poolDepth = smoothstep(0.56, 0.72, poolRaw);
      const wetHalo = smoothstep(0.495, 0.565, poolRaw).mul(float(1).sub(poolMask));

      // Darken matte stone right around the damp rim of each red pool.
      const dampStone = bareStone.mul(float(1).sub(wetHalo.mul(0.48)));

      // Deep crimson liquid color: bright scarlet-vermilion shallow rim, dark arterial crimson interior.
      const liquidShimmer = texture(noise, p.xz.mul(0.22).add(vec2(time.mul(0.012), time.mul(-0.009)))).r;
      const shallowRed = color('#c8141c');
      const deepRed = color('#4e0408');
      const liquidBase = mix(shallowRed, deepRed, poolDepth.mul(0.85).add(liquidShimmer.mul(0.15)));

      // Fresnel moonlit sky reflection over the glossy crimson pools.
      const viewDir = cameraPosition.sub(p).normalize();
      const ndotv = clamp(dot(normalWorld, viewDir), 0, 1);
      const fresnel = pow(float(1).sub(ndotv), 4.0);
      const liquidReflect = mix(liquidBase, color('#9bb6c4'), fresnel.mul(0.52));

      // Crisp slow liquid ripples + interactive concentric ripple around the walking player.
      const rippleA = texture(noise, p.xz.mul(0.28).add(vec2(time.mul(0.025), time.mul(0.018)))).g;
      const rippleB = texture(noise, p.xz.mul(0.42).add(vec2(time.mul(-0.021), time.mul(0.029)))).g;
      const ambientRipple = rippleA.add(rippleB).mul(0.5);
      const playerDist = p.xz.sub(playerFeet.xz).length();
      const stepWave = sin(playerDist.mul(10).sub(time.mul(6.5)))
        .mul(float(1).sub(smoothstep(0.2, 4.2, playerDist)))
        .mul(playerSpeed)
        .mul(0.45);
      const liquidHeight = ambientRipple.mul(0.14).add(stepWave);

      const stoneBump = stoneTone.mul(0.6).sub(cracks.mul(0.45)).sub(microCracks.mul(0.22));
      const finalBump = mix(stoneBump, liquidHeight, poolMask);

      groundMat.colorNode = mix(dampStone, liquidReflect, poolMask).mul(keepVis);
      // Rough matte stone (0.96) vs glossy wet crimson liquid (0.06).
      groundMat.roughnessNode = mix(mix(float(0.96), float(0.48), wetHalo), float(0.06), poolMask);
      groundMat.normalNode = bumpMap(finalBump, mix(float(0.055), float(0.018), poolMask));

      // Subtle glossy moonlight + faint deep crimson internal luminance so pools read unmistakably in the dark.
      const halfVec = vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z).add(viewDir).normalize();
      const specGlint = pow(max(dot(normalWorld, halfVec), 0), 96).mul(poolMask).mul(0.65);
      const liquidGlow = color('#780910').mul(poolMask).mul(float(0.28).add(fresnel.mul(0.22)))
        .add(color('#d2eaf4').mul(specGlint));
      groundMat.emissiveNode = mix(liquidGlow, color(VOID_DARK), abyssFade);

      const groundMesh = new THREE.Mesh(own(copyOfGeometry(layout.groundGeometry)), groundMat);
      groundMesh.frustumCulled = false;
      root.add(groundMesh);
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 2. TWO ENDLESS ROWS OF MASSIVE ANCIENT STONE HEADS + SHINY BLACK EYEBALLS
    // -------------------------------------------------------------------------
    {
      const { skin, eyes, leftEyeCenter, rightEyeCenter, eyeRadius } = layout.headAssets;

      // Per-instance seed hash from instanceIndex so every head gets unique cracks & weathering.
      const instSeed = fract(sin(float(instanceIndex).mul(12.9898).add(1.234)).mul(43758.5453));
      const instOffset = vec2(instSeed.mul(13.7), fract(instSeed.mul(7.31)).mul(19.3));

      // 2a. Ancient weathered stone skin shader
      const skinMat = own(new THREE.MeshStandardNodeMaterial({ metalness: 0.0, fog: false }));
      const lp = positionGeometry;
      const ln = normalGeometry;
      const weights = pow(abs(ln), vec3(4));
      const w = weights.div(weights.x.add(weights.y).add(weights.z).add(0.0001));
      const triplanar = (scale: number) =>
        texture(noise, lp.zy.mul(scale).add(instOffset)).mul(w.x)
          .add(texture(noise, lp.xz.mul(scale).add(instOffset)).mul(w.y))
          .add(texture(noise, lp.xy.mul(scale).add(instOffset)).mul(w.z));

      const broad = triplanar(0.14);
      const fine = triplanar(0.55);
      const micro = triplanar(1.65);

      const mineral = broad.r.mul(0.5).add(fine.g.mul(0.32)).add(micro.g.mul(0.18));
      const primaryCracks = float(1).sub(smoothstep(0.025, 0.11, broad.b));
      const fineCracks = float(1).sub(smoothstep(0.02, 0.085, fine.b));
      const totalCracks = clamp(primaryCracks.mul(0.85).add(fineCracks.mul(0.45)), 0, 1);

      // Cold pale moonlit limestone matching the reference art's stark cyan-ash sculpture tone.
      const paleStone = color('#c4d6dc');
      const midStone = color('#788b97');
      const darkCrevice = color('#141a24');
      let skinColor = mix(midStone, paleStone, smoothstep(0.22, 0.82, mineral));

      // Cavernous shadow darkening inside both eye sockets so the shiny black eyeballs gleam out of dark hollows.
      const dLeftEye = lp.sub(vec3(leftEyeCenter.x, leftEyeCenter.y, leftEyeCenter.z)).length();
      const dRightEye = lp.sub(vec3(rightEyeCenter.x, rightEyeCenter.y, rightEyeCenter.z)).length();
      const dEye = min(dLeftEye, dRightEye);
      const socketAO = float(1).sub(smoothstep(eyeRadius * 1.05, eyeRadius * 2.25, dEye));
      skinColor = mix(skinColor, color('#0b0e15'), socketAO.mul(0.78));

      // Subtle weathered crimson-rust weeping streaks below the eye sockets (signature motif from the reference image).
      const belowLeftX = abs(lp.x.sub(leftEyeCenter.x));
      const belowRightX = abs(lp.x.sub(rightEyeCenter.x));
      const nearEyeX = float(1).sub(smoothstep(0.18, 0.92, min(belowLeftX, belowRightX)));
      const belowEyesY = smoothstep(0.1, 1.35, lp.y).mul(float(1).sub(smoothstep(leftEyeCenter.y - 0.55, leftEyeCenter.y - 0.05, lp.y)));
      const frontFace = smoothstep(0.95, 1.65, lp.z);
      const streakNoise = texture(noise, vec2(lp.x.mul(1.8).add(instOffset.x), lp.y.mul(0.14).add(instOffset.y))).a;
      const streakVein = smoothstep(0.58, 0.78, streakNoise.mul(0.72).add(fine.a.mul(0.28)));
      const weepMask = nearEyeX.mul(belowEyesY).mul(frontFace).mul(streakVein).mul(0.75);

      // Darken deep cracks and apply subtle crimson-rust weathering & base contact grime.
      skinColor = mix(skinColor, darkCrevice, totalCracks.mul(0.76));
      skinColor = mix(skinColor, color('#4e070b'), weepMask);
      const baseGrime = float(1).sub(smoothstep(0.0, 3.2, positionWorld.y));
      skinColor = mix(skinColor, color('#1c222b'), baseGrime.mul(0.55));

      // Cold rim silhouette edge light so distant heads still catch eerie moonlight before dissolving into pitch black.
      const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3.2);
      const coldRim = color('#587488').mul(rim).mul(0.28).mul(float(1).sub(socketAO.mul(0.8)));

      skinMat.colorNode = skinColor.mul(keepVis);
      skinMat.roughnessNode = mix(float(0.93), float(0.26), weepMask);
      skinMat.normalNode = bumpMap(mineral.mul(0.55).sub(totalCracks.mul(0.75)), float(0.048));
      skinMat.emissiveNode = mix(coldRim, color(VOID_DARK), abyssFade);

      const skinMesh = new THREE.InstancedMesh(own(copyOfGeometry(skin)), skinMat, layout.headMatrices.length);
      instanced.push(skinMesh);
      layout.headMatrices.forEach((m, i) => skinMesh.setMatrixAt(i, m));
      skinMesh.instanceMatrix.needsUpdate = true;
      skinMesh.frustumCulled = false;
      root.add(skinMesh);

      // 2b. Shiny obsidian-black eyeballs shader
      const eyeMat = own(new THREE.MeshPhysicalNodeMaterial({
        roughness: 0.035,
        metalness: 0.12,
        clearcoat: 1.0,
        clearcoatRoughness: 0.02,
        fog: false,
      }));
      const viewDir = cameraPosition.sub(positionWorld).normalize();
      const nw = normalWorld.normalize();
      const ndotv = clamp(dot(nw, viewDir), 0, 1);
      const refl = nw.mul(dot(nw, viewDir).mul(2)).sub(viewDir).normalize();

      // Twin razor-sharp specular glints (cold moon overhead + eerie crimson pool reflection below) + obsidian Fresnel sheen.
      const moonSpec = pow(max(dot(refl, vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z)), 0), 140).mul(1.65);
      const rimSpec = pow(max(dot(refl, vec3(RIM_DIR.x, RIM_DIR.y, RIM_DIR.z)), 0), 110).mul(0.95);
      const redPoolSpec = pow(max(dot(refl, vec3(0, -0.78, 0.62).normalize()), 0), 28).mul(0.32);
      const eyeFresnel = pow(float(1).sub(ndotv), 4.2).mul(0.24);

      eyeMat.colorNode = color('#030407').mul(keepVis);
      const eyeGlint = color('#dceef7').mul(moonSpec.add(rimSpec).add(eyeFresnel))
        .add(color('#b8141c').mul(redPoolSpec));
      eyeMat.emissiveNode = mix(eyeGlint, color(VOID_DARK), abyssFade);

      const eyeMesh = new THREE.InstancedMesh(own(copyOfGeometry(eyes)), eyeMat, layout.headMatrices.length);
      instanced.push(eyeMesh);
      layout.headMatrices.forEach((m, i) => eyeMesh.setMatrixAt(i, m));
      eyeMesh.instanceMatrix.needsUpdate = true;
      eyeMesh.frustumCulled = false;
      root.add(eyeMesh);
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 3. ROUGH MATTE PATH STONES & RUBBLE PILES AROUND THE COLOSSAL JAWS
    // -------------------------------------------------------------------------
    {
      const rubbleMat = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0, fog: false }));
      const p = positionWorld;
      const n = normalWorld;
      const broad = texture(noise, p.xz.mul(0.11).add(vec2(p.y.mul(0.08), p.y.mul(0.05))));
      const fine = texture(noise, p.xz.mul(0.45).add(vec2(0.23, 0.61)));
      const cracks = float(1).sub(smoothstep(0.025, 0.1, fine.b));
      const topFace = smoothstep(0.15, 0.85, n.y);
      const rockColor = mix(color('#262e39'), color('#a2b5be'), broad.r.mul(0.55).add(topFace.mul(0.45)))
        .mul(float(1).sub(cracks.mul(0.52)));
      // Subtle dark crimson stain near base of low stones sitting near pools.
      const baseWet = float(1).sub(smoothstep(0.0, 0.16, p.y));
      const stained = mix(rockColor, color('#42080c'), baseWet.mul(smoothstep(0.48, 0.72, broad.g)).mul(0.65));

      rubbleMat.colorNode = stained.mul(keepVis);
      rubbleMat.normalNode = bumpMap(fine.g.sub(cracks.mul(0.55)), float(0.045));
      rubbleMat.emissiveNode = mix(color('#000000'), color(VOID_DARK), abyssFade);

      layout.rockShapes.forEach((shape, i) => {
        const mats = layout.rockMatrices[i];
        if (!mats.length) return;
        const im = new THREE.InstancedMesh(own(copyOfGeometry(shape)), rubbleMat, mats.length);
        instanced.push(im);
        mats.forEach((m, j) => im.setMatrixAt(j, m));
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        root.add(im);
      });
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 4. JAGGED RUINED MONOLITH PILLARS LOOMING IN THE BACKGROUND DARKNESS
    // -------------------------------------------------------------------------
    {
      const pillarMat = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0, fog: false }));
      const p = positionWorld;
      const strata = texture(noise, vec2(p.x.add(p.z).mul(0.04), p.y.mul(0.025)));
      const cracks = float(1).sub(smoothstep(0.02, 0.09, strata.b));
      const pillarStone = mix(color('#1b222c'), color('#677b88'), strata.r.mul(0.75))
        .mul(float(1).sub(cracks.mul(0.65)));
      const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3.5);

      pillarMat.colorNode = pillarStone.mul(keepVis);
      pillarMat.normalNode = bumpMap(strata.g.sub(cracks.mul(0.5)), float(0.04));
      pillarMat.emissiveNode = mix(color('#3d5262').mul(rim).mul(0.22), color(VOID_DARK), abyssFade);

      layout.pillarShapes.forEach((shape, i) => {
        const mats = layout.pillarMatrices[i];
        if (!mats.length) return;
        const im = new THREE.InstancedMesh(own(copyOfGeometry(shape)), pillarMat, mats.length);
        instanced.push(im);
        mats.forEach((m, j) => im.setMatrixAt(j, m));
        im.instanceMatrix.needsUpdate = true;
        im.frustumCulled = false;
        root.add(im);
      });
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 5. SPARSE DRIFTING COLD ASH MOTES FOR MONUMENTAL DEPTH
    // -------------------------------------------------------------------------
    {
      const rest = instancedBufferAttribute(layout.motes.rest) as unknown as THREE.Node<'vec4'>;
      const seed = instancedBufferAttribute(layout.motes.seed) as unknown as THREE.Node<'vec4'>;
      const soft = pow(float(1).sub(smoothstep(0, 0.5, uv().sub(0.5).length())), 2);
      const driftX = sin(time.mul(seed.x.mul(0.25).add(0.12)).add(seed.y.mul(40))).mul(1.2);
      const driftY = cos(time.mul(seed.z.mul(0.22).add(0.1)).add(seed.w.mul(30))).mul(0.9);
      const driftZ = sin(time.mul(seed.y.mul(0.2).add(0.08)).add(seed.x.mul(25))).mul(1.5);
      const worldPos = rest.xyz.add(vec3(driftX, driftY, driftZ));
      const moteFade = float(1).sub(smoothstep(25, 130, worldPos.sub(cameraPosition).length()));

      const moteMat = own(new THREE.SpriteNodeMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }));
      moteMat.positionNode = worldPos;
      moteMat.scaleNode = rest.w;
      moteMat.colorNode = mix(color('#a4beca'), color('#9c1b22'), smoothstep(0.84, 0.96, seed.w));
      moteMat.opacityNode = soft.mul(moteFade).mul(0.32);

      const moteMesh = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 1)), moteMat);
      moteMesh.count = layout.motes.rest.count;
      moteMesh.frustumCulled = false;
      root.add(moteMesh);
    }

    let lastX = 0;
    let lastZ = 0;
    let hasLast = false;
    ctx.onActivate(() => {
      hasLast = false;
      playerSpeed.value = 0;
    });

    ctx.onUpdate((dt) => {
      const feet = ctx.player?.position;
      if (!feet) {
        playerSpeed.value = 0;
        return;
      }
      playerFeet.value.copy(feet);
      if (hasLast && dt > 1e-4) {
        const speed = Math.hypot(feet.x - lastX, feet.z - lastZ) / dt;
        const target = Math.min(1, speed / 5.5);
        playerSpeed.value += (target - playerSpeed.value) * Math.min(1, dt * 6);
      }
      lastX = feet.x;
      lastZ = feet.z;
      hasLast = true;
    });
  },
});
