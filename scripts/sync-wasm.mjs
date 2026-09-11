/**
 * Copies the MediaPipe WASM runtime out of node_modules into public/wasm so the
 * app self-hosts its inference runtime (no third-party CDN at runtime).
 * Kept out of git: 34 MB of binary has no business in a source tree.
 */
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const to = join(root, 'public/wasm');

try {
  await stat(from);
} catch {
  console.error('[sync-wasm] @mediapipe/tasks-vision not installed; run npm install first.');
  process.exit(1);
}

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
const files = await readdir(to);
console.log(`[sync-wasm] ${files.length} runtime files -> public/wasm`);
