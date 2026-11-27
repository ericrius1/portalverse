import * as THREE from 'three/webgpu';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { seededRandom } from '@portalverse/core/rooms/kit';
import {
  createHoloKoiMaterial,
  createStaticSkyMaterial,
  createWetStreetMaterial,
} from './shaders';
import {
  buildNeoTokyoCorner,
  createNeonRainEnvTexture,
  createResourceBag,
  disposeBlenderAssets,
  loadBlenderAssets,
} from './city';
import { buildStreetLife, type TalkableNpc } from './characters';
import { createNeoTokyoAudio, createNeoTokyoHud, type NeoTokyoAudio, type NeoTokyoHud } from './audioHud';
import {
  ANALOG_SHOP_POS,
  CONBINI_POS,
  EASTER_EGGS,
  NOODLE_BAR_POS,
  TROLLEY_TRACK_Z,
  createStationCollider,
  stationHeight,
} from './terrain';
import {
  computeDissolveFactors,
  createTrolleyState,
  getShopSchedule,
  sampleWorldCycle,
  stepTrolley,
  trolleyStatusLabel,
  type ShopId,
} from './worldState';

/**
 * SECTOR 9 RAIN CORNER — NEO-TOKYO (`doug-cassette-station`)
 * A dense, living Blade Runner / Neo-Tokyo single street corner under a dead-channel
 * static sky peeking through low drifting rain clouds:
 * - Full day/night cycle & dynamic rain (downpours, drizzle, and eerie static-sky breaks)
 * - White Dragon open-air noodle counter with outdoor stools, steaming bowls & Chef Kenta
 * - 3 additional scheduled shops (Kuro Cyber-Optics, Analog Ghost CRTs, Gekko 24H Conbini)
 * - Articulated future-punks & bio-engineered animal-hybrid humans (kitsune, neko, okami, usagi)
 *   walking, riding neo-futuristic scooters, opening neon umbrellas, chatting via live NPC
 *   dialogue, and dissolving into transparent glowing polygon meshes at the edge of the street
 * - Rare Electro-Punk Trolley rolling down sunken rails to stop, spark, and pick up passengers
 * - 5 hidden Blade Runner / Neo-Tokyo easter eggs & interconnected storylines
 */
