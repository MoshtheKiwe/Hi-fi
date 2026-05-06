/**
 * app.js — Single-file Vanilla JS logic for Vintage Hi-Fi
 */

// ── 1. Mechanical Feedback (UI Clicks) ──────────────────────────────
const actx = new (window.AudioContext || window.webkitAudioContext)();
function mechanicalFeedback(type) {
  if (actx.state === 'suspended') actx.resume();
  const osc = actx.createOscillator();
  const gain = actx.createGain();
  const filter = actx.createBiquadFilter();

  osc.connect(filter); filter.connect(gain); gain.connect(actx.destination);
  const t = actx.currentTime;

  if (type === 'button') {
    osc.type = 'square';
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(800, t + 0.02);
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.03);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.5, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.start(t); osc.stop(t + 0.05);
  } else if (type === 'dial') {
    osc.type = 'triangle';
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(1200, t);
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(100, t + 0.02);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.15, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.start(t); osc.stop(t + 0.04);
  }
}

// ── 2. OPFS Worker (Inlined) ──────────────────────────────────────────
const opfsWorkerCode = `
async function readJson(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch { return null; }
}
async function writeBytes(dir, name, bytes) {
  const fh = await dir.getFileHandle(name, { create: true });
  const access = await fh.createSyncAccessHandle();
  try {
    access.write(bytes, { at: 0 });
    access.truncate(bytes.byteLength);
    access.flush();
  } finally { access.close(); }
}
async function writeJson(dir, name, data) {
  await writeBytes(dir, name, new TextEncoder().encode(JSON.stringify(data)));
}
async function getRoot() { return navigator.storage.getDirectory(); }

addEventListener('message', async (e) => {
  const { id, type, ...payload } = e.data;
  try {
    const root = await getRoot();
    if (type === 'GET_STATIONS') {
      const stations = (await readJson(root, 'stations.json')) ?? [];
      postMessage({ id, type: 'RESULT', stations });
      return;
    }
    if (type === 'CREATE_STATION') {
      const stations = (await readJson(root, 'stations.json')) ?? [];
      const station = { id: crypto.randomUUID(), name: payload.name, createdAt: Date.now() };
      stations.push(station);
      await writeJson(root, 'stations.json', stations);
      const dir = await root.getDirectoryHandle(station.id, { create: true });
      await writeJson(dir, 'tracks.json', []);
      postMessage({ id, type: 'RESULT', station });
      return;
    }
    if (type === 'GET_TRACKS') {
      const dir = await root.getDirectoryHandle(payload.stationId);
      const tracks = (await readJson(dir, 'tracks.json')) ?? [];
      postMessage({ id, type: 'RESULT', tracks });
      return;
    }
    if (type === 'IMPORT_TRACKS') {
      const stationId = payload.stationId;
      const files = payload.files;
      const dir = await root.getDirectoryHandle(stationId, { create: true });
      const existing = (await readJson(dir, 'tracks.json')) ?? [];
      const added = [];
      for (const file of files) {
        const trackId = crypto.randomUUID();
        const ext = file.name.split('.').pop() || 'bin';
        const fileName = trackId + '.' + ext;
        await writeBytes(dir, fileName, new Uint8Array(file.buffer));
        added.push({
          id: trackId,
          name: file.name.replace(/\\.[^/.]+$/, ''),
          fileName,
          mimeType: file.mimeType || 'audio/mpeg',
          size: file.buffer.byteLength,
          addedAt: Date.now(),
        });
      }
      await writeJson(dir, 'tracks.json', [...existing, ...added]);
      postMessage({ id, type: 'RESULT', tracks: added });
      return;
    }
    if (type === 'READ_TRACK') {
      const dir = await root.getDirectoryHandle(payload.stationId);
      const fh = await dir.getFileHandle(payload.fileName);
      const file = await fh.getFile();
      const buffer = await file.arrayBuffer();
      postMessage({ id, type: 'RESULT', buffer }, { transfer: [buffer] });
      return;
    }
    if (type === 'DELETE_TRACK') {
      const dir = await root.getDirectoryHandle(payload.stationId);
      await dir.removeEntry(payload.fileName);
      const tracks = (await readJson(dir, 'tracks.json')) ?? [];
      await writeJson(dir, 'tracks.json', tracks.filter(t => t.id !== payload.trackId));
      postMessage({ id, type: 'RESULT', success: true });
      return;
    }
    if (type === 'DELETE_STATION') {
      await root.removeEntry(payload.stationId, { recursive: true });
      const stations = (await readJson(root, 'stations.json')) ?? [];
      await writeJson(root, 'stations.json', stations.filter(s => s.id !== payload.stationId));
      postMessage({ id, type: 'RESULT', success: true });
      return;
    }
    postMessage({ id, type: 'ERROR', message: 'Unknown type: ' + type });
  } catch (err) {
    postMessage({ id, type: 'ERROR', message: err.message });
  }
});
`;

