/**
 * Headless verification of the pure logic: filtering, geometry, identity
 * assignment and coasting. Run with: npm test
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { OneEuro, LandmarkSmoother, boundsOf, iou, assign, matrixToEuler, Rolling } from '../src/core/math.ts';
import { FaceTracker, HandTracker, ObjectTracker, PoseTracker } from '../src/core/trackers.ts';
import type { Landmark } from '../src/core/types.ts';

const lm = (x: number, y: number, z = 0, v = 1): Landmark => ({ x, y, z, visibility: v });
/** A plausible 478-point face mesh centred on (cx,cy). */
const face = (cx: number, cy: number, s = 0.1): Landmark[] =>
  Array.from({ length: 478 }, (_, i) =>
    lm(cx + Math.cos(i) * s, cy + Math.sin(i) * s * 1.3),
  );
const hand = (cx: number, cy: number): Landmark[] =>
  Array.from({ length: 21 }, (_, i) => lm(cx + (i % 5) * 0.01, cy + Math.floor(i / 5) * 0.02));
const pose = (cx: number, cy: number): Landmark[] =>
  Array.from({ length: 33 }, (_, i) => lm(cx + (i % 4) * 0.02, cy + i * 0.01, 0, 0.9));

test('OneEuro converges to a constant and does not overshoot', () => {
  const f = new OneEuro();
  let v = 0;
  for (let i = 0; i < 200; i++) v = f.filter(5, i / 60);
  assert.ok(Math.abs(v - 5) < 1e-3, `converged to ${v}`);
});

test('OneEuro suppresses jitter more than it lags a ramp', () => {
  const jit = new OneEuro();
  let maxDev = 0;
  for (let i = 0; i < 300; i++) {
    const noisy = 1 + (i % 2 ? 0.05 : -0.05);
    const out = jit.filter(noisy, i / 60);
    if (i > 60) maxDev = Math.max(maxDev, Math.abs(out - 1));
  }
  assert.ok(maxDev < 0.02, `residual jitter ${maxDev}`);
});

test('OneEuro tolerates NaN and long gaps without exploding', () => {
  const f = new OneEuro();
  f.filter(1, 0);
  const out = f.filter(2, 100); // 100s gap -> dt clamped
  assert.ok(Number.isFinite(out));
});

test('LandmarkSmoother preserves array shape', () => {
  const s = new LandmarkSmoother();
  const out = s.apply(hand(0.5, 0.5), 0.016);
  assert.equal(out.length, 21);
  assert.ok(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
});

test('boundsOf is clamped into frame and handles empty input', () => {
  const b = boundsOf([lm(-1, -1), lm(2, 2)]);
  assert.ok(b.x >= 0 && b.y >= 0 && b.w <= 1 && b.h <= 1);
  const e = boundsOf([]);
  assert.deepEqual(e, { x: 0, y: 0, w: 0, h: 0 });
});

test('iou: identical=1, disjoint=0', () => {
  const a = { x: 0, y: 0, w: 0.5, h: 0.5 };
  assert.equal(iou(a, a), 1);
  assert.equal(iou(a, { x: 0.6, y: 0.6, w: 0.2, h: 0.2 }), 0);
});

test('assign is one-to-one and prefers the best overlap', () => {
  const prev = [
    { id: 7, box: { x: 0, y: 0, w: 0.2, h: 0.2 } },
    { id: 9, box: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } },
  ];
  const ids = assign(prev, [
    { x: 0.51, y: 0.51, w: 0.2, h: 0.2 },
    { x: 0.01, y: 0.01, w: 0.2, h: 0.2 },
  ]);
  assert.deepEqual(ids, [9, 7]);
});

test('matrixToEuler returns zeros for identity', () => {
  const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
  const e = matrixToEuler(I);
  assert.ok(Math.abs(e.yaw) < 1e-6 && Math.abs(e.pitch) < 1e-6 && Math.abs(e.roll) < 1e-6);
});

test('Rolling window bounds its length and mean', () => {
  const r = new Rolling(3);
  [1, 2, 3, 4].forEach((v) => r.push(v));
  assert.equal(r.count, 3);
  assert.equal(r.mean, 3); // (2+3+4)/3
});

test('FaceTracker holds one identity across frames and ages it', () => {
  const t = new FaceTracker();
  let id = -1;
  for (let i = 0; i < 12; i++) {
    const out = t.update([face(0.5 + i * 0.002, 0.5)], null, null, i / 60);
    assert.equal(out.length, 1);
    if (i === 0) id = out[0].id;
    else assert.equal(out[0].id, id, `identity changed on frame ${i}`);
  }
});

