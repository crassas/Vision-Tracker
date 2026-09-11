import type { ModuleId } from './types';

/**
 * Model weights are fetched from Google's public MediaPipe model bucket, which
 * serves the Apache-2.0 licensed .task/.tflite bundles. Override the base with
 * VITE_MODEL_BASE to self-host them (e.g. behind Cloudflare R2) — nothing else
 * in the app touches the network at runtime.
 */
const MODEL_BASE =
  (import.meta.env.VITE_MODEL_BASE as string | undefined)?.replace(/\/$/, '') ??
  'https://storage.googleapis.com/mediapipe-models';

/** The WASM runtime is always self-hosted from /wasm (see scripts/sync-wasm.mjs). */
export const WASM_BASE = `${import.meta.env.BASE_URL}wasm`.replace(/\/\/+$/, '/wasm');

export const MODEL_URL: Record<ModuleId, string> = {
  face: `${MODEL_BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
  hands: `${MODEL_BASE}/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
  pose: `${MODEL_BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
  objects: `${MODEL_BASE}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`,
};

export const MODULE_LABEL: Record<ModuleId, string> = {
  face: 'CRANIAL',
  hands: 'MANUAL',
  pose: 'SKELETAL',
  objects: 'SCENE',
};

export const MODULE_GLYPH: Record<ModuleId, string> = {
  face: '顔',
  hands: '手',
  pose: '骨',
  objects: '物',
};

/**
 * Per-module baseline cadence in Hz at tier 0. Face and hands must feel
 * immediate; object detection is expensive and semantically slow-moving, so it
 * runs far below frame rate and its boxes are carried by the tracker between
 * inferences.
 */
export const BASE_HZ: Record<ModuleId, number> = {
  face: 60,
  hands: 60,
  pose: 30,
  objects: 6,
};

/** Governor tiers. Each scales cadence and drawing detail, never layout. */
export interface Tier {
  name: string;
  /** Multiplier applied to BASE_HZ. */
  rate: number;
  /** Longest edge of the inference frame, px. */
  infer: number;
  /** Draw the 468-point face tesselation, or just the contours. */
  tesselation: boolean;
  /** Bloom / scanline post-processing on the HUD layer. */
  post: boolean;
  /** Device-pixel-ratio ceiling for the overlay canvas. */
  dpr: number;
}

export const TIERS: Tier[] = [
  { name: 'FULL', rate: 1.0, infer: 720, tesselation: true, post: true, dpr: 2 },
  { name: 'HIGH', rate: 0.75, infer: 540, tesselation: true, post: true, dpr: 1.75 },
  { name: 'ECON', rate: 0.5, infer: 480, tesselation: false, post: false, dpr: 1.5 },
  { name: 'SURV', rate: 0.3, infer: 360, tesselation: false, post: false, dpr: 1 },
];

export const isCoarsePointer = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const isSmallViewport = () =>
  typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 720;

export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Initial tier guess. A phone starts at ECON and is allowed to climb once the
 * governor has evidence it can afford more — the reverse (starting FULL and
 * dropping) burns battery and shows the user a stutter first.
 */
export function initialTier(): number {
  if (typeof navigator === 'undefined') return 0;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (isCoarsePointer() && (cores <= 6 || mem <= 4)) return 2;
  if (isCoarsePointer()) return 1;
  if (cores <= 4 || mem <= 4) return 1;
  return 0;
}

/** Default module set — objects off on phones until the user asks for it. */
export function initialModules(): Record<ModuleId, boolean> {
  const light = isCoarsePointer();
  return { face: true, hands: true, pose: !light, objects: false };
}