const workerBlob = new Blob([opfsWorkerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(workerBlob));
const workerCallbacks = new Map();

worker.addEventListener('message', (e) => {
  const { id, type, ...payload } = e.data;
  const cb = workerCallbacks.get(id);
  if (!cb) return;
  workerCallbacks.delete(id);
  if (type === 'RESULT') cb.resolve(payload);
  else cb.reject(new Error(payload.message || 'Worker Error'));
});

function invokeWorker(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    workerCallbacks.set(id, { resolve, reject });
    worker.postMessage({ id, type, ...payload }, transfer);
  });
}

const opfsClient = {
  getStations: () => invokeWorker('GET_STATIONS'),
  createStation: (name) => invokeWorker('CREATE_STATION', { name }),
  deleteStation: (stationId) => invokeWorker('DELETE_STATION', { stationId }),
  getTracks: (stationId) => invokeWorker('GET_TRACKS', { stationId }),
  importTracks: (stationId, files) => {
    const transfer = files.map(f => f.buffer);
    return invokeWorker('IMPORT_TRACKS', { stationId, files }, transfer);
  },
  readTrack: (stationId, fileName) => invokeWorker('READ_TRACK', { stationId, fileName }),
  deleteTrack: (stationId, trackId, fileName) => invokeWorker('DELETE_TRACK', { stationId, trackId, fileName }),
};