test('FaceTracker separates two simultaneous subjects', () => {
  const t = new FaceTracker();
  const out = t.update([face(0.25, 0.5), face(0.75, 0.5)], null, null, 0);
  assert.equal(out.length, 2);
  assert.notEqual(out[0].id, out[1].id);
});

/** Overwrite the canonical eye indices with an explicit aperture geometry. */
const withEyes = (base: Landmark[], openness: number): Landmark[] => {
  const p = base.slice();
  const eye = (top: number, bot: number, outer: number, inner: number, cx: number) => {
    const half = 0.02 * openness; // vertical half-height
    p[outer] = lm(cx - 0.03, 0.4);
    p[inner] = lm(cx + 0.03, 0.4); // width fixed at 0.06
    p[top] = lm(cx, 0.4 - half);
    p[bot] = lm(cx, 0.4 + half);
  };
  eye(159, 145, 33, 133, 0.42);
  eye(386, 374, 263, 362, 0.58);
  return p;
};

test('FaceTracker aperture reads open eyes as open', () => {
  const t = new FaceTracker();
  let a = 0;
  // openness 1 -> v/h = 0.04/0.06 = 0.667 -> well above the open threshold.
  for (let i = 0; i < 20; i++) a = t.update([withEyes(face(0.5, 0.4), 1)], null, null, i / 60)[0].aperture;
  assert.ok(a > 0.8, `aperture ${a} should read open`);
});

test('FaceTracker aperture drops when eyelids close', () => {
  const t = new FaceTracker();
  let a = 1;
  // openness 0.05 -> v/h = 0.002/0.06 = 0.033 -> below the 0.09 closed floor.
  for (let i = 0; i < 30; i++) a = t.update([withEyes(face(0.5, 0.4), 0.05)], null, null, i / 60)[0].aperture;
  assert.ok(a < 0.25, `aperture ${a} should read closed`);
});

test('HandTracker inverts handedness for the mirrored operator view', () => {
  const t = new HandTracker();
  const out = t.update([hand(0.4, 0.4)], ['Left'], [0.99], [null], 0);
  assert.equal(out[0].handedness, 'RIGHT');
});

test('HandTracker reports a pinch when thumb meets index', () => {
  const t = new HandTracker();
  const h = hand(0.4, 0.4);
  h[4] = lm(0.4, 0.4);
  h[8] = lm(0.4005, 0.4005);
  h[0] = lm(0.4, 0.4);
  h[9] = lm(0.4, 0.5);
  const out = t.update([h], ['Right'], [0.9], [{ name: 'Closed_Fist', score: 0.8 }], 0);
  assert.ok(out[0].pinch < 0.2, `pinch ${out[0].pinch}`);
  assert.equal(out[0].gesture, 'Closed_Fist');
});

test("HandTracker treats MediaPipe's 'None' gesture as no gesture", () => {
  const t = new HandTracker();
  const out = t.update([hand(0.4, 0.4)], ['Right'], [0.9], [{ name: 'None', score: 0.9 }], 0);
  assert.equal(out[0].gesture, null);
});

test('PoseTracker computes quality and a finite lean', () => {
  const t = new PoseTracker();
  const out = t.update([pose(0.5, 0.2)], 0);
  assert.ok(Number.isFinite(out[0].lean));
  assert.ok(out[0].quality >= 0 && out[0].quality <= 1);
});

test('ObjectTracker keeps identity, then coasts and finally drops a lost object', () => {
  const t = new ObjectTracker();
  const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };
  t.update([{ label: 'cup', score: 0.9, box }]);
  const id = t.coast()[0].id;
  t.update([{ label: 'cup', score: 0.9, box: { ...box, x: 0.32 } }]);
  assert.equal(t.coast()[0].id, id, 'identity must survive movement');

  for (let i = 0; i < 10; i++) t.update([]);
  assert.equal(t.coast().length, 1, 'should still coast while recently lost');
  for (let i = 0; i < 30; i++) t.update([]);
  assert.equal(t.coast().length, 0, 'should be dropped after the coast window');
});

test('ObjectTracker re-identifies when the label changes in place', () => {
  const t = new ObjectTracker();
  const box = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };
  t.update([{ label: 'cup', score: 0.9, box }]);
  const first = t.coast()[0].id;
  t.update([{ label: 'bottle', score: 0.9, box }]);
  assert.notEqual(t.coast().find((o) => o.label === 'bottle')!.id, first);
});
