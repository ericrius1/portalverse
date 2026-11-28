import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { createPromenadeWalkMaterial, createStarlightFloorMaterial, createStarlightSkyMaterial } from './shaders';
import { createPavilionAudio, type PavilionAudio } from './audio';
import {
  DANCER_CONFIGS,
  DancePerformer,
  type DanceStyle,
  type DancerId,
  type FlourishKind,
} from './dancers';
import { SpellVfxSystem } from './spells';
import { STAGE_RADIUS, TURNTABLE_POS, buildStageProps } from './stageProps';
import { StarlightDanceUi } from './controlsUi';

const DANCE_STYLES: readonly DanceStyle[] = ['waltz', 'hypergroove', 'celestial'];

/**
 * STARLIGHT DANCE PAVILION (`eric-starlight-pavilion`)
 * A celestial festival stage where Soraya, Dex, and Ermelin dance together in
 * choreographed 88 BPM harmony. Click/tap any of the three dancers (or press 1/2/3)
 * to take over dancing them with phone swipes, trackpad/mouse swipes, or keyboard,
 * unleash each character's 2 signature spells, bounce off Zero-G Star Geysers,
 * ring the 3 Harmonic Crystal Chime Totems for Starlight Overdrive, spin the
 * hovering mirror-prism orbs, and remix the light show at the Celestial Turntable!
 */
