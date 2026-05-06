/**
 * TuningSlider — vertical vintage frequency-band tuner.
 * Station names are distributed along the scale track; a glowing amber
 * needle moves smoothly to the current station. Click or drag to tune.
 */
import { useRef } from 'react';
import type { Station } from '@/lib/types';
import { mechanicalFeedback } from '@/lib/mechanicalFeedback';

interface Props {
  stations: Station[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

const H   = 240;          // total height — matches dial SVG
const PAD = 24;           // padding above/below the usable track
const TRACK = H - PAD * 2; // 192 px of usable vertical space

/** Y pixel for station[i] within the container. */
function stationY(i: number, total: number): number {
  return total > 1 ? PAD + (i / (total - 1)) * TRACK : H / 2;
}

/** Station index from a pointer clientY and container rect. */
function indexAt(clientY: number, rect: DOMRect, total: number): number {
  const frac = (clientY - rect.top - PAD) / TRACK;
  return Math.max(0, Math.min(total - 1, Math.round(frac * (total - 1))));
}

export default function TuningSlider({ stations, selectedIndex, onSelect }: Props) {
  const divRef  = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ lastIdx: number } | null>(null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!stations.length) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const idx = indexAt(e.clientY, divRef.current!.getBoundingClientRect(), stations.length);
    dragRef.current = { lastIdx: idx };
    if (idx !== selectedIndex) { mechanicalFeedback('dial'); onSelect(idx); }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !stations.length) return;
    const idx = indexAt(e.clientY, divRef.current!.getBoundingClientRect(), stations.length);
    if (idx !== dragRef.current.lastIdx) {
      dragRef.current.lastIdx = idx;
      mechanicalFeedback('dial');
      onSelect(idx);
    }
  };

  const needleY = stationY(selectedIndex, stations.length);
  const TICK_L  = 18; // x offset of the scale track line

  return (
    <div ref={divRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      style={{
        width: 148, height: H, position: 'relative',
        cursor: 'ns-resize', userSelect: 'none', touchAction: 'none',
        overflow: 'hidden', flexShrink: 0,
        background: 'linear-gradient(180deg, #060d06 0%, #091209 50%, #060d06 100%)',
        border: '1px solid rgba(78,203,46,0.13)',
        borderRadius: 6,
        boxShadow: 'inset 0 0 28px rgba(0,0,0,0.85), inset 0 0 6px rgba(78,203,46,0.04)',
      }}>

      {/* Vertical scale track */}
      <div style={{
        position: 'absolute', left: TICK_L, top: PAD, width: 1, height: TRACK,
        background: 'rgba(78,203,46,0.18)', pointerEvents: 'none',
      }} />

      {/* 21 fine intermediate ticks — adds frequency-band texture */}
      {Array.from({ length: 21 }, (_, i) => {
        const y = PAD + (i / 20) * TRACK;
        const major = i % 5 === 0;
        return (
          <div key={i} style={{
            position: 'absolute', left: major ? TICK_L - 4 : TICK_L - 2,
            top: y, width: major ? 6 : 3, height: 1, pointerEvents: 'none',
            background: major ? 'rgba(78,203,46,0.2)' : 'rgba(78,203,46,0.1)',
          }} />
        );
      })}

      {/* Station labels */}
      {stations.map((s, i) => {
        const y      = stationY(i, stations.length);
        const active = i === selectedIndex;
        return (
          <div key={s.id} style={{
            position: 'absolute', top: y - 10, left: 0, right: 0,
            height: 20, pointerEvents: 'none',
          }}>
            {/* Station tick mark on scale */}
            <div style={{
              position: 'absolute', left: TICK_L - 5, top: 9,
              width: active ? 14 : 8, height: active ? 2 : 1,
              background: active ? 'var(--hifi-amber)' : 'rgba(78,203,46,0.3)',
              boxShadow: active ? '0 0 5px rgba(217,119,6,0.6)' : 'none',
              borderRadius: 1,
              transition: 'width 120ms ease, background 120ms ease',
            }} />
            {/* Name */}
            <span style={{
              position: 'absolute', left: TICK_L + 10, top: 3,
              fontSize: 9, lineHeight: '14px',
              fontFamily: "'Source Code Pro', monospace",
              letterSpacing: '0.07em', textTransform: 'uppercase',
              color: active ? 'var(--hifi-amber)' : 'rgba(78,203,46,0.4)',
              textShadow: active ? '0 0 7px rgba(217,119,6,0.7)' : 'none',
              maxWidth: 108, overflow: 'hidden',
              whiteSpace: 'nowrap', textOverflow: 'ellipsis',
              transition: 'color 120ms ease',
            }}>
              {s.name}
            </span>
          </div>
        );
      })}

      {/* Amber needle line */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: needleY - 1, height: 2,
        background: 'var(--hifi-amber)',
        boxShadow: '0 0 8px rgba(217,119,6,0.9), 0 0 2px rgba(255,180,0,1)',
        pointerEvents: 'none',
        transition: 'top 130ms cubic-bezier(0.25,0.1,0.25,1)',
      }} />

      {/* Needle pointer triangle — left edge */}
      <div style={{
        position: 'absolute', left: 3, top: needleY - 5,
        width: 0, height: 0,
        borderTop: '5px solid transparent',
        borderBottom: '5px solid transparent',
        borderLeft: '7px solid var(--hifi-amber)',
        pointerEvents: 'none',
        filter: 'drop-shadow(0 0 3px rgba(217,119,6,0.8))',
        transition: 'top 130ms cubic-bezier(0.25,0.1,0.25,1)',
      }} />

      {/* Empty state */}
      {stations.length === 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{
            fontSize: 8, letterSpacing: '0.2em',
            color: 'rgba(78,203,46,0.18)',
            fontFamily: "'Source Code Pro', monospace",
            transform: 'rotate(-90deg)', whiteSpace: 'nowrap',
          }}>
            NO PRESETS
          </span>
        </div>
      )}
    </div>
  );
}
