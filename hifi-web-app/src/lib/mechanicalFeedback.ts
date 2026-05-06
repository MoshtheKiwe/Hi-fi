/**
 * mechanicalFeedback — synthesizes a physical click via Web Audio API
 * (bandpass-filtered white noise burst) and fires a haptic pulse.
 */

let _ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_ctx || _ctx.state === 'closed') _ctx = new AudioContext();
  return _ctx;
}

export function playMechanicalClick(type: 'button' | 'dial' = 'button'): void {
  try {
    const ctx = getCtx();
    if (ctx.state === 'suspended') ctx.resume();

    const ms        = type === 'button' ? 72  : 26;
    const decayRate = type === 'button' ? 46  : 145;
    const filterHz  = type === 'button' ? 820 : 2300;
    const gainVal   = type === 'button' ? 0.52 : 0.30;

    const n    = Math.floor(ctx.sampleRate * ms / 1000);
    const buf  = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / ctx.sampleRate * decayRate);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = filterHz;
    bpf.Q.value = 0.75;

    const gain = ctx.createGain();
    gain.gain.value = gainVal;

    src.connect(bpf);
    bpf.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  } catch { /* never crash the UI */ }
}

export function hapticPulse(ms = 15): void {
  try {
    const nav = navigator as unknown as { vibrate?: (ms: number) => boolean };
    nav.vibrate?.(ms);
  } catch { /* noop */ }
}

/** Play click sound + trigger haptic pulse together. */
export function mechanicalFeedback(type: 'button' | 'dial' = 'button'): void {
  playMechanicalClick(type);
  hapticPulse(type === 'button' ? 18 : 8);
}
