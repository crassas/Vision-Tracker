/**
 * Identity assignment + temporal smoothing.
 *
 * MediaPipe emits per-frame detections with no stable identity and no temporal
 * coherence. Everything the HUD says about "subject 03" — its age, its
 * velocity, the fact that its box doesn't shiver — is produced here.
 */
import { LandmarkSmoother, assign, boundsOf, centerOf, lerp, matrixToEuler } from './math';
import type {
  FaceTrack,
  HandTrack,
  Landmark,
  ObjectTrack,
  PoseTrack,
  Rect,
} from './types';

let SEQ = 1;
const nextId = () => SEQ++;

/** Frames a track survives without a detection before it is dropped. */
const COAST = { face: 8, hands: 6, pose: 8, objects: 24 } as const;

interface Slot<T> {
  track: T;
  smoother: LandmarkSmoother;
  missing: number;
}

const MESH_KEY = {
  // MediaPipe canonical face mesh indices.
  leftEyeTop: 159,
  leftEyeBottom: 145,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeTop: 386,
  rightEyeBottom: 374,
  rightEyeOuter: 263,
  rightEyeInner: 362,
} as const;

function eyeAperture(p: Landmark[]): number {
  const ratio = (top: number, bot: number, a: number, b: number) => {
    const v = Math.hypot(p[top].x - p[bot].x, p[top].y - p[bot].y);
    const h = Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);
    return h > 1e-6 ? v / h : 0;
  };
  const l = ratio(MESH_KEY.leftEyeTop, MESH_KEY.leftEyeBottom, MESH_KEY.leftEyeOuter, MESH_KEY.leftEyeInner);
  const r = ratio(MESH_KEY.rightEyeTop, MESH_KEY.rightEyeBottom, MESH_KEY.rightEyeOuter, MESH_KEY.rightEyeInner);
  // ~0.09 closed, ~0.33 wide open; normalise into 0..1.
  return Math.max(0, Math.min(1, ((l + r) / 2 - 0.09) / 0.24));
}

export class FaceTracker {
  private slots: Slot<FaceTrack>[] = [];

  update(
    faces: Landmark[][],
    matrices: number[][] | null,
    blends: Array<Array<{ categoryName: string; score: number }>> | null,
    tSec: number,
  ): FaceTrack[] {
    const boxes = faces.map((f) => boundsOf(f, 0.08));
    const ids = assign(this.slots.map((s) => s.track), boxes, 0.2);
    const kept = new Set<number>();
    const out: FaceTrack[] = [];

    faces.forEach((raw, i) => {
      const id = ids[i];
      let slot = id !== null ? this.slots.find((s) => s.track.id === id) : undefined;
      if (!slot) {
        slot = {
          track: {
            id: nextId(),
            landmarks: raw,
            box: boxes[i],
            yaw: 0,
            pitch: 0,
            roll: 0,
            expressions: [],
            aperture: 1,
            age: 0,
          },
          smoother: new LandmarkSmoother(1.0, 0.02),
          missing: 0,
        };
        this.slots.push(slot);
      }
      const pts = slot.smoother.apply(raw, tSec);
      const euler = matrices?.[i] ? matrixToEuler(matrices[i]) : { yaw: 0, pitch: 0, roll: 0 };
      const expr = (blends?.[i] ?? [])
        .filter((c) => c.categoryName !== '_neutral' && c.score > 0.12)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4)
        .map((c) => ({ name: c.categoryName, score: c.score }));

      const t = slot.track;
      t.landmarks = pts;
      t.box = boundsOf(pts, 0.08);
      t.yaw = lerp(t.yaw, euler.yaw, 0.35);
      t.pitch = lerp(t.pitch, euler.pitch, 0.35);
      t.roll = lerp(t.roll, euler.roll, 0.35);
      t.expressions = expr;
      t.aperture = lerp(t.aperture, eyeAperture(pts), 0.5);
      t.age++;
      slot.missing = 0;
      kept.add(t.id);
      out.push(t);
    });

    this.slots = this.slots.filter((s) => kept.has(s.track.id) || ++s.missing <= COAST.face);
    return out;
  }
}

export class HandTracker {
  private slots: Slot<HandTrack>[] = [];

