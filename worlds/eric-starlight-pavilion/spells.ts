import * as THREE from 'three/webgpu';
import type { DancerId } from './dancers';

export interface SpellHitTarget {
  x: number;
  z: number;
  radius: number;
  onHit: (colorHex: string) => void;
}

export interface SpellSystemCallbacks {
  onFloorShockwave: (x: number, z: number, colorHex: string, strength: number) => void;
  getTotemTargets: () => SpellHitTarget[];
  getOrbTargets: () => SpellHitTarget[];
  onTriggerSparklers: (colorHex: string) => void;
}

interface ActiveVfx {
  age: number;
  maxAge: number;
  update: (dt: number, normAge: number) => void;
  cleanup: () => void;
}

/**
 * 3D Spell & Flourish Visual Effects System for all 6 character powers:
 * - Soraya 1: Zellige Starburst (8 spinning gold-teal geometric star blades)
 * - Soraya 2: Aurora Canopy (floating shimmering overhead aurora ribbons + zero-G levitation)
 * - Dex 1: Prism Laser Nova (12 rainbow sweeping laser beams + bass shockwave)
 * - Dex 2: Holo-Clone Rush (3 spinning translucent neon holographic dance clones)
 * - Ermelin 1: Blizzard Ribbon Twirl (60 swirling ice snowflakes + frost crystal floor)
 * - Ermelin 2: Lantern Comet Ring (5 orbiting & homing golden lantern comets auto-ringing totems)
 */
export class SpellVfxSystem {
  readonly root = new THREE.Group();
  private readonly callbacks: SpellSystemCallbacks;
  private readonly active: ActiveVfx[] = [];
  private readonly sharedGeos: THREE.BufferGeometry[] = [];

  // Shared spell durations queried by room loop
  levitateRemaining = 0;
  frostRemaining = 0;

  // Shared reusable primitives to keep GPU allocations lightweight
  private readonly starGeo: THREE.OctahedronGeometry;
  private readonly laserGeo: THREE.CylinderGeometry;
  private readonly flakeGeo: THREE.OctahedronGeometry;
  private readonly cloneBodyGeo: THREE.CapsuleGeometry;
  private readonly cloneHeadGeo: THREE.SphereGeometry;
  private readonly ribbonGeo: THREE.TorusGeometry;
  private readonly sparkGeo: THREE.SphereGeometry;

  constructor(callbacks: SpellSystemCallbacks) {
    this.callbacks = callbacks;
    this.root.name = 'starlight-spell-vfx';

    this.starGeo = new THREE.OctahedronGeometry(0.28, 0);
    this.starGeo.scale(1.25, 0.24, 1.25);

    this.laserGeo = new THREE.CylinderGeometry(0.032, 0.055, 11.5, 8, 1, true);
    this.laserGeo.rotateX(Math.PI / 2);
    this.laserGeo.translate(0, 0, 5.75);

    this.flakeGeo = new THREE.OctahedronGeometry(0.11, 0);
    this.flakeGeo.scale(1.2, 0.25, 1.2);

    this.cloneBodyGeo = new THREE.CapsuleGeometry(0.24, 0.85, 6, 12);
    this.cloneHeadGeo = new THREE.SphereGeometry(0.17, 12, 10);
    this.ribbonGeo = new THREE.TorusGeometry(6.8, 0.22, 10, 48);
    this.ribbonGeo.rotateX(Math.PI / 2);
    this.sparkGeo = new THREE.SphereGeometry(0.14, 10, 8);

    this.sharedGeos.push(
      this.starGeo,
      this.laserGeo,
      this.flakeGeo,
      this.cloneBodyGeo,
      this.cloneHeadGeo,
      this.ribbonGeo,
      this.sparkGeo,
    );
  }

  cast(dancerId: DancerId, slot: 1 | 2, origin: THREE.Vector3): void {
    if (dancerId === 'soraya') {
      if (slot === 1) this.spawnZelligeStarburst(origin);
      else this.spawnAuroraCanopy(origin);
    } else if (dancerId === 'dex') {
      if (slot === 1) this.spawnPrismLaserNova(origin);
      else this.spawnHoloCloneRush(origin);
    } else {
      if (slot === 1) this.spawnBlizzardTwirl(origin);
      else this.spawnLanternComets(origin);
    }
  }

