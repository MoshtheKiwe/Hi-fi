import { useRef } from 'react';
import type { Station, Track } from '@/lib/types';
import { opfsClient } from '@/lib/opfsClient';
import { mechanicalFeedback } from '@/lib/mechanicalFeedback';

/** iOS often returns an empty file.type for audio files — infer from extension. */
export const EXT_MIME: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac',
  wav: 'audio/wav',  flac: 'audio/flac', ogg: 'audio/ogg',
  opus: 'audio/opus', aiff: 'audio/aiff', aif: 'audio/aiff',
  mp4: 'audio/mp4',  wma: 'audio/x-ms-wma',
};
export function inferMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'audio/mpeg';
}

interface Props {
  station: Station | null;
  tracks: Track[];
  currentTrack: Track | null;
  isLoading: boolean;
  onTracksAdded: (t: Track[]) => void;
  onTrackDeleted: (id: string) => void;
  onPlay: (track: Track, index: number) => void;
}

export default function TrackListView({
  station, tracks, currentTrack, isLoading,
  onTracksAdded, onTrackDeleted, onPlay,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!station || !e.target.files?.length) return;
    mechanicalFeedback('button');
    const files = Array.from(e.target.files);
    try {
      const payloads = await Promise.all(
        files.map(async f => ({
          name: f.name,
          mimeType: inferMimeType(f),
          buffer: await f.arrayBuffer(),
        }))
      );
      const { tracks: added } = await opfsClient.importTracks(station.id, payloads);
      onTracksAdded(added);
    } catch (err) { console.error('[TrackListView] import', err); }
    // Reset so the same file can be picked again
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDelete = async (t: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!station) return;
    try { await opfsClient.deleteTrack(station.id, t.id, t.fileName); onTrackDeleted(t.id); }
    catch (err) { console.error('[TrackListView] delete', err); }
  };

  return (
    <div className="mx-4 mb-3">
      {/* Header bar */}
      <div className="hifi-brushed-panel flex items-center justify-between px-3 py-1.5 rounded-t-md">
        <span style={{ fontFamily: "'Source Code Pro', monospace", fontSize: 9, letterSpacing: '0.2em', color: '#3a3a3a' }}>
          TRACK LIST {tracks.length > 0 ? `— ${tracks.length} TRACKS` : ''}
        </span>

        {station && (
          /*
           * iOS Safari REQUIRES the user to tap the <input type="file"> element
           * directly. Hiding it with display:none and using a <label> does NOT
           * work on iOS. Solution: visible styled button with a transparent
           * <input> overlaid on top (opacity:0, position:absolute, inset:0).
           * The user taps what looks like the button but is actually the input.
           */
          <div
            className="station-preset-btn px-2 py-0.5"
            style={{
              position: 'relative',
              overflow: 'hidden',
              cursor: 'pointer',
              fontSize: 9,
              letterSpacing: '0.15em',
              fontFamily: "'Source Code Pro', monospace",
              color: '#aaa',
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            ⊕ LOAD FILES
            <input
              ref={inputRef}
              type="file"
              multiple

              onChange={handleImport}
              style={{
                position: 'absolute',
                top: 0, left: 0,
                width: '100%', height: '100%',
                opacity: 0,
                cursor: 'pointer',
                // fontSize prevents iOS from zooming the viewport on focus
                fontSize: 16,
              }}
            />
          </div>
        )}
      </div>

      {/* Track rows */}
      <div style={{
        background: '#0b0b0d', border: '1px solid rgba(0,0,0,0.6)', borderTop: 'none',
        borderRadius: '0 0 6px 6px', maxHeight: 168, overflowY: 'auto',
        WebkitOverflowScrolling: 'touch', // momentum scroll on iOS
      }}>
        {!station && (
          <p style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, letterSpacing: '0.2em',
            color: '#333', fontFamily: "'Source Code Pro', monospace" }}>
            SELECT A STATION
          </p>
        )}
        {station && tracks.length === 0 && (
          <p style={{ textAlign: 'center', padding: '20px 0', fontSize: 10, letterSpacing: '0.2em',
            color: '#333', fontFamily: "'Source Code Pro', monospace" }}>
            NO TRACKS — LOAD FILES ABOVE
          </p>
        )}
        {tracks.map((t, i) => {
          const active = t.id === currentTrack?.id;
          return (
            <div key={t.id} onClick={() => { mechanicalFeedback('button'); onPlay(t, i); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                background: active ? 'rgba(217,119,6,0.06)' : 'transparent',
              }}
              className="group hover:bg-white/[0.02]">
              <span style={{ width: 20, textAlign: 'right', fontFamily: "'Source Code Pro', monospace",
                fontSize: 10, color: active ? '#d97706' : '#333', flexShrink: 0 }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ width: 12, fontSize: 10, flexShrink: 0, color: '#d97706',
                opacity: active ? 1 : 0, filter: active ? 'drop-shadow(0 0 4px rgba(217,119,6,0.9))' : 'none' }}>
                {isLoading && active ? '…' : '▶'}
              </span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontFamily: "'Source Code Pro', monospace", fontSize: 11,
                color: active ? '#d97706' : '#5a5a6a', letterSpacing: '0.04em' }}
                title={t.name}>
                {t.name}
              </span>
              <button onClick={e => handleDelete(t, e)}
                style={{ opacity: 0, fontSize: 12, color: '#444', lineHeight: 1, padding: '0 2px',
                  background: 'none', border: 'none', cursor: 'pointer' }}
                className="group-hover:!opacity-100 transition-opacity">
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
