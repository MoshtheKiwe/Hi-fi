/**
 * AudioEngine — single persistent HTML5 Audio element for music playback.
 *
 * iOS BACKGROUND AUDIO RULES:
 *  1. Never set audio.src = '' — this signals "session ended" to iOS and
 *     kills background play. Just pause; the src gets replaced by load().
 *  2. Reuse the same Audio element across all tracks — iOS treats src swaps
 *     on the same element as a continuous stream, not a new session.
 *  3. A looping silent stub keeps the iOS audio session alive during the brief
 *     async gap between tracks (OPFS read + blob creation).
 *  4. Update MediaSession metadata before play(), not after.
 *
 * Sound effects (clicks) still use Web Audio API via mechanicalFeedback.ts.
 */

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused';

// ── Minimal silent WAV generator (44-byte header + 1 s of silence @ 8 kHz) ──
function makeSilentWavUrl(): string {
  const sr = 8000, ch = 1, bps = 16;
  const numSamples = sr; // 1 second
  const dataSize   = numSamples * ch * (bps / 8);
  const buf        = new ArrayBuffer(44 + dataSize);
  const v          = new DataView(buf);
  const w          = (p: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));

  w(0,  'RIFF'); v.setUint32(4,  36 + dataSize,          true);
  w(8,  'WAVE'); w(12, 'fmt ');  v.setUint32(16, 16,     true);
  v.setUint16(20, 1,  true);     v.setUint16(22, ch,     true);
  v.setUint32(24, sr, true);     v.setUint32(28, sr * ch * bps / 8, true);
  v.setUint16(32, ch * bps / 8, true); v.setUint16(34, bps, true);
  w(36, 'data'); v.setUint32(40, dataSize, true);
  // ArrayBuffer is zero-filled → silence

  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

// ─────────────────────────────────────────────────────────────────────────────

class AudioEngine {
  /** The ONE audio element used for all tracks — never replaced, src swapped. */
  private audio: HTMLAudioElement;
  /** Current track's blob URL — revoked when the next track loads. */
  private objectUrl: string | null = null;
  /** Silent looping stub that keeps the iOS audio session alive. */
  private silentEl: HTMLAudioElement | null = null;

  private rafId:    number | null = null;
  private _state:   PlaybackState = 'idle';

  // Simulated VU meter
  private vuTargets = new Float32Array(128);
  private vuLevels  = new Float32Array(128);
  private vuLastMs  = 0;