  update(
    hands: Landmark[][],
    handedness: string[],
    scores: number[],
    gestures: Array<{ name: string; score: number } | null>,
    tSec: number,
  ): HandTrack[] {
    const boxes = hands.map((h) => boundsOf(h, 0.12));
    const ids = assign(this.slots.map((s) => s.track), boxes, 0.15);
    const kept = new Set<number>();
    const out: HandTrack[] = [];

    hands.forEach((raw, i) => {
      const id = ids[i];
      let slot = id !== null ? this.slots.find((s) => s.track.id === id) : undefined;
      if (!slot) {
        slot = {
          track: {
            id: nextId(),
            handedness: 'RIGHT',
            confidence: 0,
            landmarks: raw,
            box: boxes[i],
            gesture: null,
            gestureScore: 0,
            pinch: 1,
            age: 0,
          },
          smoother: new LandmarkSmoother(1.4, 0.05),
          missing: 0,
        };
        this.slots.push(slot);
      }
      const pts = slot.smoother.apply(raw, tSec);
      const t = slot.track;
      t.landmarks = pts;
      t.box = boundsOf(pts, 0.12);
      // Camera is mirrored for the operator, so the model's label is inverted.
      t.handedness = handedness[i] === 'Left' ? 'RIGHT' : 'LEFT';
      t.confidence = scores[i] ?? 0;
      const g = gestures[i];
      if (g && g.name !== 'None') {
        t.gesture = g.name;
        t.gestureScore = g.score;
      } else {
        t.gesture = null;
        t.gestureScore = 0;
      }
      // Thumb tip (4) to index tip (8), normalised by wrist(0)->middle MCP(9) span.
      const span = Math.hypot(pts[0].x - pts[9].x, pts[0].y - pts[9].y) || 1e-6;
      t.pinch = Math.min(1, Math.hypot(pts[4].x - pts[8].x, pts[4].y - pts[8].y) / span);
      t.age++;
      slot.missing = 0;
      kept.add(t.id);
      out.push(t);
    });

    this.slots = this.slots.filter((s) => kept.has(s.track.id) || ++s.missing <= COAST.hands);
    return out;
  }
}

export class PoseTracker {
  private slots: Slot<PoseTrack>[] = [];

  update(poses: Landmark[][], tSec: number): PoseTrack[] {
    const boxes = poses.map((p) => boundsOf(p, 0.06));
    const ids = assign(this.slots.map((s) => s.track), boxes, 0.2);
    const kept = new Set<number>();
    const out: PoseTrack[] = [];

    poses.forEach((raw, i) => {
      const id = ids[i];
      let slot = id !== null ? this.slots.find((s) => s.track.id === id) : undefined;
      if (!slot) {
        slot = {
          track: {
            id: nextId(),
            landmarks: raw,
            box: boxes[i],
            lean: 0,
            quality: 0,
            age: 0,
          },
          smoother: new LandmarkSmoother(1.0, 0.03),
          missing: 0,
        };
        this.slots.push(slot);
      }
      const pts = slot.smoother.apply(raw, tSec);
      const t = slot.track;
      t.landmarks = pts;
      t.box = boundsOf(pts, 0.06);
      // Shoulder midpoint (11,12) vs hip midpoint (23,24): lean from vertical.
      const sx = (pts[11].x + pts[12].x) / 2;
      const sy = (pts[11].y + pts[12].y) / 2;
      const hx = (pts[23].x + pts[24].x) / 2;
      const hy = (pts[23].y + pts[24].y) / 2;
      const lean = (Math.atan2(sx - hx, hy - sy) * 180) / Math.PI;
      t.lean = lerp(t.lean, lean, 0.3);
      let vis = 0;
      for (const p of pts) vis += p.visibility ?? 0;
      t.quality = lerp(t.quality, vis / pts.length, 0.3);
      t.age++;
      slot.missing = 0;
      kept.add(t.id);
      out.push(t);
    });

    this.slots = this.slots.filter((s) => kept.has(s.track.id) || ++s.missing <= COAST.pose);
    return out;
  }
}

/**
 * Object tracks persist and coast between the (deliberately infrequent)
 * detector passes, so labels don't strobe at 6 Hz.
 */
export class ObjectTracker {
  private tracks: ObjectTrack[] = [];
  private missing = new Map<number, number>();

  /** Called only on frames where the detector actually ran. */
  update(dets: Array<{ label: string; score: number; box: Rect }>): void {
    const ids = assign(this.tracks, dets.map((d) => d.box), 0.3);
    const kept = new Set<number>();

    dets.forEach((d, i) => {
      const id = ids[i];
      let t = id !== null ? this.tracks.find((x) => x.id === id) : undefined;
      if (!t || t.label !== d.label) {
        t = { id: nextId(), label: d.label, score: d.score, box: d.box, age: 0, vx: 0, vy: 0 };
        this.tracks.push(t);
      } else {
        const prev = centerOf(t.box);
        const now = centerOf(d.box);
        t.vx = lerp(t.vx, now.x - prev.x, 0.5);
        t.vy = lerp(t.vy, now.y - prev.y, 0.5);
        t.box = {
          x: lerp(t.box.x, d.box.x, 0.5),
          y: lerp(t.box.y, d.box.y, 0.5),
          w: lerp(t.box.w, d.box.w, 0.5),
          h: lerp(t.box.h, d.box.h, 0.5),
        };
        t.score = lerp(t.score, d.score, 0.4);
      }
      t.age++;
      kept.add(t.id);
      this.missing.set(t.id, 0);
    });

    this.tracks = this.tracks.filter((t) => {
      if (kept.has(t.id)) return true;
      const m = (this.missing.get(t.id) ?? 0) + 1;
      this.missing.set(t.id, m);
      return m <= COAST.objects;
    });
  }

  /** Called every frame: dead-reckon boxes forward so motion stays continuous. */
  coast(): ObjectTrack[] {
    for (const t of this.tracks) {
      if ((this.missing.get(t.id) ?? 0) > 0) {
        t.box = { ...t.box, x: t.box.x + t.vx * 0.5, y: t.box.y + t.vy * 0.5 };
        t.vx *= 0.9;
        t.vy *= 0.9;
      }
    }
    return this.tracks;
  }
}
