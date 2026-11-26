import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  color,
  float,
  mix,
  normalWorld,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
} from 'three/tsl';

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

/** Creates geometries, materials and textures that are all disposed together. */
export function createResources() {
  const owned: Array<{ dispose(): void }> = [];
  const own = <T extends { dispose(): void }>(resource: T): T => {
    owned.push(resource);
    return resource;
  };
  return { own, geo: own, dispose: () => owned.splice(0).forEach(r => r.dispose()) };
}
export type Resources = ReturnType<typeof createResources>;

/**
 * The fire-to-ice change, as uniforms every material reads. `drain` runs 0..1 as the lava
 * cools and crusts over; `ice` runs 0..1 as frost and ice take over. Set from JS each frame.
 */
export function createClimateUniforms() {
  return { drain: uniform(0), ice: uniform(0), lakeDip: uniform(0) };
}
export type ClimateUniforms = ReturnType<typeof createClimateUniforms>;

const c = (hex: string) => color(new THREE.Color(hex));

/** Cheap layered sine noise, roughly 0..1. */
function wobble(p: Vec3Node, scale: number): FloatNode {
  const s = p.mul(scale);
  return sin(s.x.add(sin(s.z.mul(1.7)).mul(1.3)))
    .mul(sin(s.z.mul(1.1).add(sin(s.x.mul(0.9).add(s.y)).mul(1.5))))
    .mul(0.5)
    .add(sin(s.x.mul(2.3).sub(s.z.mul(1.9)).add(s.y.mul(1.4))).mul(0.25))
    .add(0.5);
}

/** Glowing veins: bright along the zero lines of a warped sine pattern. */
function veins(p: Vec3Node, scale: number, flow: FloatNode, width = 0.09): FloatNode {
  const s = p.mul(scale);
  const a = sin(s.x.mul(1.3).add(sin(s.y.mul(1.7).add(flow)).mul(1.2)).add(s.z.mul(0.7)));
  const b = sin(s.z.mul(1.5).sub(sin(s.x.mul(1.1).sub(flow.mul(0.7))).mul(1.1)).add(s.y.mul(0.9)));
  return float(1).sub(smoothstep(0, width, abs(a.mul(b))));
}

/** Cave rock: dark basalt lit by lava from below, frosting over from the top. */
export function rockMaterial(u: ClimateUniforms, own: Resources['own']): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 }));
  const p = positionWorld;
  const n = wobble(p, 0.55);
  const base = mix(c('#2a211d'), c('#4b3a31'), n);
  const frostCover = u.ice.mul(clamp(normalWorld.y.mul(1.4).sub(0.15), 0, 1).mul(0.75).add(0.2));
  m.colorNode = mix(base, mix(c('#b9d4e6'), c('#e8f4ff'), n), frostCover);
  // Lava light pooling low down, and a few hot cracks in the rock.
  const low = smoothstep(0.4, -1.0, p.y);
  const cracks = veins(p, 0.9, time.mul(0.15)).mul(smoothstep(1.2, -0.6, p.y));
  const heat = float(1).sub(u.drain);
  // High up, faint veins glow through the ceiling: smouldering embers over the lava, aqua over the ice.
  const high = smoothstep(5, 13, p.y);
  const magicVeins = veins(p, 0.45, time.mul(0.08), 0.06).mul(high);
  const magicHue = mix(c('#ff5a1a').mul(0.7), c('#3ff0ff'), u.ice);
  m.emissiveNode = c('#ff5a14').mul(low.mul(0.35).add(cracks.mul(0.9))).mul(heat)
    .add(c('#3a6f99').mul(u.ice.mul(low).mul(0.12)))
    .add(magicHue.mul(magicVeins.mul(0.9).add(high.mul(0.04))));
  m.roughnessNode = mix(float(0.92), float(0.45), frostCover);
  return m;
}

/** The lakes: flowing lava that crusts over and drains, then pale glossy ice. */
export function lakeMaterial(u: ClimateUniforms, own: Resources['own']): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.8, metalness: 0 }));
  const p = positionWorld;
  const flow = time.mul(0.25);
  const n = wobble(p.add(vec3(time.mul(0.3), 0, time.mul(0.17))), 0.18);
  const glowVeins = veins(p, 0.35, flow, 0.22);
  // Crust spreads in blotches as the lava cools.
  const crust = smoothstep(n.sub(0.15), n.add(0.15), u.drain.mul(1.35));
  const lavaColor = mix(c('#ff3d00'), c('#ffb22e'), glowVeins.mul(0.7).add(n.mul(0.3)));
  const cooled = c('#1a1412');
  const iceColor = mix(c('#8fc7e8'), c('#d8f0ff'), wobble(p, 0.4));
  m.colorNode = mix(mix(lavaColor.mul(0.4), cooled, crust), iceColor, u.ice);
  const lavaGlow = lavaColor.mul(n.mul(0.9).add(glowVeins.mul(1.4)).add(0.6)).mul(float(1).sub(crust));
  const iceCracks = veins(p, 0.6, float(0), 0.05).mul(u.ice);
  m.emissiveNode = lavaGlow.mul(1.6).add(c('#4aa8e0').mul(iceCracks.mul(0.35).add(u.ice.mul(0.05))));
  m.roughnessNode = mix(mix(float(0.55), float(0.95), crust), float(0.06), u.ice);
  m.metalnessNode = u.ice.mul(0.15);
  return m;
}

