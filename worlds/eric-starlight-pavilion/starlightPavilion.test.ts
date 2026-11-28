import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three/webgpu';
import { DANCER_CONFIGS, DancePerformer } from './dancers';
import { SpellVfxSystem } from './spells';
import { CHIME_TOTEM_SPOTS, GEYSER_SPOTS, TURNTABLE_POS, buildStageProps } from './stageProps';

describe('Starlight Dance Pavilion', () => {
  it('configures Soraya, Dex, and Ermelin with 2 distinct spells each and runs dance choreography headlessly', () => {
    expect(DANCER_CONFIGS.map((c) => c.id)).toEqual(['soraya', 'dex', 'ermelin']);

    const dancers = DANCER_CONFIGS.map((cfg) => new DancePerformer(cfg));
    try {
      for (const d of dancers) {
        expect(d.config.spells).toHaveLength(2);
        expect(d.canCastSpell(1)).toBe(true);
        expect(d.canCastSpell(2)).toBe(true);
      }

      // Take over Dex and move + spin + cast spells
      const dex = dancers[1];
      dex.setControlled(true);
      dex.triggerFlourish('spin_left');
      const startX = dex.pos.x;
      for (let i = 0; i < 15; i++) {
        dex.update(0.033, i * 0.033, 'hypergroove', false, false, dex, 0, {
          moveX: 1,
          moveZ: 0,
          sprint: false,
          swirlIntensity: 0.4,
        });
      }
      expect(dex.pos.x).toBeGreaterThan(startX + 0.5);

      const spell1 = dex.markSpellCast(1);
      expect(spell1.name).toBe('Prism Laser Nova');
      expect(dex.canCastSpell(1)).toBe(false);

      // Geyser launch lifts the dancer high off the floor
      dex.launchGeyser(10.6);
      dex.update(0.05, 1.0, 'celestial', false, false, dex, 0, null);
      expect(dex.group.position.y).toBeGreaterThan(0.3);
    } finally {
      for (const d of dancers) d.dispose();
    }
  });

  it('keeps the portal-to-portal promenade corridor clear of solid colliders and lights Starlight Overdrive on 3 totems', () => {
    let overdriveFired = false;
    let orbSpins = 0;
    const props = buildStageProps(
      (_idx, allLitNow) => {
        if (allLitNow) overdriveFired = true;
      },
      () => {
        orbSpins++;
      },
    );

    try {
      // Every point along X = 0 from Z = +36.25 to -36.25 must be completely unobstructed!
      for (let z = -36; z <= 36; z += 1.5) {
        const [rx, rz] = props.collider.move([0, 0, z + 0.5], [0, 0, z], 0.45, 1.8);
        expect(Math.abs(rx)).toBeLessThan(0.05);
        expect(Math.abs(rz - z)).toBeLessThan(0.05);
      }

      // Verify turntable, chime totems, and geysers sit off the center walkway
      expect(Math.abs(TURNTABLE_POS.x)).toBeGreaterThan(3.5);
      for (const t of CHIME_TOTEM_SPOTS) expect(Math.abs(t.x)).toBeGreaterThan(3.5);
      for (const g of GEYSER_SPOTS) expect(Math.abs(g.x)).toBeGreaterThan(3.5);

      // Lighting all 3 Harmonic Chime Totems triggers Starlight Overdrive
      expect(props.allTotemsLit()).toBe(false);
      props.triggerTotem(0);
      props.triggerTotem(1);
      expect(overdriveFired).toBe(false);
      props.triggerTotem(2);
      expect(props.allTotemsLit()).toBe(true);
      expect(overdriveFired).toBe(true);

      // Casting all 6 spells runs cleanly and interacts with totems & orbs
      const shocks: string[] = [];
      const spells = new SpellVfxSystem({
        onFloorShockwave: (_x, _z, col) => shocks.push(col),
        getTotemTargets: () => props.getTotemTargets(),
        getOrbTargets: () => props.getOrbTargets(),
        onTriggerSparklers: (col) => props.triggerSparklers(col),
      });
      try {
        const origin = new THREE.Vector3(0, 0, 0);
        spells.cast('soraya', 1, origin);
        spells.cast('soraya', 2, origin);
        expect(spells.levitateRemaining).toBeGreaterThan(4);
        spells.cast('dex', 1, origin);
        expect(orbSpins).toBeGreaterThan(0);
        spells.cast('dex', 2, origin);
        spells.cast('ermelin', 1, origin);
        expect(spells.frostRemaining).toBeGreaterThan(4);
        spells.cast('ermelin', 2, origin);
        for (let i = 0; i < 60; i++) {
          spells.update(0.05);
          props.update(0.05, i * 0.05, 'waltz', true);
        }
        expect(shocks.length).toBeGreaterThanOrEqual(6);
      } finally {
        spells.dispose();
      }
    } finally {
      props.dispose();
    }
  });

  it('ships valid uncompressed Blender GLBs with required animated nodes under the room budget', () => {
    const assetsDir = path.resolve(__dirname, 'assets');
    const expected: Array<[string, string]> = [
      ['dance_gazebo.glb', 'ChandelierCore'],
      ['dj_gramophone.glb', 'TurntablePlatter'],
      ['chime_totem.glb', 'ChimeCrystal'],
      ['star_fountain.glb', 'GeyserRing'],
    ];
    const forbiddenExts = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
    let totalBytes = 0;

    for (const [file, requiredNode] of expected) {
      const fullPath = path.join(assetsDir, file);
      expect(fs.existsSync(fullPath), `Missing ${file}`).toBe(true);
      const buf = fs.readFileSync(fullPath);
      totalBytes += buf.byteLength;
      expect(buf.byteLength).toBeGreaterThan(20_000);
      expect(buf.byteLength).toBeLessThan(4 * 1024 * 1024);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
      const jsonLen = buf.readUInt32LE(12);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
        nodes?: Array<{ name?: string }>;
        extensionsUsed?: string[];
      };
      const nodeNames = (gltf.nodes ?? []).map((n) => n.name);
      expect(nodeNames, `${file} missing animated node ${requiredNode}`).toContain(requiredNode);
      for (const ext of forbiddenExts) {
        expect(gltf.extensionsUsed ?? []).not.toContain(ext);
      }
    }
    expect(totalBytes).toBeLessThan(6 * 1024 * 1024);
  });
});
