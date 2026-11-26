import type { RoomEnv, RoomFeature, FrameState } from '../env';
import pathShader from './path.wgsl';
import { buildPathMesh } from './mesh';

const ADD = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
} as const;

/**
 * The Palace Lagoon's boardwalk over the reflecting cove and trippy ascending celestial sky-path
 * into the dome-roof portal, registered as a weft RoomFeature so it casts shadows, mirrors in the
 * lagoon, and receives sunset-to-night + projection-mapping lighting.
 */
export function createPathway(env: RoomEnv): RoomFeature {
  const { kit, scene, refl, shadow, world, projection } = env;
  const mesh = buildPathMesh();

  const vb = kit.storage({
    label: 'lagoon.path.verts',
    size: mesh.verts.byteLength,
    usage: ['storage', 'copy-dst'],
    data: new Uint8Array(mesh.verts),
  });
  const ib = kit.storage({
    label: 'lagoon.path.idx',
    size: mesh.indices.byteLength,
    usage: ['index', 'copy-dst'],
    data: mesh.indices,
  });

  const haloCount = Math.max(1, mesh.lanterns.length);
  const haloData = new Float32Array(haloCount * 8);
  mesh.lanterns.forEach((l, i) => {
    haloData.set([l.pos[0], l.pos[1], l.pos[2], l.phase, l.tint[0], l.tint[1], l.tint[2], l.scale], i * 8);
  });
  const halos = kit.storage({
    label: 'lagoon.path.halos',
    size: haloData.byteLength,
    usage: ['storage', 'copy-dst'],
    data: haloData,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const params = kit.uniforms(pathShader.structs.PathUniforms, 'lagoon.path.params');
  params.set({ player: [0, -1000, 0, 0], meta: [mesh.lanterns.length, 0, 0, 0] });

  const indices = { buffer: ib, format: 'uint32' as const };
  const bind = { ...world, ...projection.bindings, verts: vb, P: params, halos };
  const haloBind = { ...world, P: params, halos };

  const draws: Array<{ ready(): Promise<unknown> }> = [];
  draws.push(shadow.draw(pathShader, {
    label: 'lagoon.path.shadow',
    vertex: 'vsShadow',
    fragment: null,
    indices,
    bind: { verts: vb },
    count: mesh.count,
    cull: 'none',
  }));

  for (const [pass, tag] of [[refl, 'refl'], [scene, 'main']] as const) {
    draws.push(pass.draw(pathShader, {
      label: `lagoon.path.${tag}`,
      vertex: 'vs',
      fragment: 'fs',
      indices,
      bind,
      count: mesh.count,
      cull: 'none',
      phase: 'opaque',
    }));
    if (mesh.lanterns.length > 0) {
      draws.push(pass.draw(pathShader, {
        label: `lagoon.path.halos.${tag}`,
        vertex: 'vsHalo',
        fragment: 'fsHalo',
        bind: haloBind,
        count: 6,
        instances: mesh.lanterns.length,
        cull: 'none',
        depthWrite: false,
        blend: ADD,
        phase: 'glow',
      }));
    }
  }

  return {
    ready: Promise.all(draws.map(d => d.ready())).then(() => undefined),
    frame(state: FrameState): void {
      const pl = state.player;
      params.set({
        player: pl ? [pl[0], pl[1], pl[2], 1] : [0, -1000, 0, 0],
        meta: [mesh.lanterns.length, 0, 0, 0],
      });
    },
  };
}
