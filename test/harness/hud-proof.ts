/**
 * Renders the real HUD against synthetic-but-anatomically-plausible tracking
 * data, so the overlay can be visually verified without model weights.
 */
import { render } from '../../src/hud/renderer';
import type { FrameState, Landmark, Telemetry } from '../../src/core/types';

const W = 1280, H = 720;
const L = (x: number, y: number, z = 0, v = 1): Landmark => ({ x, y, z, visibility: v });

/** Elliptical face mesh with correct canonical indices for eyes/iris/lips. */
function faceMesh(cx: number, cy: number, rx: number, ry: number): Landmark[] {
  const p: Landmark[] = Array.from({ length: 478 }, (_, i) => {
    const a = (i / 478) * Math.PI * 2 * 7;
    const r = 0.28 + ((i * 37) % 100) / 140;
    return L(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r);
  });
  // Face oval ring.
  const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
  oval.forEach((idx, k) => {
    const a = (k / oval.length) * Math.PI * 2 - Math.PI / 2;
    p[idx] = L(cx + Math.sin(a) * rx, cy - Math.cos(a) * ry);
  });
  const eye = (cxe: number, cye: number, ids: number[]) => {
    const [outer, inner, top, bot, iris] = ids;
    p[outer] = L(cxe - rx * 0.22, cye);
    p[inner] = L(cxe + rx * 0.22, cye);
    p[top] = L(cxe, cye - ry * 0.09);
    p[bot] = L(cxe, cye + ry * 0.09);
    p[iris] = L(cxe, cye);
  };
  eye(cx - rx * 0.38, cy - ry * 0.12, [33, 133, 159, 145, 468]);
  eye(cx + rx * 0.38, cy - ry * 0.12, [263, 362, 386, 374, 473]);
  // Lips ring.
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    p[61 + k] = L(cx + Math.cos(a) * rx * 0.3, cy + ry * 0.45 + Math.sin(a) * ry * 0.11);
  }
  return p;
}

function handPts(cx: number, cy: number, s: number): Landmark[] {
  const p: Landmark[] = [];
  p[0] = L(cx, cy + s * 0.9);
  const fingers = [[-0.55, 0.35], [-0.22, 0], [0, -0.08], [0.22, 0], [0.42, 0.2]];
  fingers.forEach(([dx, dy], f) => {
    for (let j = 0; j < 4; j++) {
      const t = (j + 1) / 4;
      p[1 + f * 4 + j] = L(cx + dx * s * (0.5 + t * 0.7), cy + s * (0.6 - t * 1.15) + dy * s * 0.5);
    }
  });
  return p;
}

function posePts(cx: number, cy: number, s: number): Landmark[] {
  const p: Landmark[] = Array.from({ length: 33 }, () => L(cx, cy, 0, 0.92));
  const set = (i: number, x: number, y: number) => { p[i] = L(cx + x * s, cy + y * s, 0, 0.93); };
  set(0, 0, -0.95); set(11, -0.3, -0.55); set(12, 0.3, -0.55);
  set(13, -0.46, -0.16); set(14, 0.46, -0.16);
  set(15, -0.4, 0.2); set(16, 0.4, 0.2);
  set(23, -0.2, 0.1); set(24, 0.2, 0.1);
  set(25, -0.24, 0.6); set(26, 0.24, 0.6);
  set(27, -0.26, 1.05); set(28, 0.26, 1.05);
  return p;
}

const box = (pts: Landmark[], pad = 0.06) => {
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const w = x1 - x0, h = y1 - y0;
  return { x: x0 - w * pad, y: y0 - h * pad, w: w * (1 + pad * 2), h: h * (1 + pad * 2) };
};

const face = faceMesh(0.32, 0.33, 0.10, 0.15);
const hand = handPts(0.66, 0.62, 0.10);
const pose = posePts(0.5, 0.5, 0.3);

const frame: FrameState = {
  t: 4321,
  faces: [{
    id: 0x0a1, landmarks: face, box: box(face, 0.08),
    yaw: -12, pitch: 7, roll: -3,
    expressions: [{ name: 'browInnerUp', score: 0.71 }, { name: 'jawOpen', score: 0.33 }],
    aperture: 0.82, age: 341,
  }],
  hands: [{
    id: 0x0b7, handedness: 'LEFT', confidence: 0.97, landmarks: hand, box: box(hand, 0.12),
    gesture: 'Victory', gestureScore: 0.93, pinch: 0.19, age: 96,
  }],
  poses: [{ id: 0x0c4, landmarks: pose, box: box(pose), lean: 6, quality: 0.94, age: 512 }],
  objects: [
    { id: 0x0d2, label: 'laptop', score: 0.88, box: { x: 0.06, y: 0.62, w: 0.26, h: 0.24 }, age: 77, vx: 0.006, vy: -0.002 },
    { id: 0x0d9, label: 'cup', score: 0.74, box: { x: 0.80, y: 0.30, w: 0.11, h: 0.15 }, age: 22, vx: 0, vy: 0 },
  ],
};

const tel: Telemetry = {
  fps: 58.4, frameMs: 9.7, drawMs: 2.1, tier: 0, budgetMs: 16.6,
  modules: {
    face: { enabled: true, ready: true, cost: 4.4, hz: 58, error: null },
    hands: { enabled: true, ready: true, cost: 3.1, hz: 57, error: null },
    pose: { enabled: true, ready: true, cost: 5.6, hz: 29, error: null },
    objects: { enabled: true, ready: true, cost: 18.2, hz: 6, error: null },
  },
  resolution: '1280×720', backend: 'GPU',
};

const bg = document.getElementById('bg') as HTMLCanvasElement;
bg.width = W; bg.height = H;
const bx = bg.getContext('2d')!;
const g = bx.createLinearGradient(0, 0, W, H);
g.addColorStop(0, '#121a18'); g.addColorStop(1, '#0a0f0e');
bx.fillStyle = g; bx.fillRect(0, 0, W, H);

const hud = document.getElementById('hud') as HTMLCanvasElement;
hud.width = W; hud.height = H;
render(hud.getContext('2d')!, W, H, frame, tel, {
  mirrored: false, tesselation: true, post: true,
  labels: true, reducedMotion: true, compact: false,
});
(window as unknown as { HUD_DONE: boolean }).HUD_DONE = true;
