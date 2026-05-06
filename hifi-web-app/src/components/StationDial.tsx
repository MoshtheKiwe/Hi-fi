import { useRef } from 'react';
import type { Station } from '@/lib/types';
import { mechanicalFeedback } from '@/lib/mechanicalFeedback';

interface Props {
  stations: Station[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

// ── Pre-computed knurling paths (72 trapezoidal notches, computed once) ──────

const CX = 120, CY = 120;
const R_KNURL_OUTER = 112, R_KNURL_INNER = 95;
const NOTCH_COUNT = 72;

const KNURL_PATHS = Array.from({ length: NOTCH_COUNT }, (_, i) => {
  const gap = 0.22;
  const span = (2 * Math.PI) / NOTCH_COUNT;
  const s = i * span + span * gap / 2 - Math.PI / 2;
  const e = s + span * (1 - gap);
  const cs = Math.cos(s), ss = Math.sin(s), ce = Math.cos(e), se = Math.sin(e);
  const x1 = CX + R_KNURL_INNER * cs, y1 = CY + R_KNURL_INNER * ss;
  const x2 = CX + R_KNURL_OUTER * cs, y2 = CY + R_KNURL_OUTER * ss;
  const x3 = CX + R_KNURL_OUTER * ce, y3 = CY + R_KNURL_OUTER * se;
  const x4 = CX + R_KNURL_INNER * ce, y4 = CY + R_KNURL_INNER * se;
  const f = (n: number) => n.toFixed(2);
  return `M${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${R_KNURL_OUTER},${R_KNURL_OUTER} 0 0,1 ${f(x3)},${f(y3)} L${f(x4)},${f(y4)} A${R_KNURL_INNER},${R_KNURL_INNER} 0 0,0 ${f(x1)},${f(y1)}Z`;
});

export default function StationDial({ stations, selectedIndex, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ startAngle: number; startIndex: number; lastIndex: number } | null>(null);

  // Visual rotation: maps 0..(n-1) to -135°..+135° like a real potentiometer
  const visualRotation = stations.length > 1
    ? (selectedIndex / (stations.length - 1)) * 270 - 135
    : 0;

  const getAngle = (cx: number, cy: number, ex: number, ey: number) =>
    Math.atan2(ey - cy, ex - cx) * 180 / Math.PI;

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startAngle: getAngle(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY),
      startIndex: selectedIndex,
      lastIndex: selectedIndex,
    };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || stations.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    let delta = getAngle(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY) - dragRef.current.startAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    const newIndex = Math.max(0, Math.min(stations.length - 1,
      dragRef.current.startIndex + Math.round(delta / (270 / (stations.length - 1)))));
    if (newIndex !== dragRef.current.lastIndex) {
      dragRef.current.lastIndex = newIndex;
      mechanicalFeedback('dial');
      onSelect(newIndex);
    }
  };

  const station = stations[selectedIndex];
  const label = station?.name ?? '— NO SIGNAL —';

