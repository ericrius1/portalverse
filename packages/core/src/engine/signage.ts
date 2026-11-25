import * as THREE from 'three/webgpu';

export interface PlaqueOptions {
  title: string;
  subtitle?: string;
  accentColor?: string;
  bgColor?: string;
  width?: number;
  height?: number;
  borderGlow?: boolean;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function createPlaqueTexture(opts: PlaqueOptions): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = opts.subtitle ? 224 : 156;
  const ctx = canvas.getContext('2d')!;

  const accent = opts.accentColor ?? '#38bdf8';
  const bg = opts.bgColor ?? 'rgba(8, 13, 28, 0.84)';

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer pill backdrop
  drawRoundedRect(ctx, 16, 16, canvas.width - 32, canvas.height - 32, 32);
  ctx.fillStyle = bg;
  ctx.fill();

  // Luminous accent border
  ctx.lineWidth = 6;
  ctx.strokeStyle = accent;
  if (opts.borderGlow !== false) {
    ctx.shadowColor = accent;
    ctx.shadowBlur = 18;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Top accent bar
  drawRoundedRect(ctx, canvas.width * 0.34, 28, canvas.width * 0.32, 6, 3);
  ctx.fillStyle = accent;
  ctx.fill();

  // Main title
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 54px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
  const titleY = opts.subtitle ? canvas.height * 0.43 : canvas.height * 0.54;
  ctx.fillText(opts.title, canvas.width / 2, titleY, canvas.width - 96);

  if (opts.subtitle) {
    ctx.fillStyle = accent;
    ctx.font = '600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif';
    ctx.fillText(opts.subtitle, canvas.width / 2, canvas.height * 0.74, canvas.width - 96);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Floating billboard label (used above portals, magic fountains, blooming flowers, and avatars).
 */
export function createFloatingLabel(opts: PlaqueOptions): {
  sprite: THREE.Sprite;
  dispose: () => void;
} {
  const tex = createPlaqueTexture(opts);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  const width = opts.width ?? 3.6;
  const aspect = tex.image.height / tex.image.width;
  sprite.scale.set(width, width * aspect, 1);
  return {
    sprite,
    dispose: () => {
      tex.dispose();
      mat.dispose();
    },
  };
}

/**
 * Architectural wall banner / room marquee mesh (used inside Eric's Room and JP's Room
 * so visitors know immediately whose room they're standing in).
 */
export function createWallBanner(opts: PlaqueOptions): {
  mesh: THREE.Mesh;
  dispose: () => void;
} {
  const tex = createPlaqueTexture(opts);
  const width = opts.width ?? 10.5;
  const height = opts.height ?? width * (tex.image.height / tex.image.width);
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  return {
    mesh,
    dispose: () => {
      geo.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}
