/**
 * HUD renderer. Pure function of (FrameState, Telemetry) -> pixels.
 *
 * It never mutates tracking state and never allocates per-frame beyond small
 * strings, so it can be throttled or skipped entirely without side effects.
 */
import { FaceLandmarker, GestureRecognizer, PoseLandmarker } from '@mediapipe/tasks-vision';
import { MODULE_GLYPH, TIERS } from '../core/config';
import { MODULE_COLOR, PALETTE, alpha } from '../core/palette';
import type { FrameState, Rect, Telemetry } from '../core/types';
import {
  arc,
  bracket,
  crosshair,
  edgeTicks,
  hairRect,
  leader,
  meter,
  nodes,
  plate,
  setType,
  skeleton,
  type Ctx2,
} from './primitives';

const FACE_OVAL = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
const FACE_TESS = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
const FACE_EYES = [
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
  ...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
  ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
];
const FACE_LIPS = FaceLandmarker.FACE_LANDMARKS_LIPS;
const HAND_CONN = GestureRecognizer.HAND_CONNECTIONS;
const POSE_CONN = PoseLandmarker.POSE_CONNECTIONS;

const hex = (n: number, w = 4) => n.toString(16).toUpperCase().padStart(w, '0');
const pad2 = (n: number) => String(n).padStart(2, '0');

export interface RenderOptions {
  mirrored: boolean;
  tesselation: boolean;
  post: boolean;
  labels: boolean;
  reducedMotion: boolean;
  compact: boolean;
}

export function render(
  ctx: Ctx2,
  W: number,
  H: number,
  frame: FrameState,
  tel: Telemetry,
  opts: RenderOptions,
): void {
  ctx.clearRect(0, 0, W, H);
  const t = frame.t / 1000;
  const pulse = opts.reducedMotion ? 0.8 : 0.62 + Math.sin(t * 2.4) * 0.18;

  drawFrameFurniture(ctx, W, H, tel, t, opts);
  if (frame.poses.length) drawPoses(ctx, W, H, frame, opts);
  if (frame.objects.length) drawObjects(ctx, W, H, frame, opts, pulse);
  if (frame.faces.length) drawFaces(ctx, W, H, frame, opts, pulse);
  if (frame.hands.length) drawHands(ctx, W, H, frame, opts);
  drawSubjectRoster(ctx, W, H, frame, opts);
}

/* ── frame furniture ──────────────────────────────────────────────────────── */

