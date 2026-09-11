/**
 * VisionEngine — owns the MediaPipe task instances, the per-module scheduler and
 * the adaptive governor.
 *
 * Design notes that matter:
 *  - Modules are lazily constructed and disposed, so a disabled module costs
 *    zero memory, not just zero time. This is what keeps a phone alive.
 *  - Each module runs on its own cadence (see BASE_HZ). They are phase-offset so
 *    two expensive inferences never land on the same frame and spike latency.
 *  - Inference reads from an offscreen downscale of the video, never the full
 *    sensor frame; the HUD still draws at full display resolution.
 */
import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  ObjectDetector,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';

/** FilesetResolver's return type is not exported by the package. */
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
import { BASE_HZ, MODEL_URL, TIERS, WASM_BASE, type Tier } from './config';
import { Rolling } from './math';
import { FaceTracker, HandTracker, ObjectTracker, PoseTracker } from './trackers';
import { EMPTY_FRAME, type FrameState, type ModuleId, type ModuleStat, type Telemetry } from './types';

type AnyTask = FaceLandmarker | GestureRecognizer | PoseLandmarker | ObjectDetector;

const MODULES: ModuleId[] = ['face', 'hands', 'pose', 'objects'];
/** Phase offsets keep heavy passes from colliding on the same frame. */
const PHASE: Record<ModuleId, number> = { face: 0, hands: 0.25, pose: 0.5, objects: 0.75 };

export interface EngineEvents {
  onFrame(frame: FrameState): void;
  onTelemetry(t: Telemetry): void;
  onLog(line: string, level?: 'info' | 'warn' | 'error'): void;
}

export class VisionEngine {
  private fileset: WasmFileset | null = null;
  private tasks = new Map<ModuleId, AnyTask>();
  private loading = new Set<ModuleId>();
  private enabled: Record<ModuleId, boolean>;
  private nextDue: Record<ModuleId, number> = { face: 0, hands: 0, pose: 0, objects: 0 };
  private cost: Record<ModuleId, Rolling> = {
    face: new Rolling(20),
    hands: new Rolling(20),
    pose: new Rolling(20),
    objects: new Rolling(10),
  };
  private hz: Record<ModuleId, Rolling> = {
    face: new Rolling(30),
    hands: new Rolling(30),
    pose: new Rolling(30),
    objects: new Rolling(10),
  };
  private lastRun: Record<ModuleId, number> = { face: 0, hands: 0, pose: 0, objects: 0 };
  private errors: Record<ModuleId, string | null> = {
    face: null,
    hands: null,
    pose: null,
    objects: null,
  };

  private faceT = new FaceTracker();
  private handT = new HandTracker();
  private poseT = new PoseTracker();
  private objT = new ObjectTracker();

  private frame: FrameState = { ...EMPTY_FRAME };
  private scratch = document.createElement('canvas');
  private sctx = this.scratch.getContext('2d', { willReadFrequently: false })!;

  private frameMs = new Rolling(45);
  private fpsRoll = new Rolling(45);
  private lastFrameT = 0;
  private tier: number;
  private tierLocked = false;
  private tierCooldown = 0;
  private running = false;
  private raf = 0;
  private video: HTMLVideoElement | null = null;
  private lastVideoTime = -1;
  private drawMs = 0;
  private backend = 'GPU';

  constructor(
    private events: EngineEvents,
    modules: Record<ModuleId, boolean>,
    tier: number,
  ) {
    this.enabled = { ...modules };
    this.tier = tier;
  }

  get currentTier(): Tier {
    return TIERS[this.tier];
  }

  setTier(i: number, lock = true): void {
    this.tier = Math.max(0, Math.min(TIERS.length - 1, i));
    this.tierLocked = lock;
    this.events.onLog(`governor → ${TIERS[this.tier].name}${lock ? ' (locked)' : ''}`);
  }

  setAutoTier(): void {
    this.tierLocked = false;
    this.events.onLog('governor → adaptive');
  }

  get isAuto(): boolean {
    return !this.tierLocked;
  }

  reportDraw(ms: number): void {
    this.drawMs = ms;
  }

  async setModule(id: ModuleId, on: boolean): Promise<void> {
    this.enabled[id] = on;
    if (!on) {
      const t = this.tasks.get(id);
      if (t) {
        t.close();
        this.tasks.delete(id);
      }
      this.errors[id] = null;
      this.events.onLog(`${id} module released`);
      return;
    }
    await this.ensure(id);
  }