  /** Small celebratory sparkle burst for swipes, leaps, and Perfect Beat hits! */
  spawnFlourishBurst(origin: THREE.Vector3, colorHex: string, count = 12): void {
    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const parts: Array<{ mesh: THREE.Mesh; vx: number; vy: number; vz: number }> = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.position.set(origin.x, origin.y + 0.9, origin.z);
      m.scale.setScalar(0.65);
      group.add(m);
      parts.push({
        mesh: m,
        vx: Math.cos(a) * (2.2 + (i % 3) * 0.9),
        vy: 1.8 + (i % 4) * 0.75,
        vz: Math.sin(a) * (2.2 + (i % 3) * 0.9),
      });
    }
    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 0.85,
      update: (dt, t) => {
        mat.opacity = 1 - t;
        for (const p of parts) {
          p.mesh.position.x += p.vx * dt;
          p.mesh.position.y += p.vy * dt;
          p.mesh.position.z += p.vz * dt;
          p.vy -= 4.2 * dt;
          p.mesh.scale.setScalar(Math.max(0.05, (1 - t) * 0.7));
        }
      },
      cleanup: () => {
        this.root.remove(group);
        mat.dispose();
      },
    });
  }

  private spawnZelligeStarburst(origin: THREE.Vector3): void {
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#fbbf24', 1.3);
    this.callbacks.onTriggerSparklers('#fbbf24');

    const group = new THREE.Group();
    const goldMat = new THREE.MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tealMat = new THREE.MeshBasicMaterial({
      color: '#2dd4bf',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const blades: Array<{ mesh: THREE.Mesh; ang: number }> = [];
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(this.starGeo, i % 2 === 0 ? goldMat : tealMat);
      m.position.set(origin.x, origin.y + 1.15, origin.z);
      group.add(m);
      blades.push({ mesh: m, ang });
    }
    const hitSet = new Set<SpellHitTarget>();
    const allTargets = [...this.callbacks.getTotemTargets(), ...this.callbacks.getOrbTargets()];

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 1.85,
      update: (_dt, t) => {
        const radius = 0.8 + t * 11.4;
        const spin = t * Math.PI * 3.5;
        const fade = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
        goldMat.opacity = 0.95 * fade;
        tealMat.opacity = 0.9 * fade;

        for (const b of blades) {
          const a = b.ang + spin * 0.45;
          const bx = origin.x + Math.cos(a) * radius;
          const bz = origin.z + Math.sin(a) * radius;
          b.mesh.position.set(bx, origin.y + 1.15 + Math.sin(t * 9 + b.ang) * 0.35, bz);
          b.mesh.rotation.y = spin * 2.2;
          b.mesh.scale.setScalar(1.0 + Math.sin(t * Math.PI) * 0.65);

          for (const target of allTargets) {
            if (hitSet.has(target)) continue;
            if (Math.hypot(bx - target.x, bz - target.z) < target.radius + 1.3) {
              hitSet.add(target);
              target.onHit('#fbbf24');
            }
          }
        }
      },
      cleanup: () => {
        this.root.remove(group);
        goldMat.dispose();
        tealMat.dispose();
      },
    });
  }

  private spawnAuroraCanopy(origin: THREE.Vector3): void {
    this.levitateRemaining = Math.max(this.levitateRemaining, 5.2);
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#2dd4bf', 1.4);

    const group = new THREE.Group();
    const mats: THREE.MeshBasicMaterial[] = [];
    const rings: THREE.Mesh[] = [];
    const colors = ['#2dd4bf', '#fbbf24', '#818cf8'];

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mats.push(mat);
      const ring = new THREE.Mesh(this.ribbonGeo, mat);
      ring.position.set(0, 3.6 + i * 1.45, 0);
      ring.scale.set(0.65 + i * 0.16, 1, 0.65 + i * 0.16);
      group.add(ring);
      rings.push(ring);
    }

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 5.2,
      update: (dt, t) => {
        const env = Math.sin(Math.min(1, t * 4) * (Math.PI / 2)) * (t > 0.78 ? 1 - (t - 0.78) / 0.22 : 1);
        rings.forEach((r, i) => {
          r.rotation.y += dt * (0.7 + i * 0.35) * (i % 2 === 0 ? 1 : -1);
          r.rotation.z = Math.sin(t * 6 + i * 1.9) * 0.22;
          r.rotation.x = Math.cos(t * 5 + i * 1.3) * 0.18;
          mats[i].opacity = 0.52 * env;
        });
      },
      cleanup: () => {
        this.root.remove(group);
        for (const m of mats) m.dispose();
      },
    });
  }

  private spawnPrismLaserNova(origin: THREE.Vector3): void {
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#ff2a85', 1.5);
    this.callbacks.onTriggerSparklers('#ff2a85');

    // Immediately supercharge all disco prism orbs & totems hit by the sweeping fan!
    for (const orb of this.callbacks.getOrbTargets()) orb.onHit('#ff2a85');
    for (const totem of this.callbacks.getTotemTargets()) {
      if (Math.hypot(totem.x - origin.x, totem.z - origin.z) < 11.5) {
        totem.onHit('#22d3ee');
      }
    }

    const group = new THREE.Group();
    group.position.set(origin.x, origin.y + 1.35, origin.z);
    const palette = ['#ff2a85', '#22d3ee', '#a855f7', '#fbbf24', '#34d399', '#38bdf8'];
    const mats: THREE.MeshBasicMaterial[] = [];

    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: palette[i % palette.length],
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mats.push(mat);
      const beam = new THREE.Mesh(this.laserGeo, mat);
      beam.rotation.y = (i / 12) * Math.PI * 2;
      beam.rotation.x = -0.14 + (i % 2 === 0 ? 0.22 : -0.06);
      group.add(beam);
    }

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 2.1,
      update: (dt, t) => {
        group.rotation.y += dt * (2.6 + (1 - t) * 2.2);
        const fade = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
        for (const m of mats) m.opacity = 0.88 * fade;
      },
      cleanup: () => {
        this.root.remove(group);
        for (const m of mats) m.dispose();
      },
    });
  }

  private spawnHoloCloneRush(origin: THREE.Vector3): void {
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#22d3ee', 1.2);

    const group = new THREE.Group();
    const colors = ['#22d3ee', '#ff2a85', '#a855f7'];
    const mats: THREE.MeshBasicMaterial[] = [];
    const clones: THREE.Group[] = [];

    for (let i = 0; i < 3; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0.62,
        wireframe: i === 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      mats.push(mat);
      const cg = new THREE.Group();
      const body = new THREE.Mesh(this.cloneBodyGeo, mat);
      body.position.y = 0.78;
      const head = new THREE.Mesh(this.cloneHeadGeo, mat);
      head.position.y = 1.48;
      cg.add(body, head);
      group.add(cg);
      clones.push(cg);
    }

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 3.4,
      update: (dt, t) => {
        const radius = 1.9 + Math.sin(t * Math.PI) * 1.45;
        const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        clones.forEach((cg, i) => {
          const a = (i / 3) * Math.PI * 2 + t * Math.PI * 3.8;
          cg.position.set(
            origin.x + Math.cos(a) * radius,
            origin.y + Math.abs(Math.sin(t * 14 + i * 2)) * 0.45,
            origin.z + Math.sin(a) * radius,
          );
          cg.rotation.y += dt * 7.5;
          mats[i].opacity = 0.65 * fade;
        });
      },
      cleanup: () => {
        this.root.remove(group);
        for (const m of mats) m.dispose();
      },
    });
  }

  private spawnBlizzardTwirl(origin: THREE.Vector3): void {
    this.frostRemaining = Math.max(this.frostRemaining, 5.0);
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#93c5fd', 1.4);

    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const flakes: Array<{ mesh: THREE.Mesh; ang: number; baseR: number; hSpeed: number; baseH: number }> = [];
    for (let i = 0; i < 60; i++) {
      const m = new THREE.Mesh(this.flakeGeo, mat);
      const ang = (i / 60) * Math.PI * 4;
      const baseR = 0.7 + (i % 10) * 0.62;
      const baseH = 0.2 + (i % 7) * 0.45;
      m.position.set(origin.x + Math.cos(ang) * baseR, baseH, origin.z + Math.sin(ang) * baseR);
      group.add(m);
      flakes.push({ mesh: m, ang, baseR, hSpeed: 0.6 + (i % 5) * 0.24, baseH });
    }

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 4.0,
      update: (dt, t) => {
        const fade = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
        mat.opacity = 0.9 * fade;
        for (const f of flakes) {
          f.ang += dt * (2.6 + (1 - f.baseR / 7.5) * 2.2);
          const r = f.baseR + t * 2.4;
          const y = ((f.baseH + t * 4.0 * f.hSpeed) % 4.6) + 0.15;
          f.mesh.position.set(origin.x + Math.cos(f.ang) * r, y, origin.z + Math.sin(f.ang) * r);
          f.mesh.rotation.y += dt * 5;
          f.mesh.rotation.x += dt * 3;
        }
      },
      cleanup: () => {
        this.root.remove(group);
        mat.dispose();
      },
    });
  }

  private spawnLanternComets(origin: THREE.Vector3): void {
    this.callbacks.onFloorShockwave(origin.x, origin.z, '#f59e0b', 1.35);
    this.callbacks.onTriggerSparklers('#f59e0b');

    const group = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const totems = this.callbacks.getTotemTargets();
    const orbs = this.callbacks.getOrbTargets();
    const targets = [...totems, ...orbs];

    const comets: Array<{ mesh: THREE.Mesh; startAng: number; target: SpellHitTarget | null; hit: boolean }> = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat);
      m.scale.setScalar(1.35);
      group.add(m);
      comets.push({
        mesh: m,
        startAng: (i / 5) * Math.PI * 2,
        target: targets.length > 0 ? targets[i % targets.length] : null,
        hit: false,
      });
    }

    this.root.add(group);
    this.active.push({
      age: 0,
      maxAge: 2.3,
      update: (_dt, t) => {
        const fade = t > 0.8 ? 1 - (t - 0.8) / 0.2 : 1;
        mat.opacity = 0.95 * fade;
        for (const c of comets) {
          if (t < 0.36 || !c.target) {
            const a = c.startAng + t * Math.PI * 6;
            const r = 1.65;
            c.mesh.position.set(
              origin.x + Math.cos(a) * r,
              origin.y + 1.45 + Math.sin(t * 14 + c.startAng) * 0.3,
              origin.z + Math.sin(a) * r,
            );
          } else {
            const k = Math.min(1, (t - 0.36) / 0.52);
            const ease = k * k * (3 - 2 * k);
            const sx = origin.x + Math.cos(c.startAng + 0.36 * Math.PI * 6) * 1.65;
            const sz = origin.z + Math.sin(c.startAng + 0.36 * Math.PI * 6) * 1.65;
            const x = sx + (c.target.x - sx) * ease;
            const z = sz + (c.target.z - sz) * ease;
            const y = 1.5 + Math.sin(k * Math.PI) * 2.4;
            c.mesh.position.set(x, y, z);
            if (!c.hit && k >= 0.88) {
              c.hit = true;
              c.target.onHit('#f59e0b');
            }
          }
        }
      },
      cleanup: () => {
        this.root.remove(group);
        mat.dispose();
      },
    });
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    this.levitateRemaining = Math.max(0, this.levitateRemaining - step);
    this.frostRemaining = Math.max(0, this.frostRemaining - step);

    for (let i = this.active.length - 1; i >= 0; i--) {
      const fx = this.active[i];
      fx.age += step;
      const norm = Math.min(1, fx.age / fx.maxAge);
      fx.update(step, norm);
      if (fx.age >= fx.maxAge) {
        fx.cleanup();
        this.active.splice(i, 1);
      }
    }
  }

  dispose(): void {
    for (const fx of this.active) fx.cleanup();
    this.active.length = 0;
    for (const g of this.sharedGeos) g.dispose();
    this.sharedGeos.length = 0;
  }
}
