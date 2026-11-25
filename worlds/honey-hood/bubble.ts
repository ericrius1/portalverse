import * as THREE from 'three/webgpu';
import { HYDRANT } from './logic';
import type { Resources } from './tools';

/** "Honey time." */
const WORDS = 'はちみつタイム';
/** How close a player gets before the hydrant speaks, and how far before it stops. */
const NEAR = 5;
const FAR = 6;
const WIDTH = 2.8;

function drawBubble(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const pen = canvas.getContext('2d')!;

  // One outline for the rounded box and the tail under it, which points at the hydrant.
  pen.beginPath();
  pen.moveTo(56, 12);
  pen.arcTo(500, 12, 500, 190, 52);
  pen.arcTo(500, 190, 12, 190, 52);
  pen.lineTo(292, 190);
  pen.lineTo(256, 246);
  pen.lineTo(220, 190);
  pen.arcTo(12, 190, 12, 12, 52);
  pen.arcTo(12, 12, 500, 12, 52);
  pen.closePath();
  pen.fillStyle = '#fffdf5';
  pen.fill();
  pen.lineWidth = 10;
  pen.strokeStyle = '#3a2410';
  pen.stroke();

  pen.fillStyle = '#3a2410';
  pen.textAlign = 'center';
  pen.textBaseline = 'middle';
  pen.font = '700 62px "Hiragino Maru Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif';
  pen.fillText(WORDS, 256, 103, 440);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The hydrant's speech bubble, which pops up while a player is close by. */
export function createSpeechBubble(res: Resources) {
  const material = res.own(new THREE.SpriteMaterial({
    map: res.own(drawBubble()),
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  }));
  const sprite = new THREE.Sprite(material);
  sprite.name = 'speech-bubble';
  // Anchored at the tip of the tail, just above the hydrant.
  sprite.center.set(0.5, 0);
  sprite.position.set(HYDRANT.x, 1.7, HYDRANT.z);
  sprite.visible = false;
  let grown = 0;

  return {
    sprite,
    /** `feet` is the player's position, or null when nobody is here. */
    update(dt: number, feet: { x: number; y: number; z: number } | null) {
      const reach = sprite.visible ? FAR : NEAR;
      sprite.visible = !!feet && Math.hypot(feet.x - HYDRANT.x, feet.y, feet.z - HYDRANT.z) < reach;
      grown = sprite.visible ? Math.min(1, grown + dt * 6) : 0;
      // A quick pop with a slight overshoot.
      const size = grown + Math.sin(grown * Math.PI) * 0.15;
      sprite.scale.set(WIDTH * size, (WIDTH / 2) * size, 1);
    },
  };
}