// ── 3. Audio Engine ───────────────────────────────────────────────────
function makeSilentWavUrl() {
  const sr = 8000, ch = 1, bps = 16, numSamples = sr;
  const dataSize = numSamples * ch * (bps / 8);
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * ch * bps / 8, true);
  v.setUint16(32, ch * bps / 8, true); v.setUint16(34, bps, true);
  w(36, 'data'); v.setUint32(40, dataSize, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

class AudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.objectUrl = null;
    this.silentEl = null;
    this.rafId = null;
    this.state = 'idle';
    this.attachListeners();
  }

  setState(s) {
    this.state = s;
    if (this.onStateChange) this.onStateChange(s);
  }

  startRAF() {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this.state === 'playing') {
        if (this.onTimeUpdate) this.onTimeUpdate(this.audio.currentTime, this.audio.duration || 0);
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stopRAF() {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  attachListeners() {
    const a = this.audio;
    a.addEventListener('playing', () => {
      if (this.state !== 'playing') this.setState('playing');
      this.startRAF();
    });
    a.addEventListener('pause', () => {
      this.stopRAF();
      if (this.state === 'playing') this.setState('paused');
    });
    a.addEventListener('ended', () => {
      this.stopRAF();
      this.setState('idle');
      if (this.onEnded) this.onEnded();
    });
    a.addEventListener('error', () => {
      this.stopRAF();
      if (this.state !== 'idle') {
        this.setState('idle');
        if (this.onError) this.onError(new Error(a.error?.message || 'Audio error'));
      }
    });
  }

  unlock() {
    this.audio.play().catch(() => {}).finally(() => { try { this.audio.pause(); } catch {} });
    if (this.silentEl) return;
    const el = new Audio(makeSilentWavUrl());
    el.loop = true; el.volume = 0.001;
    el.play().catch(() => {});
    this.silentEl = el;
  }

  async load(arrayBuffer, mimeType) {
    this.setState('loading');
    this.stopRAF();
    this.audio.pause();
    const prevUrl = this.objectUrl;
    const blob = new Blob([arrayBuffer], { type: mimeType || 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    this.audio.src = url;
    this.audio.currentTime = 0;
    if (prevUrl) setTimeout(() => URL.revokeObjectURL(prevUrl), 1000);

    await new Promise((resolve, reject) => {
      const done = () => { off(); resolve(); };
      const fail = () => { off(); reject(new Error('Audio load failed')); };
      const off = () => {
        this.audio.removeEventListener('canplay', done);
        this.audio.removeEventListener('error', fail);
      };
      this.audio.addEventListener('canplay', done, { once: true });
      this.audio.addEventListener('error', fail, { once: true });
    });
  }

  play() {
    if (!this.objectUrl) return;
    this.setState('playing');
    this.startRAF();
    try {
      const p = this.audio.play();
      if (p instanceof Promise) {
        p.catch(e => {
          this.stopRAF(); this.setState('paused');
          if (this.onError) this.onError(e);
        });
      }
    } catch (e) {
      this.stopRAF(); this.setState('paused');
      if (this.onError) this.onError(e);
    }
  }

  pause() { this.audio.pause(); }
  seek(time) {
    const c = Math.max(0, Math.min(time, this.audio.duration || 0));
    this.audio.currentTime = c;
    if (this.onTimeUpdate) this.onTimeUpdate(c, this.audio.duration || 0);
  }
  reset() {
    this.stopRAF(); this.audio.pause(); this.setState('idle');
    if (this.onTimeUpdate) this.onTimeUpdate(0, 0);
  }
}
const audioEngine = new AudioEngine();

// ── 4. App State & Logic ──────────────────────────────────────────────
const EXT_MIME = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav',
  flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/opus', aiff: 'audio/aiff', mp4: 'audio/mp4'
};
function inferMimeType(file) {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return EXT_MIME[ext] || 'audio/mpeg';
}

function formatTime(s) {
  if (isNaN(s) || !isFinite(s)) return "00:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

const state = {
  stations: [],
  selectedIndex: 0,
  tracks: [],
  currentTrackIndex: -1,
  currentTrack: null,
  playState: 'idle',
  currentTime: 0,
  duration: 0,
  shuffle: false,
};

const hasMediaSession = 'mediaSession' in navigator;
function syncPositionState() {
  if (!hasMediaSession || state.duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: state.duration, playbackRate: 1, position: Math.min(state.currentTime, state.duration),
    });
  } catch {}
}

audioEngine.onStateChange = (s) => {
  state.playState = s;
  if (hasMediaSession) navigator.mediaSession.playbackState = s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
  renderUI();
};
audioEngine.onTimeUpdate = (t, d) => {
  state.currentTime = t;
  state.duration = d;
  syncPositionState();
  updateTimeUI();
};
audioEngine.onEnded = () => handleNext();

if (hasMediaSession) {
  navigator.mediaSession.setActionHandler('play', () => audioEngine.play());
  navigator.mediaSession.setActionHandler('pause', () => audioEngine.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => handlePrev());
  navigator.mediaSession.setActionHandler('nexttrack', () => handleNext());
}

async function loadTracks() {
  const station = state.stations[state.selectedIndex];
  if (!station) { state.tracks = []; renderUI(); return; }
  try {
    const { tracks } = await opfsClient.getTracks(station.id);
    state.tracks = tracks;
    renderUI();
  } catch (e) { console.error(e); }
}

function setSelectedIndex(idx) {
  state.selectedIndex = idx;
  state.currentTrackIndex = -1;
  state.currentTrack = null;
  audioEngine.reset();
  loadTracks();
}

async function playTrackAtIndex(idx) {
  audioEngine.unlock();
  const track = state.tracks[idx];
  const station = state.stations[state.selectedIndex];
  if (!track || !station) return;

  state.currentTrack = track;
  state.currentTrackIndex = idx;
  state.currentTime = 0;
  renderUI();

  if (hasMediaSession) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.name, artist: station.name, album: 'Vintage Hi-Fi',
      });
      navigator.mediaSession.playbackState = 'playing';
    } catch {}
  }

  try {
    const { buffer } = await opfsClient.readTrack(station.id, track.fileName);
    await audioEngine.load(buffer, track.mimeType || 'audio/mpeg');
    try {
      audioEngine.play();
      syncPositionState();
    } catch (e) { console.error(e); }
  } catch (e) {
    console.error('load failed', e);
    state.currentTrack = null;
    state.currentTrackIndex = -1;
    renderUI();
  }
}

