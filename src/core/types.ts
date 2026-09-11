export type ModuleId = 'face' | 'hands' | 'pose' | 'objects';

export interface Point2 {
  x: number;
  y: number;
}

export interface Landmark extends Point2 {
  z: number;
  visibility?: number;
}

/** Normalised rect in [0,1] video space. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FaceTrack {
  id: number;
  landmarks: Landmark[];
  box: Rect;
  /** Head rotation in degrees, derived from the 4x4 facial transform matrix. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Top expression channels, already sorted by score. */
  expressions: Array<{ name: string; score: number }>;
  /** Eye aperture 0..1, mean of both eyes. Drives the blink read-out. */
  aperture: number;
  /** Frames this identity has been continuously held. */
  age: number;
}

export interface HandTrack {
  id: number;
  handedness: 'LEFT' | 'RIGHT';
  confidence: number;
  landmarks: Landmark[];
  box: Rect;
  gesture: string | null;
  gestureScore: number;
  /** Fingertip pinch distance, normalised by hand span. */
  pinch: number;
  age: number;
}

export interface PoseTrack {
  id: number;
  landmarks: Landmark[];
  box: Rect;
  /** Torso lean from vertical, degrees. */
  lean: number;
  /** Aggregate landmark visibility 0..1. */
  quality: number;
  age: number;
}

export interface ObjectTrack {
  id: number;
  label: string;
  score: number;
  box: Rect;
  age: number;
  /** Normalised per-frame centroid velocity. */
  vx: number;
  vy: number;
}

export interface FrameState {
  t: number;
  faces: FaceTrack[];
  hands: HandTrack[];
  poses: PoseTrack[];
  objects: ObjectTrack[];
}

export const EMPTY_FRAME: FrameState = { t: 0, faces: [], hands: [], poses: [], objects: [] };

export interface ModuleStat {
  enabled: boolean;
  ready: boolean;
  /** Rolling mean inference cost, ms. */
  cost: number;
  /** Effective inferences per second for this module. */
  hz: number;
  error: string | null;
}

export interface Telemetry {
  fps: number;
  frameMs: number;
  drawMs: number;
  /** 0..3 — governor tier, 0 = full fidelity. */
  tier: number;
  budgetMs: number;
  modules: Record<ModuleId, ModuleStat>;
  resolution: string;
  backend: string;
}
