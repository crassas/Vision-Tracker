/**
 * Camera acquisition. Mobile-aware: requests a resolution appropriate to the
 * device rather than demanding 1080p from a phone and then throwing most of the
 * pixels away, which is the usual cause of thermal throttling in browser CV.
 */
export interface CameraInfo {
  deviceId: string;
  label: string;
  facing: 'user' | 'environment' | 'unknown';
}

export interface CameraTarget {
  deviceId?: string;
  facing?: 'user' | 'environment';
  /** Requested long edge; the browser will pick the nearest supported mode. */
  quality?: 'low' | 'medium' | 'high';
}

const SIZES = {
  low: { width: 640, height: 360 },
  medium: { width: 1280, height: 720 },
  high: { width: 1920, height: 1080 },
} as const;

export async function listCameras(): Promise<CameraInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => {
      const l = d.label || `CAMERA ${i + 1}`;
      const lower = l.toLowerCase();
      const facing: CameraInfo['facing'] = lower.includes('back') || lower.includes('rear') || lower.includes('environment')
        ? 'environment'
        : lower.includes('front') || lower.includes('user') || lower.includes('face')
          ? 'user'
          : 'unknown';
      return { deviceId: d.deviceId, label: l, facing };
    });
}

export async function openCamera(target: CameraTarget = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia unavailable — a secure context (HTTPS) is required.');
  }
  const size = SIZES[target.quality ?? 'medium'];
  const video: MediaTrackConstraints = {
    width: { ideal: size.width },
    height: { ideal: size.height },
    frameRate: { ideal: 30, max: 60 },
  };
  if (target.deviceId) video.deviceId = { exact: target.deviceId };
  else if (target.facing) video.facingMode = { ideal: target.facing };

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    // Exact device constraints fail often on mobile after an orientation change
    // or when another tab holds the camera; degrade rather than dying.
    if (target.deviceId) return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    throw e;
  }
}

export function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  switch (e.name) {
    case 'NotAllowedError':
      return 'CAMERA PERMISSION DENIED — grant access in the browser address bar, then re-arm.';
    case 'NotFoundError':
      return 'NO CAMERA DETECTED on this device.';
    case 'NotReadableError':
      return 'CAMERA BUSY — another application or tab is holding the sensor.';
    case 'OverconstrainedError':
      return 'REQUESTED MODE UNSUPPORTED — falling back to default sensor mode.';
    case 'SecurityError':
      return 'INSECURE CONTEXT — HTTPS is required for camera access.';
    default:
      return e.message.toUpperCase();
  }
}

export function stopStream(s: MediaStream | null): void {
  s?.getTracks().forEach((t) => t.stop());
}
