import { useRef, useState } from 'react';
import { mechanicalFeedback } from '@/lib/mechanicalFeedback';

interface Props {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  accentColor?: string; // override the LED accent (default amber)
}

export default function MechanicalButton({
  icon, label, onClick, isActive = false, disabled = false, accentColor,
}: Props) {
  const [pressed, setPressed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handlePointerDown = () => {
    if (disabled) return;
    setPressed(true);
    mechanicalFeedback('button');
    onClick();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setPressed(false), 120);
  };

  const ledColor = accentColor ?? '#d97706';
  const ledGlow  = accentColor ? `${accentColor}cc` : 'rgba(217,119,6,0.85)';

  return (
    <button
      className={`mechanical-btn flex flex-col items-center justify-center gap-1 select-none focus:outline-none${pressed ? ' is-active' : ''}`}
      style={{ width: 72, height: 64, borderRadius: 6, opacity: disabled ? 0.38 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}
      onPointerDown={handlePointerDown}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      disabled={disabled}
    >
      {/* Specular face highlight */}
      <div className="btn-face" />

      {/* Active indicator LED */}
      <div style={{
        width: 5, height: 5, borderRadius: '50%',
        background: isActive ? ledColor : 'rgba(0,0,0,0.6)',
        boxShadow: isActive ? `0 0 5px ${ledGlow}, 0 0 10px ${ledGlow}40` : 'inset 0 1px 2px rgba(0,0,0,0.5)',
        marginBottom: 1,
        transition: 'background 120ms, box-shadow 120ms',
      }} />

      {/* Icon */}
      <span style={{ fontSize: 18, lineHeight: 1, color: disabled ? '#555' : '#d0d0d0',
        textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>
        {icon}
      </span>

      {/* Label */}
      <span style={{ fontSize: 8, letterSpacing: '0.12em', color: '#888',
        fontFamily: "'Source Code Pro', monospace", textTransform: 'uppercase' }}>
        {label}
      </span>
    </button>
  );
}
