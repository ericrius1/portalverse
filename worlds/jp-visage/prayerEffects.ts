import * as THREE from 'three/webgpu';
import {
  color, exp, float, mix, mx_noise_float,
  positionGeometry, pow, sin, smoothstep, time, uniform, uv, vec3,
} from 'three/tsl';
import type { WorldContext } from '@portalverse/core/types';
import { Prayer, RING_RADIUS } from './prayer';
import './prayer.css';

export function mountPrayer(ctx: WorldContext, root: THREE.Group, irises: THREE.Vector3[], eyeRadius: number) {
  const prayer = new Prayer();
  const glow = uniform(0);
  const ringGlow = uniform(0);
  const light = uniform(0);
  const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false };
  const eyeEffects = new THREE.Group();
  root.add(eyeEffects);
  eyeEffects.visible = false;

  // The Reef's soft-edged shafts, tapered into a narrower core where they meet the player.
  const shaftGeo = new THREE.PlaneGeometry(1, 1, 1, 32);
  const shaftMat = new THREE.MeshBasicNodeMaterial({ ...additive, side: THREE.DoubleSide });
  const across = sin(uv().x.mul(Math.PI));
  const core = pow(across, 14);
  const aperture = mix(0.27, 1, uv().y).mul(mix(1, 0.19, smoothstep(0.9, 1, uv().y)));
  shaftMat.positionNode = vec3(positionGeometry.x.mul(aperture), positionGeometry.y, 0);
  shaftMat.colorNode = mix(color('#74abff'), vec3(1.6, 1.8, 2), core);
  shaftMat.opacityNode = across.mul(across).mul(0.22).add(core.mul(0.54))
    .mul(sin(time.mul(1.4).add(uv().y.mul(5))).mul(0.045).add(0.955)).mul(light);
  const haloMat = new THREE.SpriteNodeMaterial(additive);
  const distanceSq = uv().sub(0.5).dot(uv().sub(0.5));
  haloMat.colorNode = color('#84b9ff');
  haloMat.opacityNode = exp(distanceSq.mul(-21)).mul(float(1).sub(smoothstep(0.17, 0.25, distanceSq))).mul(light).mul(0.72);
  const gazeTarget = new THREE.Vector3().addVectors(irises[0], irises[1]).multiplyScalar(0.5);
  const shafts = irises.map(origin => {
    const halo = new THREE.Sprite(haloMat);
    halo.position.copy(origin);
    halo.scale.setScalar(eyeRadius * 5);
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    eyeEffects.add(shaft, halo);
    return shaft;
  });

  // Honey Hood's tile-edge halo, wrapped around the engraved outer circle.
  const height = 1.05;
  const ringRadius = RING_RADIUS * 0.974;
  const ringGeo = new THREE.CylinderGeometry(ringRadius, ringRadius, height, 128, 1, true);
  const ringMat = new THREE.MeshBasicNodeMaterial({ ...additive, side: THREE.DoubleSide });
  // Sample around the physical rim so the flicker stays continuous across the UV seam.
  const rim = positionGeometry.xz;
  const rise = uv().y;
  const folds = mx_noise_float(vec3(rim.mul(1.8), rise.mul(2.4).sub(time.mul(1.35))));
  const sparks = mx_noise_float(vec3(rim.mul(5.2), rise.mul(4.5).sub(time.mul(3.1))));
  const flicker = smoothstep(-0.48, 0.52, folds.add(sparks.mul(0.36)));
  ringMat.colorNode = mix(color('#ae68f2'), color('#cb91ff'), flicker);
  ringMat.opacityNode = ringGlow.mul(rise.oneMinus().pow(1.6)).mul(mix(0.48, 1.0, flicker));
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = height / 2 + 0.008;
  ring.visible = false;
  root.add(ring);

  const target = new THREE.Vector3(), axis = new THREE.Vector3(), side = new THREE.Vector3();
  const normal = new THREE.Vector3(), basis = new THREE.Matrix4();
  const clock = () => performance.now() / 1000;
  let prompt: HTMLButtonElement | undefined;
  function refresh() {
    const player = ctx.player;
    if (!player) return;
    const feet = player.position;
    prayer.update(clock(), feet.x, feet.y, feet.z, player.grounded && player.inputEnabled);
    glow.value = prayer.glow;
    ringGlow.value = prayer.ringGlow;
    light.value = prayer.light;
    ring.visible = ringGlow.value > 0;
    if (prompt) prompt.hidden = !prayer.ready;
    eyeEffects.visible = light.value > 0;
    if (!eyeEffects.visible) return;
    target.copy(feet);
    target.y += 1.1;
    shafts.forEach((shaft, i) => {
      const origin = irises[i];
      axis.subVectors(origin, target);
      shaft.scale.set(eyeRadius * 1.1, axis.length(), 1);
      axis.normalize();
      normal.subVectors(player.camera.position, origin);
      side.crossVectors(axis, normal);
      if (side.lengthSq() < 1e-8) side.set(1, 0, 0).addScaledVector(axis, -axis.x);
      side.normalize();
      normal.crossVectors(side, axis);
      shaft.quaternion.setFromRotationMatrix(basis.makeBasis(side, axis, normal));
      shaft.position.addVectors(origin, target).multiplyScalar(0.5);
    });
  }
  ctx.onUpdate(refresh);
  ctx.onActivate(() => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Press E to pray';
    button.className = 'fall-respawn visage-prayer';
    button.hidden = true;
    document.body.append(button);
    prompt = button;
    const invoke = () => {
      refresh();
      if (!prayer.invoke(clock())) return false;
      button.hidden = true;
      ctx.player?.turnToFace(gazeTarget);
      return true;
    };
    const keydown = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || e.repeat || e.metaKey || e.altKey || e.ctrlKey || e.defaultPrevented) return;
      if (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input, textarea, select'))) return;
      if (invoke()) e.preventDefault();
    };
    window.addEventListener('keydown', keydown);
    button.addEventListener('click', invoke);
    return () => {
      window.removeEventListener('keydown', keydown);
      button.removeEventListener('click', invoke);
      button.remove();
      prompt = undefined;
      prayer.reset();
      glow.value = ringGlow.value = light.value = 0;
      ring.visible = eyeEffects.visible = false;
    };
  });
  ctx.onDispose(() => {
    ringGeo.dispose();
    ringMat.dispose();
    shaftGeo.dispose();
    shaftMat.dispose();
    haloMat.dispose();
  });
  return { glow, light };
}
