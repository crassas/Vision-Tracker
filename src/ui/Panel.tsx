import { MODULE_LABEL, TIERS } from '../core/config';
import type { CameraInfo } from '../core/camera';
import type { ModuleId, Telemetry } from '../core/types';

export interface LogLine {
  t: number;
  text: string;
  level: 'info' | 'warn' | 'error';
}

interface Props {
  tel: Telemetry;
  cameras: CameraInfo[];
  deviceId: string | null;
  quality: 'low' | 'medium' | 'high';
  mirrored: boolean;
  labels: boolean;
  auto: boolean;
  log: LogLine[];
  onCamera(id: string): void;
  onQuality(q: 'low' | 'medium' | 'high'): void;
  onMirror(v: boolean): void;
  onLabels(v: boolean): void;
  onTier(i: number | 'auto'): void;
  onClose(): void;
}

const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

export function Panel(p: Props) {
  return (
    <aside className="panel" aria-label="System configuration">
      <div>
        <h2>OPTICS 光学</h2>
        <div className="row">
          <span>SENSOR</span>
          <select
            value={p.deviceId ?? ''}
            onChange={(e) => p.onCamera(e.target.value)}
            aria-label="Camera device"
          >
            {p.cameras.length === 0 && <option value="">— none —</option>}
            {p.cameras.map((c, i) => (
              <option key={c.deviceId || i} value={c.deviceId}>
                {c.label.slice(0, 30)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <span>CAPTURE</span>
          <div className="seg">
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button
                key={q}
                className={p.quality === q ? 'on' : ''}
                onClick={() => p.onQuality(q)}
                aria-pressed={p.quality === q}
              >
                {q === 'low' ? '360' : q === 'medium' ? '720' : '1080'}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span>MIRROR</span>
          <div className="seg">
            <button className={p.mirrored ? 'on' : ''} onClick={() => p.onMirror(true)}>
              ON
            </button>
            <button className={!p.mirrored ? 'on' : ''} onClick={() => p.onMirror(false)}>
              OFF
            </button>
          </div>
        </div>
        <div className="row">
          <span>ANNOTATION</span>
          <div className="seg">
            <button className={p.labels ? 'on' : ''} onClick={() => p.onLabels(true)}>
              FULL
            </button>
            <button className={!p.labels ? 'on' : ''} onClick={() => p.onLabels(false)}>
              BARE
            </button>
          </div>
        </div>
      </div>

      <div>
        <h2>GOVERNOR 制御</h2>
        <div className="row">
          <span>MODE</span>
          <div className="seg">
            <button className={p.auto ? 'on' : ''} onClick={() => p.onTier('auto')}>
              AUTO
            </button>
            {TIERS.map((t, i) => (
              <button
                key={t.name}
                className={!p.auto && p.tel.tier === i ? 'on' : ''}
                onClick={() => p.onTier(i)}
                title={`${t.infer}px inference · ${(t.rate * 100).toFixed(0)}% cadence`}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span>ACTIVE TIER</span>
          <b>
            {TIERS[p.tel.tier].name} · {TIERS[p.tel.tier].infer}px
          </b>
        </div>
        <div className="row">
          <span>FRAME BUDGET</span>
          <b className={p.tel.budgetMs > 26 ? 'hot' : undefined}>{p.tel.budgetMs.toFixed(1)} ms</b>
        </div>
        <div className="row">
          <span>DELEGATE</span>
          <b>{p.tel.backend}</b>
        </div>
      </div>

      <div>
        <h2>MODULE COST 負荷</h2>
        {(Object.keys(MODULE_LABEL) as ModuleId[]).map((id) => {
          const m = p.tel.modules[id];
          return (
            <div className="row" key={id}>
              <span>{MODULE_LABEL[id]}</span>
              <b className={m.error ? 'hot' : undefined}>
                {m.error
                  ? 'FAULT'
                  : !m.enabled
                    ? '—'
                    : !m.ready
                      ? 'LOADING'
                      : `${m.cost.toFixed(1)}ms · ${m.hz.toFixed(0)}Hz`}
              </b>
            </div>
          );
        })}
      </div>

      <div>
        <h2>SYSTEM LOG 記録</h2>
        <div className="log" role="log">
          {p.log.map((l, i) => (
            <div key={i} className={l.level}>
              <time>{clock(l.t)}</time>
              {l.text}
            </div>
          ))}
        </div>
      </div>

      <button className="btn" onClick={p.onClose}>
        CLOSE 閉
      </button>
    </aside>
  );
}