  onStateChange?: (s: PlaybackState) => void;
  onTimeUpdate?:  (currentTime: number, duration: number) => void;
  onEnded?:       () => void;
  onError?:       (e: Error) => void;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.attachListeners();
  }

  get state():       PlaybackState { return this._state; }
  get duration():    number        { return this.audio.duration || 0; }
  get currentTime(): number        { return this.audio.currentTime; }

  // ── Private ───────────────────────────────────────────────────────────────

  private setState(s: PlaybackState) {
    this._state = s;
    this.onStateChange?.(s);
  }

  private startRAF() {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this._state === 'playing') {
        this.onTimeUpdate?.(this.audio.currentTime, this.audio.duration || 0);
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRAF() {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private attachListeners() {
    const a = this.audio;

    a.addEventListener('playing', () => {
      if (this._state !== 'playing') this.setState('playing');
      this.startRAF();
    });

    // 'pause' fires on explicit pause AND system interruptions (calls, Siri)
    a.addEventListener('pause', () => {
      this.stopRAF();
      // Only update state if we were playing — 'pause' also fires during src
      // swaps while state is already 'loading', which we should ignore.
      if (this._state === 'playing') this.setState('paused');
    });

    a.addEventListener('ended', () => {
      this.stopRAF();
      this.setState('idle');
      this.onEnded?.(); // → handleNext() → playTrackAtIndex()
    });

    a.addEventListener('error', () => {
      this.stopRAF();
      if (this._state !== 'idle') {
        this.setState('idle');
        this.onError?.(new Error(a.error?.message ?? 'Audio error'));
      }
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Call once from the first user gesture.
   * Primes the audio element so iOS permits later async play() calls,
   * and starts the silent loop that keeps the audio session alive during
   * the async gap between tracks.
   */
  unlock(): void {
    // Prime the main audio element
    this.audio.play().catch(() => {}).finally(() => {
      try { this.audio.pause(); } catch {}
    });
    // Start the silent keep-alive loop
    this.startSilentLoop();
  }

  private startSilentLoop(): void {
    if (this.silentEl) return;
    const url = makeSilentWavUrl();
    const el  = new Audio(url);
    el.loop   = true;
    el.volume = 0.001; // Inaudible but not muted — keeps iOS session registered
    el.play().catch(() => {}); // Fire-and-forget
    this.silentEl = el;
  }

  /**
   * Load a track from raw bytes.
   *
   * KEY iOS RULE: We pause first but NEVER set audio.src = ''.
   * Swapping src on the same element = continuous session in iOS's eyes.
   * The old blob URL is revoked after a short delay (not immediately, so
   * the browser has time to fully adopt the new src).
   */
  async load(arrayBuffer: ArrayBuffer, mimeType: string): Promise<void> {
    this.setState('loading');
    this.stopRAF();

    // Pause current track (safe — doesn't break iOS session)
    this.audio.pause();

    const prevUrl = this.objectUrl;

    const blob = new Blob([arrayBuffer], { type: mimeType || 'audio/mpeg' });
    const url  = URL.createObjectURL(blob);
    this.objectUrl = url;

    // Swap src on the SAME element — iOS sees a continuous audio stream
    this.audio.src = url;
    this.audio.currentTime = 0;

    // Revoke old URL after browser has fully adopted the new src
    if (prevUrl) setTimeout(() => URL.revokeObjectURL(prevUrl), 1000);

    await new Promise<void>((resolve, reject) => {
      const done = () => { off(); resolve(); };
      const fail = () => { off(); reject(new Error('Audio failed to load')); };
      const off  = () => {
        this.audio.removeEventListener('canplay', done);
        this.audio.removeEventListener('error',   fail);
      };
      this.audio.addEventListener('canplay', done, { once: true });
      this.audio.addEventListener('error',   fail, { once: true });
    });
  }

  play(seekTo?: number): void {
    if (!this.objectUrl) return;
    if (seekTo !== undefined) this.audio.currentTime = seekTo;
    this.setState('playing');
    this.startRAF();
    try {
      const p = this.audio.play();
      if (p instanceof Promise) {
        p.catch(e => {
          this.stopRAF();
          this.setState('paused');
          this.onError?.(e as Error);
        });
      }
    } catch (e) {
      this.stopRAF();
      this.setState('paused');
      this.onError?.(e as Error);
    }
  }

  pause(): void {
    this.audio.pause(); // 'pause' event listener updates state
  }

  seek(time: number): void {
    const clamped = Math.max(0, Math.min(time, this.audio.duration || 0));
    this.audio.currentTime = clamped;
    this.onTimeUpdate?.(clamped, this.audio.duration || 0);
  }

  setVolume(v: number): void {
    this.audio.volume = Math.max(0, Math.min(1, v));
  }

  /**
   * Stop playback and go idle.
   *
   * IMPORTANT: We do NOT set audio.src = '' here.
   * That would signal "session ended" to iOS and kill background play.
   * The src will be overwritten naturally by the next load() call.
   */
  reset(): void {
    this.stopRAF();
    this.audio.pause();
    // ← no audio.src = '' — iOS session stays alive
    this.setState('idle');
    this.onTimeUpdate?.(0, 0);
  }

  /** Simulated frequency spectrum for the VU meter canvas. */
  getFrequencyData(): Uint8Array {
    const now = Date.now();

    if (this._state !== 'playing') {
      for (let i = 0; i < 128; i++) this.vuLevels[i] *= 0.88;
      return Uint8Array.from(this.vuLevels, v => Math.max(0, Math.round(v)));
    }

    if (now - this.vuLastMs > 90) {
      this.vuLastMs = now;
      for (let i = 0; i < 128; i++) {
        const t   = i / 128;
        const mag = t < 0.12 ? 0.85 : t < 0.35 ? 0.65 : t < 0.60 ? 0.42 : 0.22;
        this.vuTargets[i] = (Math.random() * mag + 0.08) * 255;
      }
    }

    for (let i = 0; i < 128; i++) {
      this.vuLevels[i] += (this.vuTargets[i] - this.vuLevels[i]) * 0.28;
    }
    return Uint8Array.from(this.vuLevels, v => Math.min(255, Math.max(0, Math.round(v))));
  }
}

export const audioEngine = new AudioEngine();