export default defineRoom('doug-cassette-station', {
  async mount(ctx) {
    const root = new THREE.Group();
    root.name = 'neo-tokyo-corner-root';
    ctx.scene.add(root);

    const fogColorNight = new THREE.Color('#131126');
    const fogColorDay = new THREE.Color('#3b2d3c');
    const fogColorTmp = new THREE.Color('#131126');
    ctx.scene.background = new THREE.Color('#101122');
    const fog = new THREE.FogExp2('#131126', 0.015);
    ctx.scene.fog = fog;
    ctx.setTerrainHeight(stationHeight);

    const res = createResourceBag();
    const rand = seededRandom(204909);

    // Neon-Rain IBL Environment Map for photorealistic wet metallic & vinyl specular reflections!
    const envTex = res.tex(createNeonRainEnvTexture());
    ctx.scene.environment = envTex;

    // Load all 5 Blender 5.3 sculpted PBR hero GLB assets in parallel
    const blenderAssets = await loadBlenderAssets();
    await ctx.breathe();

    // Dynamic lighting modulated by the day/night & rain cycle
    const hemi = new THREE.HemisphereLight('#8bc5ff', '#3a1d35', 1.35);
    const keyLight = new THREE.DirectionalLight('#a8d4ff', 1.25);
    keyLight.position.set(-22, 36, -24);
    const neonBounce = new THREE.DirectionalLight('#ff8da8', 1.0);
    neonBounce.position.set(18, 14, 16);
    root.add(hemi, keyLight, neonBounce);

    // Fog-exempt Dead-Channel Static Sky Dome behind wispy rain clouds
    const sky = createStaticSkyMaterial();
    res.mat(sky.material);
    const skyDome = new THREE.Mesh(res.geo(new THREE.SphereGeometry(142, 32, 20)), sky.material);
    skyDome.name = 'static-sky-dome';
    root.add(skyDome);

    await ctx.breathe();

    // Wet Neo-Tokyo asphalt, crosswalks, neon puddles, and raindrop rings
    const street = createWetStreetMaterial();
    res.mat(street.material);

    const city = await buildNeoTokyoCorner(root, res, blenderAssets, street.material);
    ctx.setCollider(createStationCollider(city.solids.boxes, city.solids.cylinders));

    await ctx.breathe();

    // Living street population: shopkeepers, diners, commuters, future-punks, bio-hybrids & scooters
    const streetLife = buildStreetLife(root, res, blenderAssets);

    // 7 Floating Holographic Koi drifting high between the Neo-Tokyo corner towers
    const koiBodyGeo = res.geo(new THREE.SphereGeometry(0.24, 10, 8));
    koiBodyGeo.scale(0.65, 0.85, 2.3);
    const koiTailGeo = res.geo(new THREE.ConeGeometry(0.32, 0.62, 5));
    koiTailGeo.rotateX(Math.PI / 2);
    koiTailGeo.scale(0.22, 1.1, 1);
    koiTailGeo.translate(0, 0, -0.68);
    const koiCols = ['#22d3ee', '#fb7185', '#fde047', '#5eead4', '#f472b6'];
    const kois = Array.from({ length: 7 }, (_, i) => {
      const m = res.mat(createHoloKoiMaterial(koiCols[i % koiCols.length], i * 1.15));
      const g = new THREE.Group();
      g.add(new THREE.Mesh(koiBodyGeo, m), new THREE.Mesh(koiTailGeo, m));
      g.scale.setScalar(0.95 + rand() * 0.65);
      root.add(g);
      return {
        group: g,
        cx: (rand() - 0.5) * 6,
        cz: -14 + i * 4.6,
        y: 6.2 + rand() * 5.2,
        rx: 4.5 + rand() * 4.5,
        rz: 5.5 + rand() * 5.5,
        speed: 0.2 + rand() * 0.16,
        phase: rand() * Math.PI * 2,
        dir: i % 2 === 0 ? 1 : -1,
      };
    });

    // 1,800 Dynamic Falling Rain Streaks (scale smoothly with live weather cycle!)
    const RAIN_COUNT = 1800;
    const rainGeo = res.geo(new THREE.CylinderGeometry(0.008, 0.008, 0.72, 4));
    const rainMat = res.mat(new THREE.MeshBasicMaterial({
      color: '#bae6fd',
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const rainMesh = new THREE.InstancedMesh(rainGeo, rainMat, RAIN_COUNT);
    rainMesh.frustumCulled = false;
    const rainDrops = Array.from({ length: RAIN_COUNT }, () => ({
      x: (rand() - 0.5) * 42,
      y: rand() * 16,
      z: (rand() - 0.5) * 66,
      speed: 9.0 + rand() * 3.8,
    }));
    root.add(rainMesh);

    // Runtime simulation state (strictly instance-local!)
    const trolleyState = createTrolleyState(14);
    const foundEggs = new Set<string>();
    const npcLineIndex = new Map<string, number>();
    let activeNpc: TalkableNpc | null = null;
    let activeAudio: NeoTokyoAudio | null = null;
    let activeHud: NeoTokyoHud | null = null;

    let crtChannel = 1;
    let crtCooldown = 0;
    let vendingCooldown = 0;
    let vendingGlowTimer = 0;
    let noodleCooldown = 0;
    let prevStepX = 0;
    let prevStepZ = 0;
    let stepAccum = 0;
    let lastBusSignText = '';
    const dummy = new THREE.Object3D();

    const redrawBusSign = (label: string, clockLabel: string, weather: string) => {
      const key = `${label}|${clockLabel}|${weather}`;
      if (key === lastBusSignText) return;
      lastBusSignText = key;
      const c2d = city.busSignCanvas.getContext('2d');
      if (!c2d) return;
      c2d.fillStyle = '#070d1c';
      c2d.fillRect(0, 0, 512, 192);
      c2d.strokeStyle = '#22d3ee';
      c2d.lineWidth = 6;
      c2d.strokeRect(6, 6, 500, 180);
      c2d.fillStyle = '#5eead4';
      c2d.font = 'bold 26px monospace';
      c2d.fillText('LINE 09 • ELECTRO-TROLLEY', 24, 46);
      c2d.fillStyle = label === 'BOARDING NOW' ? '#fb7185' : '#fde047';
      c2d.font = 'bold 42px monospace';
      c2d.fillText(label, 24, 108);
      c2d.fillStyle = '#94a3b8';
      c2d.font = '20px monospace';
      c2d.fillText(`${clockLabel}  •  ${weather}  •  STOP: SECTOR 09`, 24, 158);
      city.busSignTex.needsUpdate = true;
    };

    // Active-only audio, sleek Neo-Tokyo HUD, and [F] NPC dialogue cycling
    ctx.onActivate(() => {
      activeAudio = createNeoTokyoAudio();
      activeHud = createNeoTokyoHud();

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code !== 'KeyF' || e.repeat) return;
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (activeNpc) {
          const cur = npcLineIndex.get(activeNpc.id) ?? 0;
          npcLineIndex.set(activeNpc.id, (cur + 1) % activeNpc.lines.length);
          activeAudio?.playDialogueBlip();
        }
      };
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('keydown', onKeyDown);
        activeAudio?.dispose();
        activeAudio = null;
        activeHud?.dispose();
        activeHud = null;
      };
    });

    const update = (dt: number, elapsed: number) => {
      const safeDt = Math.min(dt, 0.1);
      const playerPos = ctx.player?.position ?? null;

      // 1. Sample Day/Night Cycle & Dynamic Rain / Static Sky
      const cycle = sampleWorldCycle(elapsed);
      sky.uDaylight.value = cycle.daylight;
      sky.uRain.value = cycle.rainIntensity;
      sky.uStaticReveal.value = cycle.staticReveal;
      street.uRain.value = cycle.rainIntensity;
      street.uDaylight.value = cycle.daylight;

      fogColorTmp.copy(fogColorNight).lerp(fogColorDay, cycle.daylight * 0.85);
      fog.color.copy(fogColorTmp);
      fog.density = 0.0115 + cycle.rainIntensity * 0.0055;
      hemi.intensity = 0.88 + cycle.daylight * 0.72;
      keyLight.intensity = 0.75 + cycle.daylight * 0.85;
      activeAudio?.setRainLevel(cycle.rainIntensity);

      // Modulate shop neon sign brightness subtly by shop schedule
      const shopIds: ShopId[] = ['noodles', 'optics', 'analog', 'conbini'];
      for (const sid of shopIds) {
        const sched = getShopSchedule(sid, cycle.period);
        const lum = Math.min(1, 0.72 + sched.signIntensity * 0.24);
        city.shopSignMats[sid].color.setRGB(lum, lum, lum);
      }

      // 2. Step Rare Electro-Punk Trolley running PERPENDICULAR (East -> West along X) + Polygon Dissolve!
      stepTrolley(trolleyState, safeDt);
      city.trolley.group.position.set(trolleyState.x, 0, TROLLEY_TRACK_Z);
      if (city.trolley.doorLeft) city.trolley.doorLeft.position.x = -0.44 - trolleyState.doorOpen * 0.62;
      if (city.trolley.doorRight) city.trolley.doorRight.position.x = 0.44 + trolleyState.doorOpen * 0.62;
      const trolleyDissolve = trolleyState.phase === 'OFFSCREEN'
        ? { solidOpacity: 0, wireOpacity: 0, visible: false }
        : computeDissolveFactors(trolleyState.x);
      city.trolley.applyDissolve(trolleyDissolve);

      // Electric pantograph crackle sparks while trolley is moving!
      const sparkMat = city.trolley.sparkMesh.material as THREE.MeshBasicMaterial;
      const sparkFlash = trolleyState.speed > 0.5 && Math.sin(elapsed * 37.0) > 0.72;
      sparkMat.opacity = sparkFlash ? 0.92 : 0;
      city.trolley.sparkMesh.rotation.y = elapsed * 14;

      if (trolleyState.arrivedEvent) {
        activeAudio?.playTrolleyBell();
        activeHud?.showToast('Line 09 Electro-Punk Trolley boarding at the Sector 9 stop!');
      }
      redrawBusSign(trolleyStatusLabel(trolleyState), cycle.clockLabel, cycle.weather.replace('_', ' '));

      // 3. Street Life: Future-Punks, Bio-Hybrids, Scooters, Commuters & Routines
      streetLife.update(safeDt, elapsed, cycle, trolleyState);

      // 4. Falling Raindrops (scaled cleanly with rainIntensity; hidden during misty static breaks!)
      const activeDrops = Math.floor(RAIN_COUNT * cycle.rainIntensity);
      rainMat.opacity = 0.08 + cycle.rainIntensity * 0.24;
      for (let i = 0; i < RAIN_COUNT; i++) {
        const r = rainDrops[i];
        if (i < activeDrops) {
          r.y -= r.speed * safeDt;
          r.x += 1.3 * safeDt;
          if (r.y < 0.08) {
            r.y = 14.5 + rand() * 2.0;
            r.x = (rand() - 0.5) * 42;
          }
          dummy.position.set(r.x, r.y, r.z);
          dummy.rotation.set(0, 0, -0.12);
          dummy.scale.set(1, 1, 1);
        } else {
          dummy.position.set(0, -40, 0);
          dummy.scale.set(0, 0, 0);
        }
        dummy.updateMatrix();
        rainMesh.setMatrixAt(i, dummy.matrix);
      }
      rainMesh.instanceMatrix.needsUpdate = true;

      // 5. Ambient Neo-Tokyo Details: Koi, Steam, Lanterns, Holo-Optics, Traffic Signals, Mochi-X
      for (const k of kois) {
        const a = elapsed * k.speed * k.dir + k.phase;
        const kx = k.cx + Math.cos(a) * k.rx;
        const kz = k.cz + Math.sin(a) * k.rz;
        const ky = k.y + Math.sin(a * 2.0) * 0.55;
        k.group.position.set(kx, ky, kz);
        k.group.rotation.y = Math.atan2(-Math.sin(a) * k.rx * k.dir, Math.cos(a) * k.rz * k.dir);
      }
      for (const sp of city.steamPuffs) {
        const cyc = (elapsed * sp.speed + sp.phase) % 1;
        sp.mesh.position.set(
          sp.baseX + Math.sin(elapsed * 1.9 + sp.phase) * 0.09,
          sp.baseY + cyc * 1.1,
          sp.baseZ + Math.cos(elapsed * 1.5 + sp.phase) * 0.09,
        );
        sp.mesh.scale.setScalar(0.5 + Math.sin(cyc * Math.PI) * 1.25);
      }
      city.holoOptics.forEach((eye, i) => {
        eye.rotation.y = -Math.PI / 2 + Math.sin(elapsed * 1.3 + i) * 0.45;
      });
      city.opticsDrone.position.y = 2.15 + Math.sin(elapsed * 2.4) * 0.22;
      city.opticsDrone.rotation.y = elapsed * 0.9;
      if (city.catMochiTail) {
        city.catMochiTail.rotation.y = 0.3 + Math.sin(elapsed * 2.6) * 0.22;
      }

      // Crosswalk traffic light alternating phase every 10s
      const greenPhase = Math.floor(elapsed / 10) % 2 === 0;
      for (const tl of city.trafficLights) {
        tl.green.emissiveIntensity = greenPhase ? 2.1 : 0.12;
        tl.red.emissiveIntensity = greenPhase ? 0.12 : 2.1;
      }

      // 6. Player-Reactive Puddles, Shops, Easter Eggs & NPC Dialogue!
      street.uRippleAge.value = Math.min(10, street.uRippleAge.value + safeDt);
      crtCooldown = Math.max(0, crtCooldown - safeDt);
      vendingCooldown = Math.max(0, vendingCooldown - safeDt);
      vendingGlowTimer = Math.max(0, vendingGlowTimer - safeDt);
      noodleCooldown = Math.max(0, noodleCooldown - safeDt);

      if (playerPos) {
        street.uPlayerPos.value.copy(playerPos);
        const moved = Math.hypot(playerPos.x - prevStepX, playerPos.z - prevStepZ);
        prevStepX = playerPos.x;
        prevStepZ = playerPos.z;
        if (playerPos.y < 0.28) {
          stepAccum += moved;
          if (stepAccum > 2.2) {
            stepAccum = 0;
            street.uRippleOrigin.value.set(playerPos.x, playerPos.z);
            street.uRippleAge.value = 0;
            activeAudio?.playPuddleStep();
          }
        }

        // Order steaming noodles at White Dragon counter!
        if (noodleCooldown <= 0 && Math.hypot(playerPos.x - (NOODLE_BAR_POS.x + 2.6), playerPos.z - NOODLE_BAR_POS.z) < 2.2) {
          noodleCooldown = 10;
          if (!city.playerNoodleBowl.visible) {
            city.playerNoodleBowl.visible = true;
            activeAudio?.playNoodleOrder();
            activeHud?.showToast('Chef Kenta slides a steaming bowl of White Dragon miso onto the counter!');
          }
        }

        // Cycle CRT monitor channel at Analog Ghost!
        if (crtCooldown <= 0 && Math.hypot(playerPos.x - (ANALOG_SHOP_POS.x + 2.2), playerPos.z - ANALOG_SHOP_POS.z) < 2.6) {
          crtCooldown = 3.5;
          crtChannel = (crtChannel + 1) % city.crtTextures.length;
          const m = city.mainCrtScreen.material as THREE.MeshBasicMaterial;
          m.map = city.crtTextures[crtChannel];
          m.needsUpdate = true;
          activeAudio?.playCrtClick();
        }

        // Dispense holographic drinks at Gekko Mart vending machines!
        if (vendingCooldown <= 0 && Math.hypot(playerPos.x - (CONBINI_POS.x - 1.8), playerPos.z - CONBINI_POS.z) < 2.8) {
          vendingCooldown = 5.5;
          vendingGlowTimer = 4.4;
          activeAudio?.playVendingJingle();
        }

        // Discover the 5 Hidden Blade Runner / Neo-Tokyo Easter Eggs!
        for (const egg of EASTER_EGGS) {
          if (!foundEggs.has(egg.id) && Math.hypot(playerPos.x - egg.x, playerPos.z - egg.z) < 1.95) {
            foundEggs.add(egg.id);
            activeAudio?.playEasterEggChime();
            activeHud?.showToast(`SECRET (${foundEggs.size}/${EASTER_EGGS.length}) ${egg.name}: ${egg.lore}`);
          }
        }

        // Find nearest talkable NPC within 3.2m for live cyberpunk dialogue card!
        let nearest: TalkableNpc | null = null;
        let bestDist = 3.2;
        for (const npc of streetLife.npcs) {
          const p = npc.getPosition();
          const d = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
          if (d < bestDist) {
            bestDist = d;
            nearest = npc;
          }
        }
        activeNpc = nearest;
        if (nearest) {
          const idx = npcLineIndex.get(nearest.id) ?? 0;
          activeHud?.setDialogue(
            nearest,
            nearest.getRoutine(cycle, trolleyState),
            nearest.lines[idx],
            idx,
            nearest.lines.length,
          );
        } else {
          activeHud?.setDialogue(null, '', '', 0, 0);
        }
      } else {
        street.uPlayerPos.value.set(0, -100, 0);
        activeNpc = null;
        activeHud?.setDialogue(null, '', '', 0, 0);
      }

      // Spin vending drink holos & pulse easter egg halos
      city.vendingDrinkHolos.forEach((h, i) => {
        h.visible = vendingGlowTimer > 0;
        if (h.visible) {
          h.rotation.y = elapsed * 2.4 + i;
          h.position.y = 0.96 + Math.sin(elapsed * 3.5 + i) * 0.08;
        }
      });
      city.easterEggVisuals.forEach((ev, i) => {
        const discovered = foundEggs.has(ev.id);
        ev.halo.scale.setScalar(discovered ? 1.4 + Math.sin(elapsed * 3.2) * 0.14 : 0.95 + Math.sin(elapsed * 2.2 + i) * 0.08);
      });

      activeHud?.updateStatus(cycle, trolleyState, foundEggs.size, EASTER_EGGS.length);
    };

    // Initial pose before first render
    update(0, 0);
    ctx.onUpdate(update);

    ctx.onDispose(() => {
      ctx.scene.environment = null;
      ctx.scene.remove(root);
      disposeBlenderAssets(blenderAssets);
      res.dispose();
    });
  },
});
