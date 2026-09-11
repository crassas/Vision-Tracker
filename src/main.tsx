import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

/**
 * Canvas text does not participate in CSS font loading: if the HUD's first
 * frames draw before the CJK subset is ready, the glyphs rasterise as tofu and
 * stay wrong until something forces a redraw. Warm the face up front — and never
 * let a font failure block the app.
 */
const ready =
  'fonts' in document
    ? document.fonts.load('10px "VT CJK"').catch(() => undefined)
    : Promise.resolve();

void ready.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