function handleNext() {
  if (!state.tracks.length) return;
  const idx = state.shuffle ? Math.floor(Math.random() * state.tracks.length) : (state.currentTrackIndex + 1) % state.tracks.length;
  playTrackAtIndex(idx);
}
function handlePrev() {
  if (!state.tracks.length) return;
  if (state.currentTime > 3) { audioEngine.seek(0); return; }
  playTrackAtIndex((state.currentTrackIndex - 1 + state.tracks.length) % state.tracks.length);
}
function handlePlayPause() {
  audioEngine.unlock();
  mechanicalFeedback('button');
  if (state.playState === 'playing') audioEngine.pause();
  else if (state.playState === 'paused') audioEngine.play();
  else if (state.currentTrackIndex >= 0) playTrackAtIndex(state.currentTrackIndex);
  else if (state.tracks.length > 0) playTrackAtIndex(0);
}

// ── 5. DOM & UI Rendering ─────────────────────────────────────────────
const els = {
  presets: document.getElementById('station-presets'),
  trackContainer: document.getElementById('track-list-items'),
  trackEmpty: document.getElementById('track-list-empty'),
  trackTitle: document.getElementById('track-list-title'),
  vfdState: document.getElementById('vfd-state'),
  vfdFormat: document.getElementById('vfd-format'),
  vfdName: document.getElementById('vfd-track-name'),
  vfdTimeCurrent: document.getElementById('vfd-time-current'),
  vfdTimeDuration: document.getElementById('vfd-time-duration'),
  needle: document.getElementById('tuning-needle'),
  dial: document.getElementById('station-dial'),
  btnPlayPause: document.getElementById('btn-playpause'),
  iconPlayPause: document.getElementById('icon-playpause'),
  btnShuffle: document.getElementById('btn-shuffle'),
  btnPrev: document.getElementById('btn-prev'),
  btnNext: document.getElementById('btn-next'),
  opfsError: document.getElementById('opfs-error'),
  appRoot: document.getElementById('app-root'),
  addFolderInput: document.getElementById('add-folder-input'),
  addBtnText: document.getElementById('add-btn-text'),
  loadFilesInput: document.getElementById('load-files-input')
};

