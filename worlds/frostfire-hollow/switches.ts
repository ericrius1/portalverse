import * as THREE from 'three/webgpu';
import { color, mix, uniform } from 'three/tsl';
import { PLATE_RADIUS, PLATE_TOP, SWITCHES } from './logic';
import { plainMaterial, type Resources } from './materials';

/** A little flame, flat, for the fire half of the toggle. */
function flameGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.16);
  s.bezierCurveTo(0.14, -0.16, 0.16, -0.02, 0.1, 0.06);
  s.bezierCurveTo(0.07, 0.11, 0.04, 0.13, 0.03, 0.2);
  s.bezierCurveTo(-0.02, 0.12, -0.05, 0.14, -0.06, 0.08);
  s.bezierCurveTo(-0.09, 0.12, -0.1, 0.06, -0.12, 0.02);
  s.bezierCurveTo(-0.16, -0.08, -0.1, -0.16, 0, -0.16);
  return new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }).rotateX(-Math.PI / 2);
}

/** Six arms with little side branches. */
function snowflakeGeometries(res: Resources): THREE.BufferGeometry[] {
  const arm = res.geo(new THREE.BoxGeometry(0.025, 0.03, 0.34));
  const twig = res.geo(new THREE.BoxGeometry(0.02, 0.03, 0.09));
  return [arm, twig];
}

/**
 * The two linked switches: a stone pedestal with a horizontal rocker (fire on the left,
 * snowflake on the right), and a pressure plate in front to step on. Only the active half glows.
 */
