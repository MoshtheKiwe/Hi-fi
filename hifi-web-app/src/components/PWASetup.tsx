/**
 * PWASetup — mounts once, performs all PWA bootstrap tasks:
 *  1. Updates viewport for safe-area support
 *  2. Injects iOS-specific meta tags
 *  3. Generates the apple-touch-icon from a Canvas (no PNG file needed)
 *  4. Links the Web App Manifest
 *  5. Registers the Service Worker
 *  6. Unlocks AudioContext on the very first user touch (iOS requirement)
 */
import { useEffect } from 'react';
import { audioEngine } from '@/lib/audioEngine';

// ── Vinyl-record home-screen icon drawn at runtime ───────────────────────────

function makeVinylIcon(size: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2, cy = size / 2;

  // Rounded background
  const r = size * 0.167;
  ctx.fillStyle = '#1a1a1c';
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  // Vinyl disc
  ctx.fillStyle = '#161616';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.42, 0, Math.PI * 2); ctx.fill();

  // Groove rings
  [0.36, 0.30, 0.245].forEach(rf => {
    ctx.strokeStyle = '#272727'; ctx.lineWidth = size * 0.009;
    ctx.beginPath(); ctx.arc(cx, cy, size * rf, 0, Math.PI * 2); ctx.stroke();
  });

  // Centre label (wood)
  ctx.fillStyle = '#3d2508';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.165, 0, Math.PI * 2); ctx.fill();

  // Centre label (amber)
  ctx.fillStyle = '#d97706';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.12, 0, Math.PI * 2); ctx.fill();

  // Centre hole
  ctx.fillStyle = '#1a1a1c';
  ctx.beginPath(); ctx.arc(cx, cy, size * 0.03, 0, Math.PI * 2); ctx.fill();

  // Indicator triangle at 12 o'clock
  const tip = cy - size * 0.375;
  ctx.fillStyle = '#d97706';
  ctx.beginPath();
  ctx.moveTo(cx, tip);
  ctx.lineTo(cx - size * 0.035, tip + size * 0.08);
  ctx.lineTo(cx + size * 0.035, tip + size * 0.08);
  ctx.closePath();
  ctx.fill();

  return canvas.toDataURL('image/png');
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function ensureMeta(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.name = name;
    document.head.appendChild(el);
  }
  el.content = content;
}

function ensureLink(rel: string, attrs: Record<string, string>) {
  if (document.querySelector(`link[rel="${rel}"]`)) return;
  const el = document.createElement('link');
  el.rel = rel;
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
}

// ── Component ────────────────────────────────────────────────────────────────

export function PWASetup() {
  useEffect(() => {
    // 1. Viewport — must include viewport-fit=cover for iOS notch/safe-areas
    const vp = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (vp) vp.content = 'width=device-width, initial-scale=1, viewport-fit=cover';

    // 2. iOS standalone-mode meta tags
    ensureMeta('apple-mobile-web-app-capable',          'yes');
    ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
    ensureMeta('apple-mobile-web-app-title',            'Hi-Fi');
    ensureMeta('mobile-web-app-capable',                'yes');
    ensureMeta('theme-color',                           '#1a1a1c');

    // 3. Apple touch icon — generated as a canvas PNG (no PNG file required)
    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const icon = document.createElement('link');
      icon.rel  = 'apple-touch-icon';
      icon.setAttribute('sizes', '180x180');
      icon.href = makeVinylIcon(180);
      document.head.appendChild(icon);
    }

    // 4. Web App Manifest
    ensureLink('manifest', { href: '/manifest.json' });

    // 5. Service Worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => console.debug('[PWA] SW registered, scope:', reg.scope))
        .catch(err => console.warn('[PWA] SW registration failed:', err));
    }

    // 6. Audio pre-warm on first gesture
    //    - audioEngine.unlock() fires a silent play()+pause() on the HTML5
    //      Audio element so iOS grants background-audio permission before the
    //      user picks a track (async play() calls then succeed in background).
    //    - A separate silent AudioContext probe pre-warms Web Audio API for
    //      the mechanical-click sound effects in mechanicalFeedback.ts.
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;

      // Pre-warm HTML5 Audio element (music / background play)
      audioEngine.unlock();

      // Pre-warm Web Audio API (click sound effects only)
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) {
          const tmp = new AC() as AudioContext;
          const buf = tmp.createBuffer(1, 1, 22050);
          const src = tmp.createBufferSource();
          src.buffer = buf;
          src.connect(tmp.destination);
          src.start(0); src.stop(0);
          tmp.resume().then(() => tmp.close());
        }
      } catch { /* noop */ }
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('pointerdown', unlock, { once: true, passive: true });

    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('pointerdown', unlock);
    };
  }, []);

  return null;
}