function renderUI() {
  // 1. Presets
  els.presets.innerHTML = '';
  state.stations.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'station-preset-btn px-2 py-1' + (i === state.selectedIndex ? ' selected' : '');
    btn.style.cssText = \`font-size: 9px; letter-spacing: 0.1em; font-family: 'Source Code Pro', monospace; color: \${i === state.selectedIndex ? 'var(--hifi-amber)' : '#555'}; max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;\`;
    btn.title = s.name;
    btn.textContent = s.name.toUpperCase();
    btn.onclick = () => { mechanicalFeedback('button'); setSelectedIndex(i); };
    btn.oncontextmenu = (e) => {
      e.preventDefault();
      if (confirm('Delete station ' + s.name + '?')) {
        opfsClient.deleteStation(s.id).then(() => init());
      }
    };
    els.presets.appendChild(btn);
  });
  // Add button
  const addBtn = document.createElement('div');
  addBtn.className = 'station-preset-btn px-2 py-1';
  addBtn.style.cssText = \`position: relative; overflow: hidden; cursor: pointer; font-size: 11px; color: #555; display: flex; align-items: center; justify-content: center;\`;
  addBtn.innerHTML = \`<span id="add-btn-text">＋</span><input id="add-folder-input" type="file" webkitdirectory directory multiple style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; font-size: 16px;" />\`;
  els.presets.appendChild(addBtn);
  
  // Re-bind add folder
  document.getElementById('add-folder-input').onchange = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    mechanicalFeedback('button');
    document.getElementById('add-btn-text').textContent = '…';
    try {
      const parts = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/') : [];
      let folderName = parts.length > 1 ? parts[0] : 'New Station';
      const { station } = await opfsClient.createStation(folderName);
      state.stations.push(station);
      const payloads = await Promise.all(files.map(async f => ({
        name: f.name, mimeType: inferMimeType(f), buffer: await f.arrayBuffer(),
      })));
      await opfsClient.importTracks(station.id, payloads);
      setSelectedIndex(state.stations.length - 1);
    } catch(err) { console.error(err); }
    finally { init(); } // Re-render everything
  };

  // 2. Track List
  els.trackEmpty.style.display = state.stations.length === 0 ? 'block' : (state.tracks.length === 0 ? 'block' : 'none');
  if (state.stations.length && state.tracks.length === 0) els.trackEmpty.textContent = 'NO TRACKS — LOAD FILES ABOVE';
  els.trackTitle.textContent = \`TRACK LIST \${state.tracks.length > 0 ? '— ' + state.tracks.length + ' TRACKS' : ''}\`;
  
  els.trackContainer.innerHTML = '';
  state.tracks.forEach((t, i) => {
    const active = t.id === (state.currentTrack?.id || null);
    const row = document.createElement('div');
    row.className = 'group hover:bg-white/[0.02]';
    row.style.cssText = \`display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid rgba(255,255,255,0.03); cursor: pointer; background: \${active ? 'rgba(217,119,6,0.06)' : 'transparent'};\`;
    row.onclick = () => { mechanicalFeedback('button'); playTrackAtIndex(i); };
    
    const num = document.createElement('span');
    num.style.cssText = \`width: 20px; text-align: right; font-family: 'Source Code Pro', monospace; font-size: 10px; color: \${active ? '#d97706' : '#333'}; flex-shrink: 0;\`;
    num.textContent = String(i + 1).padStart(2, '0');
    
    const ind = document.createElement('span');
    ind.style.cssText = \`width: 12px; font-size: 10px; flex-shrink: 0; color: #d97706; opacity: \${active ? 1 : 0}; filter: \${active ? 'drop-shadow(0 0 4px rgba(217,119,6,0.9))' : 'none'}\`;
    ind.textContent = (state.playState === 'loading' && active) ? '…' : '▶';

    const name = document.createElement('span');
    name.style.cssText = \`flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'Source Code Pro', monospace; font-size: 11px; color: \${active ? '#d97706' : '#5a5a6a'}; letter-spacing: 0.04em;\`;
    name.title = t.name;
    name.textContent = t.name;

    const del = document.createElement('button');
    del.className = 'opacity-0 group-hover:opacity-100 transition-opacity';
    del.style.cssText = \`font-size: 12px; color: #444; line-height: 1; padding: 0 2px; background: none; border: none; cursor: pointer;\`;
    del.textContent = '×';
    del.onclick = async (e) => {
      e.stopPropagation();
      await opfsClient.deleteTrack(state.stations[state.selectedIndex].id, t.id, t.fileName);
      loadTracks();
    };

    row.append(num, ind, name, del);
    els.trackContainer.appendChild(row);
  });

  // 3. VFD Display
  if (!state.currentTrack) {
    els.vfdName.textContent = 'NO TRACK LOADED';
    els.vfdFormat.textContent = 'MPEG';
    els.vfdFormat.style.opacity = '0.1';
  } else {
    els.vfdName.textContent = state.currentTrack.name;
    els.vfdFormat.textContent = (state.currentTrack.mimeType || 'MPEG').split('/')[1]?.toUpperCase().substring(0, 4) || 'MPEG';
    els.vfdFormat.style.opacity = '0.5';
  }

  els.vfdState.textContent = state.playState.toUpperCase();
  els.vfdState.style.opacity = state.playState === 'idle' ? '0.3' : '1';
  
  if (state.playState === 'playing') els.vfdName.classList.add('hifi-marquee');
  else els.vfdName.classList.remove('hifi-marquee');

  // 4. Buttons & Controls
  const p = state.playState === 'playing';
  els.iconPlayPause.innerHTML = p 
    ? \`<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><rect x="0" y="0" width="5" height="16" rx="1.5"></rect><rect x="9" y="0" width="5" height="16" rx="1.5"></rect></svg>\`
    : \`<svg width="13" height="16" viewBox="0 0 13 16" fill="currentColor"><polygon points="0,0 0,16 13,8"></polygon></svg>\`;
  
  els.btnPlayPause.style.color = p ? '#4ecb2e' : '#e5e5e5';
  els.btnShuffle.style.color = state.shuffle ? '#4ecb2e' : '#e5e5e5';

  // 5. Dial & Slider
  const pct = state.stations.length <= 1 ? 0 : (state.selectedIndex / (state.stations.length - 1)) * 100;
  els.needle.style.left = \`\${pct}%\`;
  els.dial.style.transform = \`rotate(\${pct * 2.7}deg)\`;

  updateTimeUI();
}

function updateTimeUI() {
  els.vfdTimeCurrent.textContent = formatTime(state.currentTime);
  els.vfdTimeDuration.textContent = formatTime(state.duration);
  const opacity = state.playState === 'idle' ? '0.3' : '1';
  els.vfdTimeCurrent.style.opacity = opacity;
  els.vfdTimeDuration.style.opacity = opacity;
}

// Bind fixed buttons
els.btnPlayPause.onclick = handlePlayPause;
els.btnNext.onclick = () => { mechanicalFeedback('button'); handleNext(); };
els.btnPrev.onclick = () => { mechanicalFeedback('button'); handlePrev(); };
els.btnShuffle.onclick = () => { mechanicalFeedback('button'); state.shuffle = !state.shuffle; renderUI(); };

els.loadFilesInput.onchange = async (e) => {
  if (!state.stations[state.selectedIndex] || !e.target.files.length) return;
  mechanicalFeedback('button');
  const files = Array.from(e.target.files);
  try {
    const payloads = await Promise.all(files.map(async f => ({
      name: f.name, mimeType: inferMimeType(f), buffer: await f.arrayBuffer(),
    })));
    await opfsClient.importTracks(state.stations[state.selectedIndex].id, payloads);
    loadTracks();
  } catch(err) { console.error(err); }
  els.loadFilesInput.value = '';
};

// ── 6. Initialization ─────────────────────────────────────────────────
async function init() {
  const supported = typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.getDirectory === 'function';
  if (!supported) {
    els.appRoot.style.display = 'none';
    els.opfsError.style.display = 'flex';
    return;
  }
  try {
    const { stations } = await opfsClient.getStations();
    state.stations = stations;
    if (state.selectedIndex >= stations.length) state.selectedIndex = Math.max(0, stations.length - 1);
    loadTracks();
  } catch(err) { console.error('Init error:', err); }
}

init();