export function createSwitches(res: Resources) {
  const group = new THREE.Group();
  group.name = 'switches';
  // 0 = fire is on, 1 = ice is on; eases quickly so the rocker and glow animate.
  const side = uniform(0);
  const fireOn = side.oneMinus();
  const stone = plainMaterial(res.own, '#3b302b', { roughness: 0.95 });
  const housing = plainMaterial(res.own, '#211a17', { roughness: 0.7, metalness: 0.3 });

  const fireHalf = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.4 }));
  fireHalf.colorNode = mix(color(new THREE.Color('#4a3a33')), color(new THREE.Color('#ff6a1a')), fireOn);
  fireHalf.emissiveNode = color(new THREE.Color('#ff5a10')).mul(fireOn.mul(1.8));
  const iceHalf = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.25 }));
  iceHalf.colorNode = mix(color(new THREE.Color('#3f4950')), color(new THREE.Color('#8fd8ff')), side);
  iceHalf.emissiveNode = color(new THREE.Color('#5cc4ff')).mul(side.mul(1.6));
  const fireIcon = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.4 }));
  fireIcon.colorNode = mix(color(new THREE.Color('#6b5a50')), color(new THREE.Color('#ffe27a')), fireOn);
  fireIcon.emissiveNode = color(new THREE.Color('#ffb020')).mul(fireOn.mul(2.5));
  const iceIcon = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.3 }));
  iceIcon.colorNode = mix(color(new THREE.Color('#5d6870')), color(new THREE.Color('#ffffff')), side);
  iceIcon.emissiveNode = color(new THREE.Color('#bdeaff')).mul(side.mul(2.2));

  const plateMat = res.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.8 }));
  const pressed = uniform(0);
  plateMat.colorNode = color(new THREE.Color('#4a3d36'));
  plateMat.emissiveNode = mix(color(new THREE.Color('#ff6a1a')), color(new THREE.Color('#6cc8ff')), side)
    .mul(pressed.mul(0.9).add(0.18));

  const pedestalGeo = res.geo(new THREE.CylinderGeometry(0.5, 0.75, 1.0, 9));
  const neckGeo = res.geo(new THREE.CylinderGeometry(0.28, 0.4, 0.2, 9));
  // The well's floor sits well below the rocker's lowest corner (about -0.125 at full tilt).
  const wellGeo = res.geo(new THREE.BoxGeometry(1.3, 0.06, 0.56).translate(0, -0.17, 0));
  const bezelGeo = res.geo(new THREE.BoxGeometry(1, 0.24, 1).translate(0, -0.06, 0));
  const pivotGeo = res.geo(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10));
  const halfGeo = res.geo(new THREE.BoxGeometry(0.6, 0.1, 0.48));
  const flameGeo = res.geo(flameGeometry());
  const [armGeo, twigGeo] = snowflakeGeometries(res);
  const plateGeo = res.geo(new THREE.CylinderGeometry(PLATE_RADIUS, PLATE_RADIUS + 0.1, 0.16, 28));
  const rimGeo = res.geo(new THREE.TorusGeometry(PLATE_RADIUS + 0.12, 0.06, 8, 32).rotateX(Math.PI / 2));

  const rockers: THREE.Group[] = [];
  const plates: THREE.Mesh[] = [];
  for (const spot of SWITCHES) {
    const sw = new THREE.Group();
    sw.position.set(spot.pedestal.x, 0, spot.pedestal.z);
    sw.rotation.y = spot.yaw;
    const pedestal = new THREE.Mesh(pedestalGeo, stone);
    pedestal.position.y = 0.5;
    const neck = new THREE.Mesh(neckGeo, stone);
    neck.position.y = 1.08;
    const top = new THREE.Group();
    // The face tilts up toward whoever stands on the plate.
    top.position.y = 1.34;
    top.rotation.x = 0.45;
    // A bezel with a recessed well, so the rocker sits in it and never dips through.
    top.add(new THREE.Mesh(wellGeo, housing));
    for (const [x, z, w, d] of [[0, 0.32, 1.46, 0.08], [0, -0.32, 1.46, 0.08], [0.69, 0, 0.08, 0.56], [-0.69, 0, 0.08, 0.56]]) {
      const bezel = new THREE.Mesh(bezelGeo, housing);
      bezel.position.set(x, 0, z);
      bezel.scale.set(w, 1, d);
      top.add(bezel);
    }
    const pivot = new THREE.Mesh(pivotGeo, housing);
    pivot.rotation.x = Math.PI / 2;
    pivot.position.y = -0.07;
    top.add(pivot);
    const rocker = new THREE.Group();
    rocker.position.y = 0.01;
    const fire = new THREE.Mesh(halfGeo, fireHalf);
    fire.position.x = -0.31;
    const ice = new THREE.Mesh(halfGeo, iceHalf);
    ice.position.x = 0.31;
    const flame = new THREE.Mesh(flameGeo, fireIcon);
    flame.position.set(-0.31, 0.06, 0.05);
    const flake = new THREE.Group();
    flake.position.set(0.31, 0.07, 0);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI;
      const arm = new THREE.Mesh(armGeo, iceIcon);
      arm.rotation.y = a;
      flake.add(arm);
      for (const d of [-1, 1]) {
        for (const r of [0.09, 0.14]) {
          for (const turn of [0.7, -0.7]) {
            const twig = new THREE.Mesh(twigGeo, iceIcon);
            twig.position.set(Math.sin(a) * r * d, 0, Math.cos(a) * r * d);
            twig.rotation.y = a + d * turn;
            flake.add(twig);
          }
        }
      }
    }
    rocker.add(fire, ice, flame, flake);
    top.add(rocker);
    rockers.push(rocker);
    sw.add(pedestal, neck, top);

    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.position.set(spot.plate.x, PLATE_TOP - 0.08, spot.plate.z);
    const rim = new THREE.Mesh(rimGeo, stone);
    rim.position.set(spot.plate.x, 0.02, spot.plate.z);
    plates.push(plate);
    group.add(sw, plate, rim);
  }

  let shown = 0;
  let press = 0;
  return {
    group,
    update(mode: 'fire' | 'ice', standingOn: number, dt: number) {
      const target = mode === 'ice' ? 1 : 0;
      shown += (target - shown) * (1 - Math.exp(-14 * dt));
      side.value = shown;
      // The pressed-down side is the active one.
      const tilt = (shown * 2 - 1) * 0.14;
      for (const r of rockers) r.rotation.z = -tilt;
      press += ((standingOn >= 0 ? 1 : 0) - press) * (1 - Math.exp(-18 * dt));
      pressed.value = press;
      plates.forEach((p, i) => {
        p.position.y = PLATE_TOP - 0.08 - (i === standingOn ? 0.05 : 0);
      });
    },
  };
}
