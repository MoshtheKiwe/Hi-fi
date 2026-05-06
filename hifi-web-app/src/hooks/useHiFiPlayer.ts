import { useEffect, useState, useCallback, useRef } from 'react';
import type { Station, Track } from '@/lib/types';
import { opfsClient } from '@/lib/opfsClient';
import { audioEngine, type PlaybackState } from '@/lib/audioEngine';

const OPFS_SUPPORTED =
  typeof navigator !== 'undefined' &&
  'storage' in navigator &&
  typeof (navigator.storage as any).getDirectory === 'function';

const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

function syncPositionState(t: number, d: number) {
  if (!hasMediaSession || d <= 0) return;
  try {
    (navigator.mediaSession as any).setPositionState?.({
      duration: d, playbackRate: 1, position: Math.min(t, d),
    });
  } catch { /* partial support */ }
}

export function useHiFiPlayer() {
  const [stations, setStations]               = useState<Station[]>([]);
  const [selectedIndex, _setSelectedIndex]    = useState(0);
  const [tracks, setTracks]                   = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack]       = useState<Track | null>(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [playState, setPlayState]             = useState<PlaybackState>('idle');
  const [currentTime, setCurrentTime]         = useState(0);
  const [duration, setDuration]               = useState(0);
  const [shuffle, setShuffle]                 = useState(false);

  const tracksRef          = useRef<Track[]>([]);
  const stationsRef        = useRef<Station[]>([]);
  const selectedIndexRef   = useRef(0);
  const currentTrackIdxRef = useRef(-1);
  const shuffleRef         = useRef(false);
  const nextFnRef          = useRef<() => void>(() => {});
  const prevFnRef          = useRef<() => void>(() => {});

  tracksRef.current          = tracks;
  stationsRef.current        = stations;
  selectedIndexRef.current   = selectedIndex;
  currentTrackIdxRef.current = currentTrackIndex;
  shuffleRef.current         = shuffle;

  // ── Wire audio engine callbacks + register Media Session handlers ONCE ───
  useEffect(() => {
    audioEngine.onStateChange = (s) => {
      setPlayState(s);
      if (hasMediaSession) {
        navigator.mediaSession.playbackState =
          s === 'playing' ? 'playing' : s === 'paused' ? 'paused' : 'none';
      }
    };

    audioEngine.onTimeUpdate = (t, d) => {
      setCurrentTime(t);
      setDuration(d);
      syncPositionState(t, d);
    };

    audioEngine.onEnded = () => nextFnRef.current();
    audioEngine.onError = (e) => console.error('[AudioEngine]', e);

    // Register Media Session action handlers ONCE here (not per-track).
    // They delegate via refs so they always point at the current callbacks.
    // Re-registering per-track creates a brief window where handlers are
    // cleared, which drops lock-screen controls during auto-next transitions.
    if (hasMediaSession) {
      try {
        navigator.mediaSession.setActionHandler('play',
          () => audioEngine.play());
        navigator.mediaSession.setActionHandler('pause',
          () => audioEngine.pause());
        navigator.mediaSession.setActionHandler('previoustrack',
          () => prevFnRef.current());
        navigator.mediaSession.setActionHandler('nexttrack',
          () => nextFnRef.current());
        navigator.mediaSession.setActionHandler('seekto', d => {
          if (d.seekTime != null) audioEngine.seek(d.seekTime);
        });
        navigator.mediaSession.setActionHandler('seekforward', d =>
          audioEngine.seek(audioEngine.currentTime + (d.seekOffset ?? 10)));
        navigator.mediaSession.setActionHandler('seekbackward', d =>
          audioEngine.seek(audioEngine.currentTime - (d.seekOffset ?? 10)));
      } catch { /* partial support */ }
    }
  }, []);

  useEffect(() => {
    if (!OPFS_SUPPORTED) return;
    opfsClient.getStations().then(({ stations: s }) => setStations(s)).catch(console.error);
  }, []);

  const loadTracksForIndex = useCallback(async (index: number) => {
    const station = stationsRef.current[index];
    if (!station) { setTracks([]); return; }
    try {
      const { tracks: t } = await opfsClient.getTracks(station.id);
      setTracks(t);
    } catch (e) { console.error('[useHiFiPlayer] loadTracks', e); }
  }, []);

  const setSelectedIndex = useCallback((index: number) => {
    _setSelectedIndex(index);
    selectedIndexRef.current = index;
    setCurrentTrack(null);
    setCurrentTrackIndex(-1);
    audioEngine.reset(); // Intentional stop — user switched stations
    loadTracksForIndex(index);
  }, [loadTracksForIndex]);

  const playTrackAtIndex = useCallback(async (index: number) => {
    const track   = tracksRef.current[index];
    const station = stationsRef.current[selectedIndexRef.current];
    if (!track || !station) return;

    // Update UI state immediately so the display reflects the new track
    setCurrentTrack(track);
    setCurrentTrackIndex(index);
    setCurrentTime(0);

    // ── Fix 2: Update lock-screen metadata PRE-EMPTIVELY, before any async ──
    // This prevents the lock screen from flickering blank during auto-next.
    if (hasMediaSession) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title:  track.name,
          artist: station.name,
          album:  'Vintage Hi-Fi',
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch { /* partial support */ }
    }

    try {
      const { buffer } = await opfsClient.readTrack(station.id, track.fileName);

      // ── Fix 1: load() swaps src on the SAME element — no reset() here ──
      // Calling audioEngine.reset() (which paused + cleared src) before this
      // told iOS the session ended. Now we just swap src on the live element.
      await audioEngine.load(buffer, track.mimeType || 'audio/mpeg');

      // ── Fix 4: try/catch around play() ──
      try {
        audioEngine.play();
        syncPositionState(0, audioEngine.duration);
      } catch (playErr) {
        console.error('[useHiFiPlayer] play() rejected', playErr);
      }
    } catch (e) {
      console.error('[useHiFiPlayer] load failed', e);
      setCurrentTrack(null);
      setCurrentTrackIndex(-1);
    }
  }, []);

  const handleNext = useCallback(() => {
    const t = tracksRef.current;
    if (!t.length) return;
    const idx = shuffleRef.current
      ? Math.floor(Math.random() * t.length)
      : (currentTrackIdxRef.current + 1) % t.length;
    playTrackAtIndex(idx);
  }, [playTrackAtIndex]);

  const handlePrev = useCallback(() => {
    const t = tracksRef.current;
    if (!t.length) return;
    if (audioEngine.currentTime > 3) { audioEngine.seek(0); return; }
    playTrackAtIndex((currentTrackIdxRef.current - 1 + t.length) % t.length);
  }, [playTrackAtIndex]);

  nextFnRef.current = handleNext;
  prevFnRef.current = handlePrev;

  const handlePlayPause = useCallback(() => {
    if (playState === 'playing') audioEngine.pause();
    else if (playState === 'paused') audioEngine.play();
    else if (currentTrackIdxRef.current >= 0) playTrackAtIndex(currentTrackIdxRef.current);
    else if (tracksRef.current.length > 0) playTrackAtIndex(0);
  }, [playState, playTrackAtIndex]);

  const deleteStation = useCallback(async (stationId: string) => {
    const curr    = stationsRef.current;
    const delIdx  = curr.findIndex(s => s.id === stationId);
    if (delIdx === -1) return;

    try { await opfsClient.deleteStation(stationId); }
    catch (e) { console.error('[deleteStation]', e); return; }

    const next        = curr.filter(s => s.id !== stationId);
    const currSel     = selectedIndexRef.current;
    const wasSelected = delIdx === currSel;

    let newSel = currSel;
    if (next.length === 0)      newSel = 0;
    else if (delIdx < currSel)  newSel = currSel - 1;
    else if (wasSelected)       newSel = Math.min(currSel, next.length - 1);

    setStations(next);
    _setSelectedIndex(newSel);
    selectedIndexRef.current = newSel;

    if (next.length === 0 || wasSelected) {
      audioEngine.reset();
      setCurrentTrack(null);
      setCurrentTrackIndex(-1);
    }

    if (next.length === 0) {
      setTracks([]);
    } else if (wasSelected) {
      setTracks([]);
      const newStation = next[newSel];
      if (newStation) {
        try {
          const { tracks: t } = await opfsClient.getTracks(newStation.id);
          setTracks(t);
        } catch { setTracks([]); }
      }
    }
  }, []);

  return {
    opfsSupported: OPFS_SUPPORTED,
    stations, setStations,
    selectedIndex, setSelectedIndex,
    selectedStation: stations[selectedIndex] ?? null,
    tracks, setTracks,
    currentTrack,
    playState, currentTime, duration,
    shuffle, setShuffle,
    playTrackAtIndex, handleNext, handlePrev, handlePlayPause, deleteStation,
  };
}