export default defineRoom('eric-starlight-pavilion', {
  async mount(ctx) {
    const root = new THREE.Group();
    root.name = 'eric-starlight-pavilion-root';
    ctx.scene.add(root);

    ctx.scene.background = new THREE.Color('#0c1026');
    ctx.scene.fog = new THREE.FogExp2('#101432', 0.0095);
    ctx.setTerrainHeight(() => 0);

    const ownedGeos: THREE.BufferGeometry[] = [];
    const ownedMats: THREE.Material[] = [];
    const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      ownedGeos.push(g);
      return g;
    };
    const trackMat = <T extends THREE.Material>(m: T): T => {
      ownedMats.push(m);
      return m;
    };

    // Rich festival stage lighting: celestial indigo sky bounce + warm golden key + magenta/teal rims
    const hemi = new THREE.HemisphereLight('#a5b4fc', '#1e1b4b', 1.2);
    const keyLight = new THREE.DirectionalLight('#fff3d6', 1.75);
    keyLight.position.set(14, 24, 18);
    const rimTeal = new THREE.DirectionalLight('#2dd4bf', 0.95);
    rimTeal.position.set(-18, 12, -16);
    const rimMagenta = new THREE.DirectionalLight('#f472b6', 0.85);
    rimMagenta.position.set(16, 10, -18);
    root.add(hemi, keyLight, rimTeal, rimMagenta);

    // Fog-exempt Twilight Aurora Nebula Sky Dome
    const skyMat = trackMat(createStarlightSkyMaterial());
    const skyDome = new THREE.Mesh(trackGeo(new THREE.SphereGeometry(148, 32, 20)), skyMat);
    root.add(skyDome);

    await ctx.breathe();

    // Level walkable Promenade Walkway from entrance (+36.25) to exit (-36.25)
    const walkMat = trackMat(createPromenadeWalkMaterial());
    const walkMesh = new THREE.Mesh(trackGeo(new THREE.PlaneGeometry(6.4, 78)), walkMat);
    walkMesh.rotation.x = -Math.PI / 2;
    walkMesh.position.y = -0.005;
    root.add(walkMesh);

    // Reactive TSL WebGPU Circular Starlight Dance Floor
    const floorHandle = createStarlightFloorMaterial();
    trackMat(floorHandle.material);
    const stageFloor = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(STAGE_RADIUS, 64)), floorHandle.material);
    stageFloor.rotation.x = -Math.PI / 2;
    stageFloor.position.y = 0.0;
    root.add(stageFloor);

    // Outer ambient cosmic water/mirror surround far below
    const seaMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#060816',
        roughness: 0.25,
        metalness: 0.7,
      }),
    );
    const seaMesh = new THREE.Mesh(trackGeo(new THREE.CircleGeometry(135, 40)), seaMat);
    seaMesh.rotation.x = -Math.PI / 2;
    seaMesh.position.y = -0.18;
    root.add(seaMesh);

    // Glowing promenade lantern bollards guiding visitors smoothly from portals to stage
    const postGeo = trackGeo(new THREE.CylinderGeometry(0.06, 0.09, 1.5, 10));
    const bulbGeo = trackGeo(new THREE.OctahedronGeometry(0.18, 0));
    const postMat = trackMat(new THREE.MeshStandardMaterial({ color: '#c8a04b', metalness: 0.8, roughness: 0.3 }));
    const bulbTeal = trackMat(
      new THREE.MeshStandardMaterial({ color: '#99f6e4', emissive: '#2dd4bf', emissiveIntensity: 1.5 }),
    );
    const bulbGold = trackMat(
      new THREE.MeshStandardMaterial({ color: '#fef08a', emissive: '#fbbf24', emissiveIntensity: 1.5 }),
    );
    for (const z of [-30, -22, -15, 15, 22, 30]) {
      for (const sx of [-3.4, 3.4]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(sx, 0.75, z);
        const bulb = new THREE.Mesh(bulbGeo, (Math.abs(z) + (sx > 0 ? 1 : 0)) % 2 === 0 ? bulbTeal : bulbGold);
        bulb.position.set(sx, 1.65, z);
        root.add(post, bulb);
      }
    }

    await ctx.breathe();

    // Room gameplay state
    let selectedDancerId: DancerId | null = null;
    let styleIndex = 0;
    let combo = 1;
    let comboDecayTimer = 0;
    let overdriveTimer = 0;
    let shockRadius = 0;
    let shockStrength = 0;
    let turntableCooldown = 0;
    let ui: StarlightDanceUi | null = null;
    let audio: PavilionAudio | null = null;

    const triggerShockwave = (x: number, z: number, colorHex: string, strength = 1.0): void => {
      floorHandle.uPulsePos.value.set(x, z);
      floorHandle.uPulseColor.value.set(colorHex);
      shockRadius = 0.2;
      shockStrength = Math.max(shockStrength, strength);
    };

    const bumpCombo = (amount = 1): void => {
      combo = Math.min(99, combo + amount);
      comboDecayTimer = 5.5;
    };

    // Interactive stage props & Claude's 4 Blender GLBs
    const stageProps = buildStageProps(
      (totemIdx, triggeredOverdrive) => {
        audio?.playChimeTotem(totemIdx);
        bumpCombo(2);
        const spot = stageProps.totems[totemIdx];
        triggerShockwave(spot.x, spot.z, spot.color, 1.15);
        if (triggeredOverdrive) {
          overdriveTimer = 10.5;
          audio?.playOverdriveFanfare();
          stageProps.triggerSparklers('#fbbf24');
          ui?.flashBanner('✦ STARLIGHT OVERDRIVE!! ALL 3 TOTEMS IN HARMONY! ✦', '#fbbf24');
          for (const d of dancers) {
            if (!d.isControlled()) d.cheer();
          }
        } else {
          ui?.flashBanner(`Chime Totem ${totemIdx + 1} Resonating!`, spot.color);
        }
      },
      (orbIdx) => {
        bumpCombo(1);
        const orb = stageProps.orbs[orbIdx];
        audio?.playTileNote(orbIdx * 3 + 4, combo);
        stageProps.triggerSparklers(orb.color);
      },
    );
    root.add(stageProps.root);
    ctx.setCollider(stageProps.collider);

    // Spell VFX Engine
    const spells = new SpellVfxSystem({
      onFloorShockwave: triggerShockwave,
      getTotemTargets: () => stageProps.getTotemTargets(),
      getOrbTargets: () => stageProps.getOrbTargets(),
      onTriggerSparklers: (col) => stageProps.triggerSparklers(col),
    });
    root.add(spells.root);

    // The 3 Dancing Keepers: Soraya, Dex, and Ermelin!
    const dancers = DANCER_CONFIGS.map((cfg) => new DancePerformer(cfg));
    for (const d of dancers) {
      root.add(d.group);
      void d.loadModel();
    }

    await ctx.breathe();

    const getDancer = (id: DancerId | null): DancePerformer | null =>
      id ? dancers.find((d) => d.config.id === id) ?? null : null;

    const cycleStyle = (): void => {
      styleIndex = (styleIndex + 1) % DANCE_STYLES.length;
      const next = DANCE_STYLES[styleIndex];
      const names: Record<DanceStyle, string> = {
        waltz: 'Celestial Waltz',
        hypergroove: 'Neon Hypergroove',
        celestial: 'Frost Crystal Rave',
      };
      const colors: Record<DanceStyle, string> = {
        waltz: '#fbbf24',
        hypergroove: '#ff2a85',
        celestial: '#93c5fd',
      };
      audio?.playStyleSwitch(styleIndex);
      stageProps.triggerSparklers(colors[next]);
      triggerShockwave(0, 0, colors[next], 1.25);
      ui?.flashBanner(`♪ Groove Switch: ${names[next]}`, colors[next]);
    };

    const selectDancer = (id: DancerId | null): void => {
      selectedDancerId = id;
      for (const d of dancers) {
        d.setControlled(d.config.id === id);
      }
      ui?.syncSelection(id);
      const chosen = getDancer(id);
      if (chosen) {
        chosen.say(`Let's dance! You've got the lead!`, 'grin', 3.0);
        triggerShockwave(chosen.pos.x, chosen.pos.z, chosen.config.auraHex, 1.1);
        spells.spawnFlourishBurst(chosen.group.position, chosen.config.auraHex, 14);
        audio?.playFlourish('beat');
        ui?.flashBanner(`Dancing as ${chosen.config.spec.name}!`, chosen.config.auraHex);
      }
    };

    const performFlourish = (kind: FlourishKind, isPerfectBeat: boolean): void => {
      const dancer = getDancer(selectedDancerId);
      if (!dancer) return;
      dancer.triggerFlourish(kind);
      const pts = isPerfectBeat ? 3 : 1;
      bumpCombo(pts);

      if (kind === 'drop') {
        audio?.playFlourish('drop');
        triggerShockwave(dancer.pos.x, dancer.pos.z, dancer.config.auraHex, 1.15);
        spells.spawnFlourishBurst(dancer.group.position, dancer.config.secondaryHex, 14);
      } else if (kind === 'leap') {
        audio?.playFlourish(isPerfectBeat ? 'beat' : 'leap');
        spells.spawnFlourishBurst(dancer.group.position, dancer.config.auraHex, 12);
      } else {
        audio?.playFlourish(isPerfectBeat ? 'beat' : 'spin');
        spells.spawnFlourishBurst(dancer.group.position, dancer.config.auraHex, 10);
      }

      if (isPerfectBeat) {
        ui?.flashBanner(`✦ PERFECT BEAT! ×${combo}`, '#fbbf24');
      }
    };

    const castActiveSpell = (slot: 1 | 2): void => {
      const dancer = getDancer(selectedDancerId);
      if (!dancer || !dancer.canCastSpell(slot)) return;
      const meta = dancer.markSpellCast(slot);
      bumpCombo(3);
      audio?.playSpell(dancer.config.id, slot);
      spells.cast(dancer.config.id, slot, dancer.group.position.clone());
      ui?.flashBanner(`✦ ${meta.name}!`, meta.accentHex);

      // Backup dancers cheer & react!
      for (const other of dancers) {
        if (other !== dancer && Math.random() < 0.65) {
          other.cheer();
        }
      }
    };

    // Raycast click/tap directly on any dancer or interactive stage prop!
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const handleTapWorld = (clientX: number, clientY: number): void => {
      const cam = ctx.player?.camera;
      if (!cam || typeof window === 'undefined') return;
      ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(ndc, cam);

      const targets: THREE.Object3D[] = [
        ...dancers.map((d) => d.hitCollider),
        ...stageProps.interactiveMeshes,
      ];
      const hits = raycaster.intersectObjects(targets, false);
      if (hits.length === 0) return;

      const hitObj = hits[0].object;
      if (hitObj.userData.dancerId) {
        selectDancer(hitObj.userData.dancerId as DancerId);
        return;
      }
      if (hitObj.userData.propKind === 'turntable') {
        cycleStyle();
      } else if (hitObj.userData.propKind === 'totem') {
        stageProps.triggerTotem(hitObj.userData.propIndex as number);
      } else if (hitObj.userData.propKind === 'orb') {
        stageProps.triggerOrb(hitObj.userData.propIndex as number);
      } else if (hitObj.userData.propKind === 'geyser') {
        const idx = hitObj.userData.propIndex as number;
        stageProps.triggerGeyserFx(idx);
        audio?.playGeyserLaunch();
        const active = getDancer(selectedDancerId) ?? dancers[0];
        active.launchGeyser(10.6);
      }
    };

    // Active-only HUD, Web Audio synth, and touch/mouse/keyboard dance controls!
    ctx.onActivate(() => {
      audio = createPavilionAudio();
      ui = new StarlightDanceUi({
        getDancers: () => dancers,
        getSelectedId: () => selectedDancerId,
        getStyle: () => DANCE_STYLES[styleIndex],
        getCombo: () => combo,
        isOverdrive: () => overdriveTimer > 0,
        onSelectDancer: selectDancer,
        onFlourish: performFlourish,
        onCastSpell: castActiveSpell,
        onCycleStyle: cycleStyle,
        onTapWorld: handleTapWorld,
      });
      return () => {
        selectedDancerId = null;
        for (const d of dancers) d.setControlled(false);
        ui?.dispose();
        ui = null;
        audio?.dispose();
        audio = null;
      };
    });

    // Scratch camera framing vectors for smooth Dance Takeover chase cam
    const camGoal = new THREE.Vector3();
    const camLook = new THREE.Vector3();
    const smoothCamPos = new THREE.Vector3(0, 3.8, 8.2);
    let camInitialized = false;

    const stepRoom = (dt: number, elapsed: number): void => {
      const step = Math.min(Math.max(dt, 0), 0.05);
      const style = DANCE_STYLES[styleIndex];
      const overdrive = overdriveTimer > 0;

      // Timers & combo decay
      overdriveTimer = Math.max(0, overdriveTimer - step);
      turntableCooldown = Math.max(0, turntableCooldown - step);
      if (combo > 1) {
        comboDecayTimer -= step;
        if (comboDecayTimer <= 0) {
          combo = Math.max(1, combo - 1);
          comboDecayTimer = 2.0;
        }
      }

      // Floor shockwave & shader uniforms
      if (shockStrength > 0.005) {
        shockRadius += step * 11.5;
        shockStrength = Math.max(0, shockStrength - step * 1.15);
      }
      floorHandle.uPulseRadius.value = shockRadius;
      floorHandle.uPulseStrength.value = shockStrength;
      floorHandle.uStyleMode.value += (styleIndex - floorHandle.uStyleMode.value) * Math.min(1, step * 4);
      floorHandle.uFrostAmount.value +=
        ((spells.frostRemaining > 0 ? 1 : 0) - floorHandle.uFrostAmount.value) * Math.min(1, step * 3.5);
      floorHandle.uOverdrive.value += ((overdrive ? 1 : 0) - floorHandle.uOverdrive.value) * Math.min(1, step * 4);
      floorHandle.uBeatEnergy.value = overdrive ? 0.95 : 0.35 + Math.min(0.45, combo * 0.03);

      // Update Spell VFX & Stage Props
      spells.update(step);
      stageProps.update(step, elapsed, style, overdrive);

      // Update the 3 Rigged Dancers
      const leader = getDancer(selectedDancerId);
      const motionInput = leader && ui ? ui.getMotionInput() : null;
      const levitating = spells.levitateRemaining > 0;

      dancers.forEach((d, idx) => {
        const formationAngle = (idx / dancers.length) * Math.PI * 2 + Math.PI / 6;
        d.update(step, elapsed, style, levitating, overdrive, leader, formationAngle, d === leader ? motionInput : null);
      });

      // Check interactive floor pads, geyser launch pads, chime totems & turntable for the controlled dancer (or walking player!)
      const activeActors: Array<{ x: number; y: number; z: number; dancer?: DancePerformer }> = [];
      if (leader) {
        activeActors.push({ x: leader.pos.x, y: leader.group.position.y, z: leader.pos.z, dancer: leader });
      }
      if (ctx.player?.position && !leader) {
        const p = ctx.player.position;
        activeActors.push({ x: p.x, y: p.y, z: p.z });
      }

      for (const actor of activeActors) {
        // 12 Musical floor pads
        for (const pad of stageProps.floorPads) {
          if (pad.cooldown <= 0 && actor.y < 0.8 && Math.hypot(actor.x - pad.x, actor.z - pad.z) < 0.95) {
            pad.glow = 1.0;
            pad.cooldown = 0.85;
            audio?.playTileNote(pad.index, combo);
            if (actor.dancer) bumpCombo(1);
          }
        }

        // 2 Zero-G Star Geyser Launch Pads
        for (const g of stageProps.geysers) {
          if (g.cooldown <= 0 && actor.y < 0.6 && Math.hypot(actor.x - g.x, actor.z - g.z) < 1.35) {
            stageProps.triggerGeyserFx(g.index);
            audio?.playGeyserLaunch();
            triggerShockwave(g.x, g.z, '#22d3ee', 1.25);
            if (actor.dancer) {
              actor.dancer.launchGeyser(10.6);
              bumpCombo(2);
              ui?.flashBanner('↑ Zero-G Star Geyser Launch!', '#22d3ee');
            }
          }
        }

        // 3 Harmonic Chime Totems (proximity ring)
        for (const t of stageProps.totems) {
          if (t.touchCooldown <= 0 && Math.hypot(actor.x - t.x, actor.z - t.z) < 2.15) {
            stageProps.triggerTotem(t.index);
          }
        }

        // Celestial Turntable proximity switch
        if (
          turntableCooldown <= 0 &&
          Math.hypot(actor.x - TURNTABLE_POS.x, actor.z - TURNTABLE_POS.z) < 2.25
        ) {
          turntableCooldown = 4.5;
          cycleStyle();
        }
      }

      // Smooth Cinematic Dance Camera while controlling a dancer!
      if (leader && ui && ctx.player?.camera) {
        const orbit = ui.getCameraOrbit();
        const horiz = Math.cos(orbit.pitch) * orbit.dist;
        const vert = Math.sin(orbit.pitch) * orbit.dist + 1.6;
        camGoal.set(
          leader.group.position.x + Math.sin(orbit.yaw) * horiz,
          Math.max(1.2, leader.group.position.y * 0.45 + vert),
          leader.group.position.z + Math.cos(orbit.yaw) * horiz,
        );
        if (!camInitialized) {
          smoothCamPos.copy(camGoal);
          camInitialized = true;
        } else {
          smoothCamPos.lerp(camGoal, 1 - Math.exp(-7.5 * step));
        }
        camLook.set(leader.group.position.x, leader.group.position.y + 1.15, leader.group.position.z);
        ctx.player.camera.position.copy(smoothCamPos);
        ctx.player.camera.lookAt(camLook);
      } else {
        camInitialized = false;
      }

      ui?.updateHud(step, elapsed);
    };

    // Initial showcase pose for portal preview snapshots
    stepRoom(0, 0);

    ctx.onUpdate(stepRoom);

    ctx.onDispose(() => {
      ui?.dispose();
      ui = null;
      audio?.dispose();
      audio = null;
      for (const d of dancers) d.dispose();
      spells.dispose();
      stageProps.dispose();
      ctx.scene.remove(root);
      for (const g of ownedGeos) g.dispose();
      for (const m of ownedMats) m.dispose();
    });
  },
});
