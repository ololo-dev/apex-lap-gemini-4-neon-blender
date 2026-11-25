import * as THREE from 'three';

function createCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to create 2D canvas context');
  }
  return [canvas, ctx];
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1,
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  return tex;
}

/** Deterministic PRNG for clean repeatable surface grain. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createAsphaltTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 512);
  ctx.fillStyle = '#2d3138';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle darker rubber racing groove near center
  const grad = ctx.createLinearGradient(0, 0, 512, 0);
  grad.addColorStop(0, 'rgba(18, 20, 24, 0.25)');
  grad.addColorStop(0.25, 'rgba(12, 13, 16, 0.08)');
  grad.addColorStop(0.5, 'rgba(15, 17, 22, 0.22)');
  grad.addColorStop(0.75, 'rgba(12, 13, 16, 0.08)');
  grad.addColorStop(1, 'rgba(18, 20, 24, 0.25)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Aggregate mineral speckles
  const rand = mulberry32(1337);
  for (let i = 0; i < 6500; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const shade = 36 + Math.floor(rand() * 38);
    ctx.fillStyle = `rgba(${shade}, ${shade + 2}, ${shade + 5}, 0.55)`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Crisp white solid edge lines
  ctx.fillStyle = '#f3f2ec';
  ctx.fillRect(14, 0, 12, 512);
  ctx.fillRect(512 - 26, 0, 12, 512);

  // Subtle dashed center guidance marks
  ctx.fillStyle = 'rgba(240, 238, 230, 0.35)';
  ctx.fillRect(253, 32, 6, 170);
  ctx.fillRect(253, 288, 6, 170);

  return finalizeTexture(canvas, 1, 1);
}

export function createGrassTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 512);
  // Alternating sunlit mowed turf bands for unmistakable ground-speed cues
  ctx.fillStyle = '#4e7d36';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#588a3d';
  ctx.fillRect(0, 0, 256, 512);

  const rand = mulberry32(4242);
  for (let i = 0; i < 9000; i++) {
    const x = rand() * 512;
    const y = rand() * 512;
    const g = 100 + Math.floor(rand() * 48);
    const r = Math.floor(g * 0.62);
    const b = Math.floor(g * 0.38);
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.35)`;
    ctx.fillRect(x, y, 3, 2);
  }

  return finalizeTexture(canvas, 95, 95);
}

export function createCurbTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(128, 256);
  ctx.fillStyle = '#d92a1c';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#f5f2ea';
  ctx.fillRect(0, 128, 128, 128);

  // Concrete edge seam
  ctx.fillStyle = 'rgba(30, 30, 35, 0.25)';
  ctx.fillRect(0, 0, 8, 256);
  ctx.fillRect(120, 0, 8, 256);

  return finalizeTexture(canvas, 1, 1);
}

export function createStartLineTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 128);
  const cols = 16;
  const rows = 4;
  const cw = 512 / cols;
  const ch = 128 / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#f6f5f0' : '#16181d';
      ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createSignTexture(
  label: string,
  bgColor: string,
  fgColor: string,
  accentColor?: string,
): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(512, 192);
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, 512, 192);

  if (accentColor) {
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, 512, 20);
    ctx.fillRect(0, 172, 512, 20);
  }

  ctx.fillStyle = fgColor;
  ctx.font = '900 76px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 256, 100);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function createChevronTexture(turnRight: boolean): THREE.CanvasTexture {
  const [canvas, ctx] = createCanvas(256, 256);
  ctx.fillStyle = '#181c24';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = '#ffcb2b';
  ctx.lineWidth = 34;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';

  const drawArrow = (cx: number): void => {
    const dir = turnRight ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx - dir * 36, 46);
    ctx.lineTo(cx + dir * 24, 128);
    ctx.lineTo(cx - dir * 36, 210);
    ctx.stroke();
  };

  drawArrow(86);
  drawArrow(176);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
