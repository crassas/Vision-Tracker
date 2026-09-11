/**
 * Installs a synthetic camera over navigator.mediaDevices, backed by an animated
 * canvas. Used only by the screenshot harness: this Chromium build ships no
 * --use-fake-device video capture, and the sandbox has no real camera.
 */
(() => {
  const W = 1280, H = 720;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');

  let t = 0;
  (function tick() {
    t += 1 / 30;
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#23302c'); g.addColorStop(1, '#0e1413');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // Backdrop rails, so motion is visible in a still frame.
    x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      x.beginPath(); x.moveTo((i * 140 + t * 18) % (W + 140) - 70, 0);
      x.lineTo((i * 140 + t * 18) % (W + 140) - 70, H); x.stroke();
    }
    // A head-and-shoulders figure.
    const cx = W / 2 + Math.sin(t * 0.6) * 90, cy = H * 0.42 + Math.sin(t * 0.9) * 18;
    x.fillStyle = '#c8a887';
    x.beginPath(); x.ellipse(cx, cy, 105, 138, 0, 0, 7); x.fill();
    x.fillStyle = '#2b2320';
    x.beginPath(); x.ellipse(cx, cy - 118, 112, 62, 0, 0, 7); x.fill();
    const blink = Math.sin(t * 2.1) > 0.93 ? 0.12 : 1;
    for (const s of [-1, 1]) {
      x.fillStyle = '#fdfdfd';
      x.beginPath(); x.ellipse(cx + s * 40, cy - 26, 22, 12 * blink, 0, 0, 7); x.fill();
      x.fillStyle = '#3b2b1e';
      x.beginPath(); x.ellipse(cx + s * 40 + Math.sin(t) * 5, cy - 26, 9 * blink, 9 * blink, 0, 0, 7); x.fill();
    }
    x.strokeStyle = '#8d6a52'; x.lineWidth = 6; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx, cy - 10); x.lineTo(cx - 8, cy + 30); x.lineTo(cx + 10, cy + 34); x.stroke();
    x.fillStyle = '#7a4436';
    x.beginPath(); x.ellipse(cx, cy + 74, 40, 17 + Math.sin(t * 1.7) * 7, 0, 0, 7); x.fill();
    x.fillStyle = '#33413d';
    x.beginPath(); x.moveTo(cx - 250, H); x.quadraticCurveTo(cx, H - 250, cx + 250, H); x.fill();
    requestAnimationFrame(tick);
  })();

  const stream = c.captureStream(30);
  const dev = { deviceId: 'vt-synthetic', groupId: 'vt', kind: 'videoinput', label: 'VT SYNTHETIC OPTIC' };
  const md = navigator.mediaDevices ?? {};
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: Object.assign(Object.create(Object.getPrototypeOf(md) || Object.prototype), md, {
      getUserMedia: async () => stream.clone(),
      enumerateDevices: async () => [{ ...dev, toJSON: () => dev }],
      getSupportedConstraints: () => ({ width: true, height: true, facingMode: true }),
      addEventListener() {}, removeEventListener() {},
    }),
  });
})();