function drawFrameFurniture(
  ctx: Ctx2,
  W: number,
  H: number,
  tel: Telemetry,
  t: number,
  opts: RenderOptions,
): void {
  const m = opts.compact ? 10 : 22;
  const c = PALETTE.sodiumDim;

  // Outer registration frame.
  ctx.strokeStyle = alpha(c, 0.45);
  ctx.lineWidth = 1;
  ctx.strokeRect(m + 0.5, m + 0.5, W - m * 2, H - m * 2);
  bracket(ctx, m, m, W - m * 2, H - m * 2, PALETTE.sodium, opts.compact ? 12 : 20, 1.5);

  // Ruled scale along the top edge.
  const steps = opts.compact ? 16 : 32;
  ctx.strokeStyle = alpha(c, 0.5);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(m + ((W - m * 2) * i) / steps) + 0.5;
    const len = i % 4 === 0 ? 7 : 3;
    ctx.moveTo(x, m);
    ctx.lineTo(x, m + len);
    ctx.moveTo(x, H - m);
    ctx.lineTo(x, H - m - len);
  }
  ctx.stroke();

  // Centre reticle — dormant, marks the optical axis.
  const cx = W / 2;
  const cy = H / 2;
  crosshair(ctx, cx, cy, opts.compact ? 16 : 26, 7, alpha(PALETTE.sodium, 0.3));
  ctx.strokeStyle = alpha(PALETTE.sodium, 0.22);
  ctx.beginPath();
  ctx.arc(cx, cy, opts.compact ? 20 : 32, 0, Math.PI * 2);
  ctx.stroke();

  // Corner identity block.
  setType(ctx, opts.compact ? 8 : 9, 500, 1.1);
  ctx.fillStyle = alpha(PALETTE.sodium, 0.8);
  ctx.fillText('VISION-TRACKER / 視覚追跡', m + 8, m + 18);
  ctx.fillStyle = alpha(PALETTE.boneDim, 0.75);
  const tier = TIERS[tel.tier];
  ctx.fillText(
    `${tel.resolution}  ${tel.backend}  ${tier.name}  ${tel.fps.toFixed(0)}FPS`,
    m + 8,
    m + 30,
  );

  // Right-hand timecode.
  ctx.textAlign = 'right';
  const d = new Date();
  ctx.fillStyle = alpha(PALETTE.sodium, 0.8);
  ctx.fillText(
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`,
    W - m - 8,
    m + 18,
  );
  ctx.fillStyle = alpha(PALETTE.boneDim, 0.7);
  ctx.fillText(`SEQ ${hex(Math.floor(t * 30) & 0xffff)}`, W - m - 8, m + 30);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
}

/* ── faces ────────────────────────────────────────────────────────────────── */

function drawFaces(
  ctx: Ctx2,
  W: number,
  H: number,
  frame: FrameState,
  opts: RenderOptions,
  pulse: number,
): void {
  const C = MODULE_COLOR.face;
  for (const f of frame.faces) {
    const b = px(f.box, W, H);

    if (opts.tesselation) {
      ctx.globalAlpha = 0.16;
      skeleton(ctx, f.landmarks, FACE_TESS, C, 0.5, W, H);
      ctx.globalAlpha = 1;
    }
    skeleton(ctx, f.landmarks, FACE_OVAL, C, 1.3, W, H);
    skeleton(ctx, f.landmarks, FACE_EYES, alpha(PALETTE.bone, 0.9), 1.1, W, H);
    skeleton(ctx, f.landmarks, FACE_LIPS, alpha(C, 0.8), 1, W, H);

    // Iris fix points.
    const iris = [468, 473].map((i) => f.landmarks[i]).filter(Boolean);
    nodes(ctx, iris, PALETTE.bone, 1.6, W, H);
    for (const p of iris) {
      ctx.strokeStyle = alpha(PALETTE.bone, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x * W, p.y * H, 7, 0, Math.PI * 2);
      ctx.stroke();
    }

    hairRect(ctx, b.x, b.y, b.w, b.h, C);
    bracket(ctx, b.x, b.y, b.w, b.h, alpha(C, pulse), 16, 1.5);
    edgeTicks(ctx, b.x, b.y, b.w, C, 8, 4);

    // Attitude arcs: yaw on the horizontal, pitch on the vertical.
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const R = Math.max(b.w, b.h) * 0.62;
    const yawA = (f.yaw * Math.PI) / 180;
    arc(ctx, cx, cy, R, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5, alpha(C, 0.22), 4);
    arc(ctx, cx, cy, R, -Math.PI / 2 + yawA * 0.5 - 0.06, -Math.PI / 2 + yawA * 0.5 + 0.06, C, 4);

    if (!opts.labels) continue;

    const lx = b.x + b.w + 18;
    const ly = b.y;
    const right = lx + 150 > W;
    const tx = right ? b.x - 18 : lx;
    leader(ctx, right ? b.x : b.x + b.w, b.y + 10, tx, ly + 8, C);
    const lines: Array<{ text: string; color?: string; size?: number }> = [
      { text: `顔 SUBJ ${hex(f.id, 3)}`, color: C, size: 10 },
      { text: `YAW ${sign(f.yaw)}  PIT ${sign(f.pitch)}`, color: PALETTE.bone },
      { text: `ROL ${sign(f.roll)}  T+${f.age}`, color: PALETTE.boneDim },
    ];
    if (f.expressions.length) {
      lines.push({
        text: `${f.expressions[0].name.toUpperCase()} ${(f.expressions[0].score * 100).toFixed(0)}%`,
        color: PALETTE.sodium,
      });
    }
    lines.push({
      text: f.aperture < 0.25 ? 'OCULAR: CLOSED' : `OCULAR: ${(f.aperture * 100).toFixed(0)}%`,
      color: f.aperture < 0.25 ? PALETTE.oxide : PALETTE.verdigris,
    });
    const p = plate(ctx, tx, ly, lines, C, right ? 'right' : 'left');
    meter(
      ctx,
      right ? tx - p.w : tx,
      ly + p.h + 3,
      p.w,
      4,
      f.aperture,
      f.aperture < 0.25 ? PALETTE.oxide : PALETTE.verdigris,
    );
  }
}

/* ── hands ────────────────────────────────────────────────────────────────── */

function drawHands(ctx: Ctx2, W: number, H: number, frame: FrameState, opts: RenderOptions): void {
  const C = MODULE_COLOR.hands;
  for (const h of frame.hands) {
    const b = px(h.box, W, H);
    skeleton(ctx, h.landmarks, HAND_CONN, C, 1.6, W, H);
    nodes(ctx, h.landmarks, alpha(PALETTE.bone, 0.9), 1.5, W, H);

    // Fingertips get emphasised — they are the interaction surface.
    for (const i of [4, 8, 12, 16, 20]) {
      const p = h.landmarks[i];
      if (!p) continue;
      ctx.strokeStyle = alpha(C, 0.8);
      ctx.lineWidth = 1;
      ctx.strokeRect(p.x * W - 3.5, p.y * H - 3.5, 7, 7);
    }

    // Pinch vector: the single most useful hand metric, drawn literally.
    const a = h.landmarks[4];
    const c = h.landmarks[8];
    if (a && c) {
      const closing = h.pinch < 0.28;
      ctx.strokeStyle = closing ? PALETTE.oxide : alpha(C, 0.5);
      ctx.lineWidth = closing ? 1.8 : 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x * W, a.y * H);
      ctx.lineTo(c.x * W, c.y * H);
      ctx.stroke();
      ctx.setLineDash([]);
      if (closing) {
        const mx = ((a.x + c.x) / 2) * W;
        const my = ((a.y + c.y) / 2) * H;
        crosshair(ctx, mx, my, 11, 4, PALETTE.oxide);
      }
    }

    bracket(ctx, b.x, b.y, b.w, b.h, alpha(C, 0.7), 10, 1.1);
    if (!opts.labels) continue;

    const right = b.x + b.w + 140 > W;
    const tx = right ? b.x - 14 : b.x + b.w + 14;
    const ty = b.y + b.h - 34;
    leader(ctx, right ? b.x : b.x + b.w, b.y + b.h - 26, tx, ty + 8, C);
    plate(
      ctx,
      tx,
      ty,
      [
        { text: `手 ${h.handedness} ${hex(h.id, 3)}`, color: C, size: 10 },
        {
          text: h.gesture ? `${h.gesture.toUpperCase()} ${(h.gestureScore * 100).toFixed(0)}%` : 'GESTURE —',
          color: h.gesture ? PALETTE.sodium : PALETTE.boneDim,
        },
        { text: `PINCH ${(h.pinch * 100).toFixed(0)}`, color: PALETTE.bone },
      ],
      C,
      right ? 'right' : 'left',
    );
  }
}

/* ── poses ────────────────────────────────────────────────────────────────── */

function drawPoses(ctx: Ctx2, W: number, H: number, frame: FrameState, opts: RenderOptions): void {
  const C = MODULE_COLOR.pose;
  for (const p of frame.poses) {
    const vis = p.landmarks.map((l) => ((l.visibility ?? 1) > 0.5 ? l : { ...l, x: l.x, y: l.y }));
    ctx.globalAlpha = 0.85;
    skeleton(ctx, vis, POSE_CONN, C, 2, W, H);
    ctx.globalAlpha = 1;
    nodes(ctx, vis.filter((l) => (l.visibility ?? 1) > 0.5), alpha(PALETTE.bone, 0.85), 2, W, H);

    // Joint rings on the major articulations.
    for (const i of [11, 12, 13, 14, 23, 24, 25, 26]) {
      const l = p.landmarks[i];
      if (!l || (l.visibility ?? 0) < 0.5) continue;
      ctx.strokeStyle = alpha(C, 0.55);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(l.x * W, l.y * H, 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spine axis + lean read-out.
    const sx = ((p.landmarks[11].x + p.landmarks[12].x) / 2) * W;
    const sy = ((p.landmarks[11].y + p.landmarks[12].y) / 2) * H;
    const hx = ((p.landmarks[23].x + p.landmarks[24].x) / 2) * W;
    const hy = ((p.landmarks[23].y + p.landmarks[24].y) / 2) * H;
    ctx.strokeStyle = alpha(PALETTE.sodium, 0.6);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(sx, sy);
    ctx.stroke();
    ctx.setLineDash([]);

    const b = px(p.box, W, H);
    hairRect(ctx, b.x, b.y, b.w, b.h, C);
    if (!opts.labels) continue;
    plate(
      ctx,
      b.x,
      b.y - 34,
      [
        { text: `骨 FIG ${hex(p.id, 3)}  LEAN ${sign(p.lean)}`, color: C, size: 10 },
        { text: `TRACK Q ${(p.quality * 100).toFixed(0)}%  T+${p.age}`, color: PALETTE.boneDim },
      ],
      C,
    );
  }
}

/* ── objects ──────────────────────────────────────────────────────────────── */

function drawObjects(
  ctx: Ctx2,
  W: number,
  H: number,
  frame: FrameState,
  opts: RenderOptions,
  pulse: number,
): void {
  const C = MODULE_COLOR.objects;
  for (const o of frame.objects) {
    const b = px(o.box, W, H);
    hairRect(ctx, b.x, b.y, b.w, b.h, C);
    bracket(ctx, b.x, b.y, b.w, b.h, alpha(C, 0.55 + pulse * 0.3), 9, 1);

    // Motion vector, drawn only when the thing is actually moving.
    const speed = Math.hypot(o.vx, o.vy);
    if (speed > 0.004) {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const k = 900;
      ctx.strokeStyle = PALETTE.oxide;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + o.vx * k, cy + o.vy * k);
      ctx.stroke();
    }

    if (!opts.labels) continue;
    setType(ctx, 9, 500, 0.6);
    const label = `物 ${o.label.toUpperCase()}`;
    const conf = `${(o.score * 100).toFixed(0)}%`;
    const w = ctx.measureText(`${label}  ${conf}`).width + 12;
    ctx.fillStyle = alpha(PALETTE.ground, 0.85);
    ctx.fillRect(b.x, b.y - 15, w, 14);
    ctx.fillStyle = C;
    ctx.fillRect(b.x, b.y - 15, 2, 14);
    ctx.fillStyle = PALETTE.bone;
    ctx.fillText(label, b.x + 7, b.y - 5);
    ctx.fillStyle = alpha(PALETTE.sodium, 0.9);
    ctx.textAlign = 'right';
    ctx.fillText(conf, b.x + w - 5, b.y - 5);
    ctx.textAlign = 'left';
    ctx.letterSpacing = '0px';
  }
}

/* ── roster ───────────────────────────────────────────────────────────────── */

/** Bottom-left census of everything currently held, GITS dossier style. */
function drawSubjectRoster(
  ctx: Ctx2,
  _W: number,
  H: number,
  frame: FrameState,
  opts: RenderOptions,
): void {
  if (opts.compact) return;
  const m = 22;
  const rows: Array<[string, number, string]> = [
    [MODULE_GLYPH.face, frame.faces.length, MODULE_COLOR.face],
    [MODULE_GLYPH.hands, frame.hands.length, MODULE_COLOR.hands],
    [MODULE_GLYPH.pose, frame.poses.length, MODULE_COLOR.pose],
    [MODULE_GLYPH.objects, frame.objects.length, MODULE_COLOR.objects],
  ];
  let y = H - m - 12;
  for (let i = rows.length - 1; i >= 0; i--) {
    const [glyph, n, color] = rows[i];
    setType(ctx, 10, 500, 0.5);
    ctx.fillStyle = n ? color : alpha(color, 0.28);
    ctx.fillText(glyph, m + 8, y);
    ctx.fillStyle = n ? PALETTE.bone : PALETTE.boneDim;
    ctx.fillText(String(n).padStart(2, '0'), m + 26, y);
    ctx.fillStyle = alpha(color, n ? 0.75 : 0.2);
    ctx.fillRect(m + 46, y - 7, Math.min(60, n * 14) || 2, 6);
    y -= 15;
  }
  ctx.letterSpacing = '0px';
}

/* ── helpers ──────────────────────────────────────────────────────────────── */

function px(r: Rect, W: number, H: number) {
  return { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };
}

const sign = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0).padStart(2, '0')}°`;
