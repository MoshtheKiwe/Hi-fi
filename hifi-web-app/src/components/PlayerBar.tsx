import { useState } from 'react';
import type { Track } from '@/lib/types';
import type { PlaybackState } from '@/lib/audioEngine';

interface Props {
  track: Track | null;
  state: PlaybackState;
  currentTime: number;
  duration: number;
  volume: number;
  onPlayPause: () => void;
  onSeek: (t: number) => void;
  onVolumeChange: (v: number) => void;
}

function fmt(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, '0');
  return `${m}:${sec}`;
}

export default function PlayerBar({
  track,
  state,
  currentTime,
  duration,
  volume,
  onPlayPause,
  onSeek,
  onVolumeChange,
}: Props) {
  // Local seek-drag state so the slider doesn't jump while dragging.
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  const displayTime = dragging ? dragValue : currentTime;

  if (!track) return null;

  return (
    <div
      role="region"
      aria-label="Audio player"
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '10px 16px' }}
    >
      {/* Track name */}
      <div style={{ fontWeight: 'bold', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {state === 'loading' ? 'Loading…' : track.name}
      </div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Play / Pause */}
        <button
          onClick={onPlayPause}
          disabled={state === 'loading'}
          aria-label={state === 'playing' ? 'Pause' : 'Play'}
          style={{ fontSize: '1.2em', minWidth: 36 }}
        >
          {state === 'playing' ? '⏸' : '▶'}
        </button>

        {/* Elapsed / duration */}
        <span style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {fmt(displayTime)} / {fmt(duration)}
        </span>

        {/* Seek bar */}
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.05}
          value={displayTime}
          onMouseDown={() => { setDragging(true); setDragValue(currentTime); }}
          onTouchStart={() => { setDragging(true); setDragValue(currentTime); }}
          onChange={(e) => setDragValue(+e.target.value)}
          onMouseUp={(e) => { setDragging(false); onSeek(+(e.target as HTMLInputElement).value); }}
          onTouchEnd={(e) => { setDragging(false); onSeek(+(e.target as HTMLInputElement).value); }}
          style={{ flex: 1, minWidth: 80 }}
          aria-label="Seek"
        />

        {/* Volume */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
          🔊
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => onVolumeChange(+e.target.value)}
            style={{ width: 72 }}
            aria-label="Volume"
          />
        </label>
      </div>
    </div>
  );
}