/** The monster's pool: lava, then cold dark icy water with a frosted sheen. */
export function poolMaterial(u: ClimateUniforms, own: Resources['own']): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0 }));
  const p = positionWorld;
  const n = wobble(p.add(vec3(time.mul(-0.4), 0, time.mul(0.25))), 0.3);
  const ripple = sin(p.x.mul(1.4).add(time.mul(1.2))).mul(sin(p.z.mul(1.2).sub(time))).mul(0.5).add(0.5);
  const lava = mix(c('#ff4a08'), c('#ffc23a'), n);
  const water = mix(c('#0d2a40'), c('#2d6c8c'), ripple.mul(0.6).add(n.mul(0.4)));
  m.colorNode = mix(lava.mul(0.5), water, u.ice);
  m.emissiveNode = lava.mul(n.mul(0.8).add(1)).mul(float(1).sub(u.ice))
    .add(c('#3d9fd0').mul(ripple.mul(0.25).mul(u.ice)));
  m.roughnessNode = mix(float(0.6), float(0.04), u.ice);
  return m;
}

/** The monster's skin: dark rock with flowing lava veins, then pale crystal with glowing frost veins. */
export function skinMaterial(u: ClimateUniforms, own: Resources['own'], belly = false): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0 }));
  const p = positionLocal;
  const v = veins(p, belly ? 2.2 : 1.6, time.mul(0.6), 0.14);
  const lavaSkin = belly ? c('#6a2a12') : c('#3a1a12');
  const iceSkin = belly ? c('#d7efff') : c('#8ec9ec');
  m.colorNode = mix(mix(lavaSkin, c('#ff7a1a'), v.mul(0.5)), mix(iceSkin, c('#ffffff'), v.mul(0.4)), u.ice);
  const warm = c('#ff5a10').mul(v.mul(2.2).add(belly ? 0.35 : 0.12));
  const cold = c('#5ec8ff').mul(v.mul(0.9).add(0.08));
  m.emissiveNode = mix(warm, cold, u.ice);
  m.roughnessNode = mix(float(0.75), float(0.18), u.ice);
  m.metalnessNode = u.ice.mul(0.1);
  return m;
}

/** Horns: charred at the root and molten at the tip, then clear ice. `length` is the horn's local height. */
export function hornMaterial(u: ClimateUniforms, own: Resources['own'], length: number): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0 }));
  const along = clamp(positionLocal.y.div(length), 0, 1);
  const lava = mix(c('#2b1610'), c('#ffb02e'), smoothstep(0.35, 1, along));
  const ice = mix(c('#bfe8ff'), c('#f2fbff'), along);
  m.colorNode = mix(lava, ice, u.ice);
  const pulse = sin(time.mul(2.2).sub(along.mul(6))).mul(0.2).add(0.8);
  m.emissiveNode = mix(c('#ff6a10').mul(smoothstep(0.3, 1, along).mul(2.4).mul(pulse)), c('#7fd4ff').mul(along.mul(0.6).add(0.15)), u.ice);
  m.roughnessNode = mix(float(0.6), float(0.05), u.ice);
  return m;
}

/** Dripping lava drops that become drifting snowflakes. */
export function dripMaterial(u: ClimateUniforms, own: Resources['own']): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.4, metalness: 0 }));
  m.colorNode = mix(c('#ff7a1a'), c('#f4fbff'), u.ice);
  m.emissiveNode = mix(c('#ff6a12').mul(2.5), c('#a8dcff').mul(0.6), u.ice);
  return m;
}

/** Icicles: translucent pale blue with a bright core. */
export function icicleMaterial(own: Resources['own']): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }));
  m.colorNode = mix(c('#e9f8ff'), c('#7fc3ea'), smoothstep(0, -1, positionLocal.y));
  m.emissiveNode = c('#5bb6e8').mul(0.25);
  return m;
}

/** A plain material whose colour and glow cross-fade with `ice`. */
export function fadeMaterial(
  u: ClimateUniforms,
  own: Resources['own'],
  fire: { color: string; emissive?: string; glow?: number },
  ice: { color: string; emissive?: string; glow?: number },
  options: THREE.MeshStandardNodeMaterialParameters = {},
): THREE.MeshStandardNodeMaterial {
  const m = own(new THREE.MeshStandardNodeMaterial({ roughness: 0.6, ...options }));
  m.colorNode = mix(c(fire.color), c(ice.color), u.ice);
  m.emissiveNode = mix(c(fire.emissive ?? '#000000').mul(fire.glow ?? 1), c(ice.emissive ?? '#000000').mul(ice.glow ?? 1), u.ice);
  return m;
}

export function plainMaterial(own: Resources['own'], hex: string, options: THREE.MeshStandardNodeMaterialParameters = {}) {
  return own(new THREE.MeshStandardNodeMaterial({ color: new THREE.Color(hex), roughness: 0.6, ...options }));
}
