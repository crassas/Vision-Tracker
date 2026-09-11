import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  describeError,
  listCameras,
  openCamera,
  stopStream,
  type CameraInfo,
} from './core/camera';
import {
  MODULE_GLYPH,
  MODULE_LABEL,
  TIERS,
  initialModules,
  initialTier,
  isCoarsePointer,
  prefersReducedMotion,
} from './core/config';
import { VisionEngine } from './core/engine';
import { EMPTY_FRAME, type FrameState, type ModuleId, type Telemetry } from './core/types';
import { render } from './hud/renderer';
import { Panel, type LogLine } from './ui/Panel';

const MODULES: ModuleId[] = ['face', 'hands', 'pose', 'objects'];

const BLANK_TEL: Telemetry = {
  fps: 0,
  frameMs: 0,
  drawMs: 0,
  tier: initialTier(),
  budgetMs: 0,
  modules: {
    face: { enabled: false, ready: false, cost: 0, hz: 0, error: null },
    hands: { enabled: false, ready: false, cost: 0, hz: 0, error: null },
    pose: { enabled: false, ready: false, cost: 0, hz: 0, error: null },
    objects: { enabled: false, ready: false, cost: 0, hz: 0, error: null },
  },
  resolution: '—',
  backend: 'GPU',
};

type Phase = 'idle' | 'arming' | 'live' | 'fault';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<VisionEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Latest frame/telemetry live in refs: the render loop must not re-render React. */
  const frameRef = useRef<FrameState>(EMPTY_FRAME);
  const telRef = useRef<Telemetry>(BLANK_TEL);
  const rafRef = useRef(0);

  const [phase, setPhase] = useState<Phase>('idle');
  const [fault, setFault] = useState<string | null>(null);
  const [modules, setModules] = useState<Record<ModuleId, boolean>>(() => initialModules());
  const [tel, setTel] = useState<Telemetry>(BLANK_TEL);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>(
    isCoarsePointer() ? 'low' : 'medium',
  );
  const [mirrored, setMirrored] = useState(true);
  const [labels, setLabels] = useState(!isCoarsePointer());
  const [panel, setPanel] = useState(false);
  const [auto, setAuto] = useState(true);
  const [log, setLog] = useState<LogLine[]>([]);

  const reduced = useMemo(() => prefersReducedMotion(), []);
  const compact = useMemo(() => isCoarsePointer(), []);

  const push = useCallback((text: string, level: LogLine['level'] = 'info') => {
    setLog((l) => [{ t: Date.now(), text, level }, ...l].slice(0, 60));
  }, []);

  /* ── HUD draw loop, decoupled from inference ───────────────────────────── */

  useEffect(() => {
    if (phase !== 'live') return;
    let alive = true;

    const draw = () => {
      if (!alive) return;
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const stage = stageRef.current;
      if (!canvas || !stage) return;

      const tier = TIERS[telRef.current.tier];
      const dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
      const w = Math.round(stage.clientWidth * dpr);
      const h = Math.round(stage.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const t0 = performance.now();
      // Mirroring is applied to the *data*, not the canvas transform: flipping
      // the context would flip every glyph too, and a HUD with mirrored text is
      // worthless. Geometry is reflected in normalised space; type stays upright.
      const f = frameRef.current;
      const src = mirrored ? mirrorFrame(f) : f;
      ctx.save();
      ctx.scale(dpr, dpr);
      render(ctx, stage.clientWidth, stage.clientHeight, src, telRef.current, {
        mirrored,
        tesselation: tier.tesselation,
        post: tier.post,
        labels,
        reducedMotion: reduced,
        compact,
      });
      ctx.restore();
      engineRef.current?.reportDraw(performance.now() - t0);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, mirrored, labels, reduced, compact]);

  /* ── telemetry throttled into React at 5 Hz ────────────────────────────── */

  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => {
      setTel({ ...telRef.current });
      const e = engineRef.current;
      if (e) setAuto(e.isAuto);
    }, 200);
    return () => clearInterval(id);
  }, [phase]);

  /* ── arm / disarm ──────────────────────────────────────────────────────── */

  const arm = useCallback(
    async (target?: { deviceId?: string; quality?: 'low' | 'medium' | 'high' }) => {
      setPhase('arming');
      setFault(null);
      try {
        stopStream(streamRef.current);
        const stream = await openCamera({
          deviceId: target?.deviceId ?? deviceId ?? undefined,
          quality: target?.quality ?? quality,
          facing: 'user',
        });
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const track = stream.getVideoTracks()[0];
        const s = track.getSettings();
        push(`sensor online ${s.width}×${s.height} @${s.frameRate?.toFixed(0) ?? '?'}fps`);
        setDeviceId(s.deviceId ?? null);
        setCameras(await listCameras());

        engineRef.current?.dispose();
        const engine = new VisionEngine(
          {
            onFrame: (f) => {
              frameRef.current = f;
            },
            onTelemetry: (t) => {
              telRef.current = t;
            },
            onLog: push,
          },
          modules,
          telRef.current.tier,
        );
        engineRef.current = engine;
        setPhase('live');
        await engine.start(video);
      } catch (e) {
        const msg = describeError(e);
        setFault(msg);
        setPhase('fault');
        push(msg, 'error');
      }
    },
    [deviceId, quality, modules, push],
  );

  const disarm = useCallback(() => {
    engineRef.current?.dispose();
    engineRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    frameRef.current = EMPTY_FRAME;
    setPhase('idle');
    push('system disarmed — sensor released');
  }, [push]);

  useEffect(() => () => {
    engineRef.current?.dispose();
    stopStream(streamRef.current);
  }, []);

  /* Release the camera when the tab is hidden — mandatory on phones. */
  useEffect(() => {
    const onVis = () => {
      const v = videoRef.current;
      if (!v) return;
      if (document.hidden) {
        v.pause();
        push('backgrounded — inference suspended', 'warn');
      } else if (phase === 'live') {
        v.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase, push]);

  const toggleModule = useCallback(
    (id: ModuleId) => {
      setModules((m) => {
        const next = { ...m, [id]: !m[id] };
        engineRef.current?.setModule(id, next[id]);
        return next;
      });
    },
    [],
  );

  const setTier = useCallback((i: number | 'auto') => {
    const e = engineRef.current;
    if (!e) return;
    if (i === 'auto') {
      e.setAutoTier();
      setAuto(true);
    } else {
      e.setTier(i);
      setAuto(false);
    }
  }, []);

  /* Keyboard shortcuts — desktop operators expect them. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k >= '1' && k <= '4') toggleModule(MODULES[Number(k) - 1]);
      else if (k === 'm') setMirrored((v) => !v);
      else if (k === 'l') setLabels((v) => !v);
      else if (k === 'c') setPanel((v) => !v);
      else if (k === ' ') {
        ev.preventDefault();
        phase === 'live' ? disarm() : arm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleModule, phase, arm, disarm]);

  const live = phase === 'live';

  return (
    <div className="app">
      <header className="bar">
        <div className="mark">
          VISION-TRACKER
          <small>視覚追跡装置 / MK-IV</small>
        </div>
        <div className="spacer" />
        {MODULES.map((id) => {
          const m = tel.modules[id];
          const cls = [
            'btn',
            'mod',
            modules[id] ? 'on' : '',
            modules[id] && !m.ready && !m.error ? 'loading' : '',
            m.error ? 'err' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <button
              key={id}
              className={cls}
              data-mod={id}
              onClick={() => toggleModule(id)}
              aria-pressed={modules[id]}
              title={`${MODULE_LABEL[id]} — ${m.error ?? (modules[id] ? 'active' : 'offline')}`}
            >
              <span aria-hidden>{MODULE_GLYPH[id]}</span>
              <span className="lbl">{MODULE_LABEL[id]}</span>
            </button>
          );
        })}
        <div className="rule-v" />
        <button className="btn glyph" onClick={() => setPanel((v) => !v)} aria-label="Configuration">
          ⚙
        </button>
        <button className={`btn ${live ? 'armed' : 'on'}`} onClick={() => (live ? disarm() : arm())}>
          {live ? 'DISARM' : 'ARM'}
        </button>
      </header>

      <div ref={stageRef} className={`stage ${tel.tier >= 2 ? 'no-post' : ''}`}>
        <video ref={videoRef} className={mirrored ? 'mirrored' : ''} playsInline muted autoPlay />
        <canvas ref={canvasRef} />

        {phase !== 'live' && (
          <div className="veil">
            <h1>VISION-TRACKER</h1>
            {phase === 'arming' ? (
              <>
                <p>ACQUIRING OPTICAL SENSOR — 光学センサー取得中</p>
                <div className="scan" />
              </>
            ) : (
              <>
                <p>
                  Real-time cranial, manual, skeletal and scene analysis. All inference executes
                  on-device via WebAssembly; no frame ever leaves this machine.
                </p>
                {fault && <div className="err">{fault}</div>}
                <button className="btn on" onClick={() => arm()}>
                  {fault ? 'RETRY' : 'ARM SYSTEM'}
                </button>
              </>
            )}
          </div>
        )}

        {panel && (
          <Panel
            tel={tel}
            cameras={cameras}
            deviceId={deviceId}
            quality={quality}
            mirrored={mirrored}
            labels={labels}
            auto={auto}
            log={log}
            onCamera={(id) => {
              setDeviceId(id);
              arm({ deviceId: id });
            }}
            onQuality={(q) => {
              setQuality(q);
              if (live) arm({ quality: q });
            }}
            onMirror={setMirrored}
            onLabels={setLabels}
            onTier={setTier}
            onClose={() => setPanel(false)}
          />
        )}
      </div>

      <footer className="foot">
        <Gauge label="FPS" value={tel.fps.toFixed(0)} tone={tel.fps >= 24 ? 'good' : tel.fps > 0 ? 'hot' : undefined} />
        <Gauge label="FRAME" value={`${tel.budgetMs.toFixed(1)}ms`} tone={tel.budgetMs > 26 ? 'hot' : undefined} />
        <Gauge label="INFER" value={`${tel.frameMs.toFixed(1)}ms`} />
        <Gauge label="DRAW" value={`${tel.drawMs.toFixed(1)}ms`} />
        <div className="rule-v" />
        <Gauge label="TIER" value={`${TIERS[tel.tier].name}${auto ? '·A' : ''}`} />
        <Gauge label="SENSOR" value={tel.resolution} />
        <div className="rule-v" />
        <Gauge label="顔" value={String(frameRef.current.faces.length).padStart(2, '0')} />
        <Gauge label="手" value={String(frameRef.current.hands.length).padStart(2, '0')} />
        <Gauge label="骨" value={String(frameRef.current.poses.length).padStart(2, '0')} />
        <Gauge label="物" value={String(frameRef.current.objects.length).padStart(2, '0')} />
      </footer>
    </div>
  );
}

function Gauge({ label, value, tone }: { label: string; value: string; tone?: 'hot' | 'good' }) {
  return (
    <dl className="gauge">
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </dl>
  );
}

/** Flip normalised x so the overlay matches a mirrored preview, text upright. */
function mirrorFrame(f: FrameState): FrameState {
  const fl = <T extends { x: number }>(p: T): T => ({ ...p, x: 1 - p.x });
  const fb = (b: { x: number; y: number; w: number; h: number }) => ({ ...b, x: 1 - b.x - b.w });
  return {
    t: f.t,
    faces: f.faces.map((x) => ({ ...x, landmarks: x.landmarks.map(fl), box: fb(x.box), yaw: -x.yaw, roll: -x.roll })),
    hands: f.hands.map((x) => ({ ...x, landmarks: x.landmarks.map(fl), box: fb(x.box) })),
    poses: f.poses.map((x) => ({ ...x, landmarks: x.landmarks.map(fl), box: fb(x.box), lean: -x.lean })),
    objects: f.objects.map((x) => ({ ...x, box: fb(x.box), vx: -x.vx })),
  };
}
