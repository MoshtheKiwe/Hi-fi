import { useEffect, useRef, useState } from 'react';
import { audioEngine, type PlaybackState } from '@/lib/audioEngine';
import type { Track } from '@/lib/types';

interface Props {
  track: Track | null;
  state: PlaybackState;
  currentTime: number;
  duration: number;
  onSeek: (t: number) => void;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

/** Canvas-drawn VU meter driven by live analyser data — no React re-renders. */
function VuMeter({ playing }: { playing: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const BARS = 12;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const barW = Math.floor(W / BARS) - 1;

    const draw = () => {
      ctx2d.clearRect(0, 0, W, H);
      const freq = playing ? audioEngine.getFrequencyData() : new Uint8Array(0);
      const binPerBar = freq.length > 0 ? Math.floor(freq.length / BARS) : 0;

      for (let i = 0; i < BARS; i++) {
        let level = 0;
        if (binPerBar > 0) {
          let sum = 0;
          for (let j = i * binPerBar; j < (i + 1) * binPerBar; j++) sum += freq[j];
          level = sum / binPerBar / 255;
        }
        const barH = Math.max(1, Math.round(level * H));
        const x = i * (barW + 1);
        // Green → yellow → red gradient based on level
        const hue = level > 0.75 ? 0 : level > 0.5 ? 40 : 115;
        ctx2d.fillStyle = playing ? `hsl(${hue},100%,48%)` : '#1a2e1a';
        ctx2d.fillRect(x, H - barH, barW, barH);
        // Cap marker
        if (playing && level > 0.05) {
          ctx2d.fillStyle = `hsla(${hue},100%,70%,0.8)`;
          ctx2d.fillRect(x, H - barH - 2, barW, 2);
        }
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [playing]);

  return (
    <canvas ref={canvasRef} width={120} height={28}
      style={{ imageRendering: 'pixelated', opacity: playing ? 1 : 0.4 }} />
  );
}

export default function HiFiDisplay({ track, state, currentTime, duration, onSeek }: Props) {
  const [dragging, setDragging] = useState(false);
  const [dragVal, setDragVal] = useState(0);
  const displayTime = dragging ? dragVal : currentTime;
  const playing = state === 'playing';
  const trackName = track?.name ?? '';
  const isLong = trackName.length > 22;

  const progress = duration > 0 ? (displayTime / duration) * 100 : 0;

  return (
    <div className="hifi-display-screen rounded-lg p-3 mx-4 mb-1">
      {/* Row 1: status + VU meter */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`hifi-led-dot green${playing ? ' on' : ''}`} />
          <span className="hifi-display-phosphor text-xs tracking-widest">
            {state === 'loading' ? 'BUFFERING' : state === 'playing' ? 'PLAYING' : state === 'paused' ? 'PAUSED' : 'STANDBY'}
          </span>
        </div>
        <VuMeter playing={playing} />
      </div>

      {/* Row 2: track name (scrolling marquee if long) */}
      <div className="overflow-hidden relative h-6 mb-2">
        {track ? (
          <span className={`hifi-display-phosphor text-sm font-bold whitespace-nowrap absolute${isLong ? ' hifi-marquee' : ''}`}
            style={{ fontSize: 13 }}>
            {trackName.toUpperCase()}
          </span>
        ) : (
          <span className="hifi-display-phosphor text-xs tracking-widest opacity-30">── NO TRACK LOADED ──</span>
        )}
      </div>

      {/* Row 3: seek bar */}
      <div className="relative h-2 mb-2 rounded-full overflow-hidden" style={{ background: '#0d1f0d' }}>
        <div className="absolute left-0 top-0 h-full rounded-full transition-none"
          style={{ width: `${progress}%`, background: 'var(--hifi-phosphor)',
            boxShadow: '0 0 6px rgba(78,203,46,0.7)' }} />
        <input type="range" min={0} max={duration || 1} step={0.05} value={displayTime}
          onPointerDown={() => { setDragging(true); setDragVal(currentTime); }}
          onChange={e => setDragVal(+e.target.value)}
          onPointerUp={e => { setDragging(false); onSeek(+(e.target as HTMLInputElement).value); }}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Seek" />
      </div>

      {/* Row 4: time */}
      <div className="flex justify-between">
        <span className="hifi-display-amber" style={{ fontSize: 11 }}>{fmt(displayTime)}</span>
        <span className="hifi-display-amber opacity-50" style={{ fontSize: 11 }}>{fmt(duration)}</span>
      </div>
    </div>
  );
}
