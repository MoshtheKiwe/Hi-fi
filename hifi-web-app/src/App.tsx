import { useState, useRef } from 'react';
import { useHiFiPlayer } from '@/hooks/useHiFiPlayer';
import { opfsClient } from '@/lib/opfsClient';
import { audioEngine } from '@/lib/audioEngine';
import { mechanicalFeedback } from '@/lib/mechanicalFeedback';
import StationDial from '@/components/StationDial';
import TuningSlider from '@/components/TuningSlider';
import MechanicalButton from '@/components/MechanicalButton';
import HiFiDisplay from '@/components/HiFiDisplay';
import TrackListView, { inferMimeType } from '@/components/TrackListView';
import { PWASetup } from '@/components/PWASetup';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';

// ── Refined SVG transport icons ──────────────────────────────────────────────

const PrevIcon = () => (
  <svg width="16" height="13" viewBox="0 0 16 13" fill="currentColor">
    <rect x="0" y="0" width="2.5" height="13" rx="1.2" />
    <polygon points="15,0 15,13 5.5,6.5" />
  </svg>
);
const NextIcon = () => (
  <svg width="16" height="13" viewBox="0 0 16 13" fill="currentColor">
    <polygon points="1,0 1,13 10.5,6.5" />
    <rect x="13.5" y="0" width="2.5" height="13" rx="1.2" />
  </svg>
);
const PlayIcon = () => (
  <svg width="13" height="16" viewBox="0 0 13 16" fill="currentColor">
    <polygon points="0,0 0,16 13,8" />
  </svg>
);
const PauseIcon = () => (
  <svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor">
    <rect x="0"  y="0" width="5" height="16" rx="1.5" />
    <rect x="9"  y="0" width="5" height="16" rx="1.5" />
  </svg>
);

// ────────────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    opfsSupported, stations, setStations,
    selectedIndex, setSelectedIndex, selectedStation,
    tracks, setTracks, currentTrack,
    playState, currentTime, duration,
    shuffle, setShuffle,
    playTrackAtIndex, handleNext, handlePrev, handlePlayPause, deleteStation,
  } = useHiFiPlayer();

  const [creating, setCreating] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleImportFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length || creating) return;
    mechanicalFeedback('button');
    const files = Array.from(e.target.files);
    if (!files.length) return;

    setCreating(true);
    try {
      const firstPath = files[0].webkitRelativePath || '';
      const parts = firstPath.split('/');
      let folderName = parts.length > 1 ? parts[0] : 'New Station';
      if (!folderName.trim()) folderName = 'New Station';

      const { station } = await opfsClient.createStation(folderName);
      const next = [...stations, station];
      setStations(next);
      const newIndex = next.length - 1;
      
      const payloads = await Promise.all(
        files.map(async f => ({
          name: f.name,
          mimeType: inferMimeType(f),
          buffer: await f.arrayBuffer(),
        }))
      );
      await opfsClient.importTracks(station.id, payloads);
      setSelectedIndex(newIndex);
    } catch (err) {
      console.error('[App] handleImportFolder error', err);
    } finally {
      setCreating(false);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };
  if (!opfsSupported) return (
    <div className="min-h-screen flex items-center justify-center p-8 text-center">
      <p className="text-muted-foreground font-mono text-sm">
        Origin Private File System not supported.<br />Use Chrome 86+, Edge 86+, or Safari 15.2+.
      </p>
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#080808', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <PWASetup />
      <div className="hifi-device rounded-2xl overflow-hidden w-full" style={{ maxWidth: 440 }}>

        {/* Wood top trim */}
        <div className="wood-trim h-3" />

        {/* Device header */}
        <div className="flex items-center justify-between px-5 py-2" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="flex items-center gap-2">
            <div className="hifi-led-dot on" />
            <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 9, letterSpacing: '0.25em', color: '#555' }}>VINTAGE · HI-FI</span>
          </div>
          <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 9, letterSpacing: '0.2em', color: '#333' }}>MODEL VS-1</span>
        </div>

        {/* VFD Display */}
        <HiFiDisplay track={currentTrack} state={playState} currentTime={currentTime}
          duration={duration} onSeek={t => audioEngine.seek(t)} />

        {/* Station preset buttons — right-click / long-press to delete */}
        <div className="px-4 mb-1">
          <div className="flex flex-wrap gap-1.5 items-center">
            {stations.map((s, i) => (
              <ContextMenu key={s.id}>
                {/* @ts-expect-error ContextMenuTrigger base-ui asChild is not typed */}
                <ContextMenuTrigger asChild>
                  <button
                    className={`station-preset-btn px-2 py-1${i === selectedIndex ? ' selected' : ''}`}
                    onClick={() => { mechanicalFeedback('button'); setSelectedIndex(i); }}
                    style={{
                      fontSize: 9, letterSpacing: '0.1em',
                      fontFamily: "'Source Code Pro', monospace",
                      color: i === selectedIndex ? 'var(--hifi-amber)' : '#555',
                      maxWidth: 80, overflow: 'hidden',
                      textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={s.name}>
                    {s.name.toUpperCase()}
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="font-mono">
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive text-xs tracking-widest"
                    onClick={() => deleteStation(s.id)}>
                    ⊗ DELETE STATION
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
            <div className="station-preset-btn px-2 py-1"
              style={{
                position: 'relative', overflow: 'hidden', cursor: 'pointer',
                fontSize: 11, color: '#555', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              title="Add station from folder">
              {creating ? '…' : '＋'}
              <input
                ref={folderInputRef}
                type="file"
                // @ts-expect-error non-standard attributes for directory picker
                webkitdirectory="" directory="" multiple
                onChange={handleImportFolder}
                style={{
                  position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                  opacity: 0, cursor: 'pointer', fontSize: 16,
                }}
              />
            </div>
          </div>
        </div>

        {/* Tuning band (left) + Knurled dial (right) */}
        <div className="flex items-center justify-center gap-3 px-4 py-1">
          <TuningSlider
            stations={stations}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
          <StationDial
            stations={stations}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
          />
        </div>

        {/* Track list */}
        <TrackListView
          station={selectedStation}
          tracks={tracks}
          currentTrack={currentTrack}
          isLoading={playState === 'loading'}
          onTracksAdded={added => setTracks(prev => [...prev, ...added])}
          onTrackDeleted={id => setTracks(prev => prev.filter(t => t.id !== id))}
          onPlay={(_, i) => playTrackAtIndex(i)}
        />

        {/* Transport controls */}
        <div className="hifi-brushed-panel flex items-center justify-center gap-4 px-6 py-4">
          <MechanicalButton icon={<span>⇄</span>} label="SHUFFLE"
            onClick={() => setShuffle(s => !s)} isActive={shuffle} />
          <MechanicalButton icon={<PrevIcon />} label="PREV"
            onClick={handlePrev} disabled={tracks.length === 0} />
          <MechanicalButton
            icon={playState === 'playing' ? <PauseIcon /> : <PlayIcon />}
            label={playState === 'playing' ? 'PAUSE' : 'PLAY'}
            onClick={handlePlayPause}
            isActive={playState === 'playing' || playState === 'paused'}
            disabled={tracks.length === 0 && !currentTrack}
            accentColor="#4ecb2e" />
          <MechanicalButton icon={<NextIcon />} label="NEXT"
            onClick={handleNext} disabled={tracks.length === 0} />
        </div>

        {/* Wood bottom trim */}
        <div className="wood-trim h-3" />
      </div>

      {/* Add Station Dialog was removed in favor of folder picker */}
    </div>
  );
}
