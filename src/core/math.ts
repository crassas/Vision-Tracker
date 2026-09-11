import type { Landmark, Point2, Rect } from './types';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const dist2 = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Axis-aligned bounds of a landmark set, clamped to the frame. */
export function boundsOf(pts: Landmark[], pad = 0): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  const w = maxX - minX;
  const h = maxY - minY;
  return {
    x: clamp(minX - w * pad, 0, 1),
    y: clamp(minY - h * pad, 0, 1),
    w: clamp(w * (1 + pad * 2), 0, 1),
    h: clamp(h * (1 + pad * 2), 0, 1),
  };
}

export const centerOf = (r: Rect): Point2 => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.w * a.h + b.w * b.h - inter;
  return uni > 0 ? inter / uni : 0;
}

/**
 * One Euro filter — the correct tool for landmark smoothing. A plain EMA either
 * lags on fast motion or jitters at rest; this adapts its cutoff to speed, so
 * the overlay is dead-still on a held pose and still snaps to a fast gesture.
 * Casiez, Roussel & Vogel, CHI 2012.
 */
export class OneEuro {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.03,
    private dCutoff = 1.0,
  ) {}

  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(x: number, tSec: number): number {
    if (this.xPrev === null || !Number.isFinite(x)) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(1e-3, Math.min(0.25, tSec - this.tPrev));
    this.tPrev = tSec;

    const dx = (x - this.xPrev) / dt;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dxPrev = ad * dx + (1 - ad) * this.dxPrev;

    const cutoff = this.minCutoff + this.beta * Math.abs(this.dxPrev);
    const a = OneEuro.alpha(cutoff, dt);
    const xr = a * x + (1 - a) * this.xPrev;
    this.xPrev = xr;
    return xr;
  }
}

/** A bank of One Euro filters covering an arbitrary landmark array. */
export class LandmarkSmoother {
  private fx: OneEuro[] = [];
  private fy: OneEuro[] = [];
  private fz: OneEuro[] = [];

  constructor(
    private minCutoff = 1.2,
    private beta = 0.03,
  ) {}

  apply(pts: Landmark[], tSec: number): Landmark[] {
    const out = new Array<Landmark>(pts.length);
    for (let i = 0; i < pts.length; i++) {
      if (!this.fx[i]) {
        this.fx[i] = new OneEuro(this.minCutoff, this.beta);
        this.fy[i] = new OneEuro(this.minCutoff, this.beta);
        this.fz[i] = new OneEuro(this.minCutoff, this.beta);
      }
      const p = pts[i];
      out[i] = {
        x: this.fx[i].filter(p.x, tSec),
        y: this.fy[i].filter(p.y, tSec),
        z: this.fz[i].filter(p.z ?? 0, tSec),
        visibility: p.visibility,
      };
    }
    return out;
  }
}

/** Rolling scalar statistic with a fixed window, used for all cost telemetry. */
export class Rolling {
  private buf: number[] = [];
  private sum = 0;
  constructor(private size = 30) {}
  push(v: number): void {
    this.buf.push(v);
    this.sum += v;
    if (this.buf.length > this.size) this.sum -= this.buf.shift()!;
  }
  get mean(): number {
    return this.buf.length ? this.sum / this.buf.length : 0;
  }
  get count(): number {
    return this.buf.length;
  }
}

/**
 * Decompose MediaPipe's column-major 4x4 facial transform into intrinsic
 * yaw/pitch/roll in degrees.
 */
export function matrixToEuler(m: number[]): { yaw: number; pitch: number; roll: number } {
  // Column-major: m[col*4 + row].
  const r00 = m[0];
  const r10 = m[1];
  const r20 = m[2];
  const r21 = m[6];
  const r22 = m[10];
  const deg = 180 / Math.PI;
  const pitch = Math.atan2(-r20, Math.hypot(r21, r22)) * deg;
  const roll = Math.atan2(r10, r00) * deg;
  const yaw = Math.atan2(r21, r22) * deg;
  return { yaw, pitch, roll };
}

/** Greedy IoU assignment. Returns map of detectionIndex -> existing track id. */
export function assign<T extends { id: number; box: Rect }>(
  prev: T[],
  boxes: Rect[],
  minIou = 0.25,
): Array<number | null> {
  const out: Array<number | null> = new Array(boxes.length).fill(null);
  const taken = new Set<number>();
  const pairs: Array<{ d: number; p: number; s: number }> = [];
  for (let d = 0; d < boxes.length; d++) {
    for (let p = 0; p < prev.length; p++) {
      const s = iou(boxes[d], prev[p].box);
      if (s >= minIou) pairs.push({ d, p, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const usedDet = new Set<number>();
  for (const { d, p } of pairs) {
    if (usedDet.has(d) || taken.has(p)) continue;
    usedDet.add(d);
    taken.add(p);
    out[d] = prev[p].id;
  }
  return out;
}