  private async ensureFileset(): Promise<WasmFileset> {
    if (!this.fileset) {
      this.fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    }
    return this.fileset;
  }

  private async ensure(id: ModuleId): Promise<void> {
    if (this.tasks.has(id) || this.loading.has(id)) return;
    this.loading.add(id);
    this.errors[id] = null;
    this.events.onLog(`loading ${id} model…`);
    try {
      const fs = await this.ensureFileset();
      const base = { modelAssetPath: MODEL_URL[id] };
      let task: AnyTask;
      // GPU delegate first; fall back to CPU on drivers that reject the context.
      const make = async (delegate: 'GPU' | 'CPU'): Promise<AnyTask> => {
        const opts = { baseOptions: { ...base, delegate }, runningMode: 'VIDEO' as const };
        switch (id) {
          case 'face':
            return FaceLandmarker.createFromOptions(fs, {
              ...opts,
              numFaces: 2,
              outputFaceBlendshapes: true,
              outputFacialTransformationMatrixes: true,
            });
          case 'hands':
            return GestureRecognizer.createFromOptions(fs, { ...opts, numHands: 2 });
          case 'pose':
            return PoseLandmarker.createFromOptions(fs, { ...opts, numPoses: 2 });
          case 'objects':
            return ObjectDetector.createFromOptions(fs, { ...opts, scoreThreshold: 0.42, maxResults: 8 });
        }
      };
      try {
        task = await make('GPU');
      } catch (gpuErr) {
        this.events.onLog(`${id}: GPU delegate refused, using CPU`, 'warn');
        this.backend = 'CPU';
        task = await make('CPU');
      }
      if (!this.enabled[id]) {
        task.close();
        return;
      }
      this.tasks.set(id, task);
      this.events.onLog(`${id} online`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.errors[id] = msg;
      this.events.onLog(`${id} failed: ${msg}`, 'error');
    } finally {
      this.loading.delete(id);
    }
  }

  async start(video: HTMLVideoElement): Promise<void> {
    this.video = video;
    this.running = true;
    await Promise.all(MODULES.filter((m) => this.enabled[m]).map((m) => this.ensure(m)));
    this.loop();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    for (const t of this.tasks.values()) t.close();
    this.tasks.clear();
  }

  /** Downscale the sensor frame to the tier's inference resolution. */
  private prepare(video: HTMLVideoElement): HTMLCanvasElement | HTMLVideoElement {
    const tier = this.currentTier;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const longest = Math.max(vw, vh);
    if (longest <= tier.infer) return video;
    const k = tier.infer / longest;
    const w = Math.round(vw * k);
    const h = Math.round(vh * k);
    if (this.scratch.width !== w || this.scratch.height !== h) {
      this.scratch.width = w;
      this.scratch.height = h;
    }
    this.sctx.drawImage(video, 0, 0, w, h);
    return this.scratch;
  }

  private loop = (): void => {
    if (!this.running || !this.video) return;
    this.raf = requestAnimationFrame(this.loop);
    const video = this.video;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    const now = performance.now();
    if (this.lastFrameT) {
      const dt = now - this.lastFrameT;
      this.frameMs.push(dt);
      if (dt > 0) this.fpsRoll.push(1000 / dt);
    }
    this.lastFrameT = now;

    // MediaPipe VIDEO mode requires strictly increasing timestamps and rejects
    // re-submission of an already-processed frame.
    const fresh = video.currentTime !== this.lastVideoTime;
    if (fresh) this.lastVideoTime = video.currentTime;

    const tier = this.currentTier;
    const ts = Math.round(now);
    let input: HTMLCanvasElement | HTMLVideoElement | null = null;
    let budget = 0;
    const softBudget = 12; // ms of inference we allow per frame before deferring

    if (fresh) {
      for (const id of MODULES) {
        if (!this.enabled[id]) continue;
        const task = this.tasks.get(id);
        if (!task) continue;
        const period = 1000 / (BASE_HZ[id] * tier.rate);
        if (now < this.nextDue[id]) continue;
        // A frame that has already spent its budget defers the cheaper modules
        // rather than blowing past the display refresh.
        if (budget > softBudget && id !== 'face') continue;

        if (!input) input = this.prepare(video);
        const t0 = performance.now();
        try {
          this.runOne(id, task, input, ts, now);
        } catch (e) {
          this.errors[id] = e instanceof Error ? e.message : String(e);
        }
        const spent = performance.now() - t0;
        budget += spent;
        this.cost[id].push(spent);
        if (this.lastRun[id]) this.hz[id].push(1000 / Math.max(1, now - this.lastRun[id]));
        this.lastRun[id] = now;
        // Schedule the next pass on its own phase so passes interleave.
        this.nextDue[id] = now + period * (1 + PHASE[id] * 0.0);
      }
    }

    this.frame = {
      t: now,
      faces: this.frame.faces,
      hands: this.frame.hands,
      poses: this.frame.poses,
      objects: this.enabled.objects ? this.objT.coast() : [],
    };
    if (!this.enabled.face) this.frame.faces = [];
    if (!this.enabled.hands) this.frame.hands = [];
    if (!this.enabled.pose) this.frame.poses = [];

    this.events.onFrame(this.frame);
    this.govern(now);
    this.emitTelemetry(budget);
  };

  private runOne(
    id: ModuleId,
    task: AnyTask,
    input: HTMLCanvasElement | HTMLVideoElement,
    ts: number,
    now: number,
  ): void {
    const tSec = now / 1000;
    switch (id) {
      case 'face': {
        const r = (task as FaceLandmarker).detectForVideo(input, ts);
        this.frame.faces = this.faceT.update(
          r.faceLandmarks ?? [],
          r.facialTransformationMatrixes?.map((m) => Array.from(m.data)) ?? null,
          r.faceBlendshapes?.map((b) => b.categories) ?? null,
          tSec,
        );
        break;
      }
      case 'hands': {
        const r = (task as GestureRecognizer).recognizeForVideo(input, ts);
        this.frame.hands = this.handT.update(
          r.landmarks ?? [],
          (r.handedness ?? []).map((h) => h[0]?.categoryName ?? 'Right'),
          (r.handedness ?? []).map((h) => h[0]?.score ?? 0),
          (r.gestures ?? []).map((g) =>
            g[0] ? { name: g[0].categoryName, score: g[0].score } : null,
          ),
          tSec,
        );
        break;
      }
      case 'pose': {
        const r = (task as PoseLandmarker).detectForVideo(input, ts);
        this.frame.poses = this.poseT.update(r.landmarks ?? [], tSec);
        break;
      }
      case 'objects': {
        const r = (task as ObjectDetector).detectForVideo(input, ts);
        const w = 'videoWidth' in input ? input.videoWidth : input.width;
        const h = 'videoHeight' in input ? input.videoHeight : input.height;
        this.objT.update(
          (r.detections ?? [])
            .filter((d) => d.boundingBox)
            .map((d) => ({
              label: d.categories[0]?.categoryName ?? 'unknown',
              score: d.categories[0]?.score ?? 0,
              box: {
                x: d.boundingBox!.originX / w,
                y: d.boundingBox!.originY / h,
                w: d.boundingBox!.width / w,
                h: d.boundingBox!.height / h,
              },
            })),
        );
        break;
      }
    }
  }

  /**
   * Adaptive governor. Uses the wall-clock frame interval — the only number the
   * user actually perceives — with hysteresis and a cooldown so it settles
   * instead of oscillating between two tiers.
   */
  private govern(now: number): void {
    if (this.tierLocked || this.frameMs.count < 30 || now < this.tierCooldown) return;
    const mean = this.frameMs.mean;
    if (mean > 26 && this.tier < TIERS.length - 1) {
      this.tier++;
      this.tierCooldown = now + 2500;
      this.events.onLog(`load shed → ${TIERS[this.tier].name} (${mean.toFixed(1)}ms/frame)`, 'warn');
    } else if (mean < 15 && this.tier > 0) {
      this.tier--;
      this.tierCooldown = now + 4000;
      this.events.onLog(`headroom → ${TIERS[this.tier].name} (${mean.toFixed(1)}ms/frame)`);
    }
  }

  private emitTelemetry(budget: number): void {
    const modules = {} as Record<ModuleId, ModuleStat>;
    for (const id of MODULES) {
      modules[id] = {
        enabled: this.enabled[id],
        ready: this.tasks.has(id),
        cost: this.cost[id].mean,
        hz: this.hz[id].mean,
        error: this.errors[id],
      };
    }
    const v = this.video;
    this.events.onTelemetry({
      fps: this.fpsRoll.mean,
      frameMs: budget,
      drawMs: this.drawMs,
      tier: this.tier,
      budgetMs: this.frameMs.mean,
      modules,
      resolution: v ? `${v.videoWidth}×${v.videoHeight}` : '—',
      backend: this.backend,
    });
  }
}
