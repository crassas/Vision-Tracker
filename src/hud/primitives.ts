/**
 * Drawing primitives for the HUD.
 *
 * Rule enforced throughout: no closed rounded rectangles, no drop shadows, no
 * gradient fills. The vocabulary is bracket corners, tick rules, hairlines and
 * monospaced type — instrumentation, not decoration.
 */
import { PALETTE, alpha } from '../core/palette';

export interface Ctx2 extends CanvasRenderingContext2D {}

export const MONO =
  "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, 'VT CJK', monospace";

export function setType(ctx: Ctx2, size: number, weight = 400, tracking = 0): void {
  ctx.font = `${weight} ${size}px ${MONO}`;
  ctx.letterSpacing = `${tracking}px`;
  ctx.textBaseline = 'alphabetic';
}

/** Bracket corners around a rect — the signature reticle of the whole HUD. */
export function bracket(
  ctx: Ctx2,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  arm = 14,
  lw = 1.25,
): void {
  const a = Math.min(arm, w * 0.4, h * 0.4);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  // TL
  ctx.moveTo(x, y + a);
  ctx.lineTo(x, y);
  ctx.lineTo(x + a, y);
  // TR
  ctx.moveTo(x + w - a, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + a);
  // BR
  ctx.moveTo(x + w, y + h - a);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - a, y + h);
  // BL
  ctx.moveTo(x + a, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - a);
  ctx.stroke();
}

/** Faint full-rect hairline, used under brackets to imply a scanned volume. */
export function hairRect(ctx: Ctx2, x: number, y: number, w: number, h: number, color: string): void {
  ctx.strokeStyle = alpha(color, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
}

/** Tick marks along the top edge of a box — a measurement scale. */
export function edgeTicks(
  ctx: Ctx2,
  x: number,
  y: number,
  w: number,
  color: string,
  count = 8,
  len = 4,
): void {
  ctx.strokeStyle = alpha(color, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < count; i++) {
    const px = Math.round(x + (w * i) / count) + 0.5;
    const l = i % 2 === 0 ? len : len * 0.5;
    ctx.moveTo(px, y);
    ctx.lineTo(px, y + l);
  }
  ctx.stroke();
}

/**
 * A leader line from an anchor out to a label plate. Elbowed, never diagonal
 * into the text — this is what makes annotations read as engineering callouts.
 */
export function leader(
  ctx: Ctx2,
  ax: number,
  ay: number,
  tx: number,
  ty: number,
  color: string,
): void {
  const mid = ax + (tx - ax) * 0.45;
  ctx.strokeStyle = alpha(color, 0.65);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(mid, ay);
  ctx.lineTo(mid, ty);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(ax - 1.5, ay - 1.5, 3, 3);
}

/**
 * Label plate: left rule, dark backing, monospaced content. Returns its width so
 * callers can lay out around it.
 */
export function plate(
  ctx: Ctx2,
  x: number,
  y: number,
  lines: Array<{ text: string; color?: string; size?: number }>,
  accent: string,
  align: 'left' | 'right' = 'left',
): { w: number; h: number } {
  const pad = 6;
  const lh = 13;
  let w = 0;
  for (const l of lines) {
    setType(ctx, l.size ?? 10, 500, 0.4);
    w = Math.max(w, ctx.measureText(l.text).width);
  }
  w += pad * 2 + 3;
  const h = lines.length * lh + pad * 1.4;
  const px = align === 'right' ? x - w : x;

  ctx.fillStyle = alpha(PALETTE.ground, 0.82);
  ctx.fillRect(px, y, w, h);
  ctx.fillStyle = accent;
  ctx.fillRect(align === 'right' ? px + w - 2 : px, y, 2, h);
  ctx.strokeStyle = alpha(accent, 0.28);
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, y + 0.5, w - 1, h - 1);

  lines.forEach((l, i) => {
    setType(ctx, l.size ?? 10, 500, 0.4);
    ctx.fillStyle = l.color ?? PALETTE.bone;
    ctx.textAlign = align === 'right' ? 'right' : 'left';
    const tx = align === 'right' ? px + w - pad - 3 : px + pad + 3;
    ctx.fillText(l.text, tx, y + pad + lh * (i + 1) - 4);
  });
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';
  return { w, h };
}

/** Horizontal bar meter with a notch scale. */
export function meter(
  ctx: Ctx2,
  x: number,
  y: number,
  w: number,
  h: number,
  v: number,
  color: string,
): void {
  ctx.strokeStyle = alpha(color, 0.35);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.fillStyle = alpha(color, 0.75);
  ctx.fillRect(x + 1.5, y + 1.5, Math.max(0, (w - 2) * Math.max(0, Math.min(1, v))), h - 2);
  ctx.strokeStyle = alpha(PALETTE.ground, 0.9);
  ctx.beginPath();
  for (let i = 1; i < 5; i++) {
    const px = Math.round(x + (w * i) / 5) + 0.5;
    ctx.moveTo(px, y + 1);
    ctx.lineTo(px, y + h - 1);
  }
  ctx.stroke();
}

/** Connect a landmark graph. */
export function skeleton(
  ctx: Ctx2,
  pts: Array<{ x: number; y: number }>,
  conns: Array<{ start: number; end: number }>,
  color: string,
  lw: number,
  W: number,
  H: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const c of conns) {
    const a = pts[c.start];
    const b = pts[c.end];
    if (!a || !b) continue;
    ctx.moveTo(a.x * W, a.y * H);
    ctx.lineTo(b.x * W, b.y * H);
  }
  ctx.stroke();
}

export function nodes(
  ctx: Ctx2,
  pts: Array<{ x: number; y: number }>,
  color: string,
  r: number,
  W: number,
  H: number,
): void {
  ctx.fillStyle = color;
  for (const p of pts) {
    ctx.fillRect(p.x * W - r, p.y * H - r, r * 2, r * 2);
  }
}

/** Crosshair with a gap at the centre, so it never occludes the target. */
export function crosshair(ctx: Ctx2, cx: number, cy: number, r: number, gap: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
}

/** Dashed arc, used for attitude / rotation read-outs. */
export function arc(
  ctx: Ctx2,
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
  color: string,
  lw = 1.5,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, to);
  ctx.stroke();
}