  return (
    <svg ref={svgRef} width={240} height={240} viewBox="0 0 240 240"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
      style={{ cursor: 'grab', touchAction: 'none', display: 'block' }}>
      <defs>
        <radialGradient id="dShadow" cx="50%" cy="55%"><stop offset="60%" stopColor="rgba(0,0,0,0)"/><stop offset="100%" stopColor="rgba(0,0,0,0.85)"/></radialGradient>
        <radialGradient id="dFace" cx="42%" cy="36%"><stop offset="0%" stopColor="#6e6e6e"/><stop offset="55%" stopColor="#505050"/><stop offset="100%" stopColor="#303030"/></radialGradient>
        <radialGradient id="dCenter" cx="50%" cy="45%"><stop offset="0%" stopColor="#141414"/><stop offset="100%" stopColor="#080808"/></radialGradient>
        <radialGradient id="dRing" cx="48%" cy="40%"><stop offset="0%" stopColor="rgba(255,255,255,0.12)"/><stop offset="100%" stopColor="rgba(0,0,0,0.25)"/></radialGradient>
        <filter id="dGlow"><feGaussianBlur stdDeviation="2.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>

      {/* Outer ambient shadow */}
      <circle cx={CX} cy={CY} r={118} fill="url(#dShadow)" />

      {/* Rotating group — the entire dial body spins */}
      <g transform={`rotate(${visualRotation} ${CX} ${CY})`} style={{ transition: 'transform 120ms cubic-bezier(0.25,0.1,0.25,1)' }}>
        {/* Outer bevel ring */}
        <circle cx={CX} cy={CY} r={116} fill="#1e1e1e" />
        <circle cx={CX} cy={CY} r={114} fill="#2a2a2a" />

        {/* Knurling — alternating light/dark notches for texture */}
        {KNURL_PATHS.map((d, i) => (
          <path key={i} d={d} fill={i % 2 === 0 ? '#6a6a6a' : '#333333'} />
        ))}

        {/* Ring specular highlight overlay */}
        <circle cx={CX} cy={CY} r={R_KNURL_OUTER} fill="url(#dRing)" fillOpacity={0.5} />

        {/* Inner groove (dark separator ring) */}
        <circle cx={CX} cy={CY} r={R_KNURL_INNER - 1} fill="#141414" />
        <circle cx={CX} cy={CY} r={R_KNURL_INNER - 4} fill="#222222" />

        {/* Main dial face */}
        <circle cx={CX} cy={CY} r={90} fill="url(#dFace)" />

        {/* Face specular highlight */}
        <ellipse cx={CX - 18} cy={CY - 24} rx={44} ry={28} fill="rgba(255,255,255,0.06)" />

        {/* Indicator triangle at 12 o'clock */}
        <polygon points={`${CX},${CY - 84} ${CX - 5},${CY - 73} ${CX + 5},${CY - 73}`}
          fill="#d97706" filter="url(#dGlow)" />
        <line x1={CX} y1={CY - 68} x2={CX} y2={CY - 40}
          stroke="rgba(217,119,6,0.4)" strokeWidth={1.5} strokeDasharray="3,4" />
      </g>

      {/* Static center display — does not rotate */}
      <circle cx={CX} cy={CY} r={62} fill="url(#dCenter)" />
      <circle cx={CX} cy={CY} r={62} fill="none" stroke="rgba(0,0,0,0.7)" strokeWidth={4} />
      <circle cx={CX} cy={CY} r={60} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

      {/* Station name */}
      <text x={CX} y={CY + 5} textAnchor="middle" fontSize={station ? Math.min(13, 100 / Math.max(label.length, 6)) : 10}
        fill={station ? '#d97706' : '#3a3a3a'} fontFamily="'Source Code Pro', monospace" letterSpacing="0.5"
        style={{ textShadow: station ? '0 0 8px rgba(217,119,6,0.8)' : 'none' }}>
        {label.toUpperCase()}
      </text>
      <text x={CX} y={CY + 22} textAnchor="middle" fontSize={8} fill="rgba(217,119,6,0.4)"
        fontFamily="'Source Code Pro', monospace" letterSpacing="3">STATION</text>

      {/* Position dots */}
      {stations.length > 1 && Array.from({ length: Math.min(stations.length, 9) }, (_, i) => (
        <circle key={i} cx={CX - (Math.min(stations.length, 9) - 1) * 5 + i * 10} cy={CY + 40} r={3.5}
          fill={i === selectedIndex % 9 ? '#d97706' : 'rgba(217,119,6,0.18)'}
          style={{ filter: i === selectedIndex % 9 ? 'drop-shadow(0 0 3px rgba(217,119,6,0.9))' : 'none' }} />
      ))}

      {/* Invisible click target over center — tap to advance to next station */}
      <circle cx={CX} cy={CY} r={60} fill="transparent" style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          if (!stations.length) return;
          mechanicalFeedback('dial');
          onSelect((selectedIndex + 1) % stations.length);
        }} />
    </svg>
  );
}
