import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // The sandbox preview is proxied under an *.e2b.app hostname.
    allowedHosts: true,
    // Deliberately NO COOP/COEP. Cross-origin isolation would buy SharedArrayBuffer
    // threading, but Safari does not implement COEP: credentialless, so on iOS it
    // would instead block the cross-origin model fetch and break the app entirely.
    // The single-threaded SIMD runtime is fast enough under the governor.
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          mediapipe: ['@mediapipe/tasks-vision'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
