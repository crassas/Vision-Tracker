# VISION-TRACKER / 視覚追跡装置

Real-time **cranial, manual, skeletal and scene** analysis in the browser, presented as a
sci-fi instrumentation HUD. Every frame is processed on-device by WebAssembly — nothing
is uploaded, and there is no API key, no account and no server component.

Built entirely from free and open-source parts.

---

## What it actually does

| Module | Glyph | Model | Read-out |
|---|---|---|---|
| **CRANIAL** | 顔 | MediaPipe Face Landmarker | 478-point mesh, iris fixation, head yaw/pitch/roll from the facial transform matrix, 52 expression blendshapes, eyelid aperture (blink) |
| **MANUAL** | 手 | MediaPipe Gesture Recognizer | 21-point hand graph ×2, handedness, 8 canonical gestures, continuous pinch metric |
| **SKELETAL** | 骨 | MediaPipe Pose Landmarker | 33-point body graph ×2, spine axis, torso lean, per-landmark visibility quality |
| **SCENE** | 物 | EfficientDet-Lite0 | 80-class COCO object detection with persistent identity and motion vectors |

Modules are independent: enable only what you need, and a disabled module is fully
released from memory rather than merely skipped.

## Design decisions that matter

These are the parts that separate this from a landmark-dumping demo.

**One Euro filtering, not exponential smoothing.** Raw MediaPipe landmarks jitter visibly
at rest. A plain EMA fixes that but introduces lag on fast motion. The
[One Euro filter](https://gery.casiez.net/1euro/) (Casiez et al., CHI 2012) adapts its
cutoff frequency to observed speed, so the overlay is dead-still on a held pose and still
snaps to a fast gesture. Implemented in `src/core/math.ts`.

**Real identity, not frame-by-frame detection.** MediaPipe returns unordered detections
with no identity. `src/core/trackers.ts` performs greedy IoU assignment against the previous
frame, so a subject keeps its ID and accumulates an age. Tracks *coast* for a few frames
after a lost detection instead of blinking out, and object tracks are dead-reckoned by their
velocity between the (deliberately infrequent) detector passes.

**Independent cadences per module.** Face and hands must feel immediate; object detection is
expensive and semantically slow-moving, so it runs at ~6 Hz while its boxes are carried
between inferences by the tracker. Passes are phase-offset so two expensive inferences never
land on the same frame.

**Inference resolution is decoupled from display resolution.** The models read from an
offscreen downscale (360–720 px long edge, per tier); the HUD always draws at full display
resolution. Feeding a 1080p frame to a 192×192 model just burns battery.

**Data-space mirroring.** The selfie view is mirrored, but flipping the canvas transform
would flip every glyph too. Geometry is reflected in normalised coordinates instead, so
labels stay readable — see `mirrorFrame()` in `src/App.tsx`.

**Draw loop decoupled from React.** Tracking state lives in refs and is drawn on
`requestAnimationFrame`; React re-renders only for telemetry at 5 Hz. The HUD never
triggers a reconciliation.

## Mobile

The brief was *same quality and control on a phone, without cooking the phone*. Phones get
the identical HUD and every control — the difference is compute, not capability.

- **Adaptive governor** (`src/core/engine.ts`) watches real wall-clock frame time and moves
  between four tiers — `FULL / HIGH / ECON / SURV` — scaling inference cadence, inference
  resolution, mesh tesselation, post-processing and canvas DPR. It has hysteresis and a
  cooldown so it settles rather than oscillating, and it can be pinned manually.
- **Phones start conservative** (`ECON`, 360p capture, object detection off) and are only
  promoted once the governor has evidence of headroom. Starting high and dropping shows the
  user a stutter first and wastes battery.
- Canvas DPR is capped per tier — a 3× DPR phone screen does not need a 3× HUD.
- Camera is released when the tab is backgrounded.
- Layout respects `env(safe-area-inset-*)` for notches/home indicators, uses `100dvh`, and
  collapses chrome in landscape. Touch targets are ≥38 px.
- `prefers-reduced-motion` disables HUD pulsing and CSS animation.

## Aesthetic

The palette (`src/core/palette.ts`) is deliberately **not** the default neon sci-fi set —
no `#00FFFF`, no `#00FF00`, no `#FF0000`. It is drawn from analogue optics: sodium-vapour
amber, unbleached film base, oxidised copper, faded indigo ink, cold pewter, burnt oxide,
on a bituminous green-black ground. Each module owns a signature colour so every overlay is
instantly attributable.

The drawing vocabulary (`src/hud/primitives.ts`) is bracket corners, tick rules, elbowed
leader lines, hairlines and monospaced type — instrumentation, not decoration. No rounded
boxes, no drop shadows, no gradient fills.

## Running it

```bash
npm install      # also syncs the WASM runtime into public/wasm
npm run dev      # http://localhost:5173
npm test         # 19 unit tests over the filtering/geometry/tracking logic
npm run build    # typecheck + production bundle into dist/
```

Camera access requires a **secure context**: `localhost` or HTTPS.

## Deploying to Cloudflare Pages

```bash
npm run build
npx wrangler pages deploy dist --project-name vision-tracker
```

`public/_headers` sets `Permissions-Policy: camera=(self)`, immutable caching for the WASM
runtime and hashed assets, and conservative defaults elsewhere. `wrangler.toml` declares the
build output directory. It is a fully static deploy — there is no backend to run.

### A note on cross-origin isolation

The app intentionally does **not** send `COOP`/`COEP`. Cross-origin isolation would unlock
SharedArrayBuffer threading, but Safari does not implement `COEP: credentialless`, so on iOS
it would instead block the cross-origin model fetch and break the app outright. The
single-threaded SIMD runtime plus the governor is the better trade for mobile parity.

### Model hosting

The ~14 MB WASM runtime is **self-hosted** from `/wasm` (copied out of `node_modules` by
`scripts/sync-wasm.mjs`; it is gitignored rather than committed). Model weights are fetched
from Google's public MediaPipe bucket, which serves the Apache-2.0 bundles. To self-host them
too — e.g. on Cloudflare R2 — mirror the same paths and set:

```bash
VITE_MODEL_BASE=https://models.example.com
```

That is the only network access the app makes at runtime.

## Controls

| Key | Action |
|---|---|
| `1` `2` `3` `4` | Toggle cranial / manual / skeletal / scene |
| `Space` | Arm / disarm the sensor |
| `M` | Mirror |
| `L` | Full or bare annotation |
| `C` | Configuration panel |

## Layout

```
src/
  core/
    palette.ts    chromatic system — the single source of colour
    types.ts      track and telemetry shapes
    math.ts       One Euro filter, geometry, IoU assignment, Euler decomposition
    config.ts     model URLs, governor tiers, per-module cadence, device heuristics
    camera.ts     acquisition, enumeration, human-readable failure modes
    trackers.ts   identity assignment, smoothing, coasting, derived metrics
    engine.ts     task lifecycle, scheduler, adaptive governor
  hud/
    primitives.ts brackets, leaders, plates, meters, reticles
    renderer.ts   the HUD itself — a pure function of state
  ui/Panel.tsx    configuration surface and system log
  App.tsx         shell, draw loop, camera and keyboard wiring
test/core.test.ts headless verification of the pure logic
```

## Licence & credits

MIT. Uses [MediaPipe Tasks](https://ai.google.dev/edge/mediapipe) (Apache-2.0),
[React](https://react.dev) and [Vite](https://vite.dev) (MIT). No proprietary services.
