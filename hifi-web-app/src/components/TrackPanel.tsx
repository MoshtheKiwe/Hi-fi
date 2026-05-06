import { useId } from 'react';
import type { Station, Track } from '@/lib/types';
import { opfsClient } from '@/lib/opfsClient';

interface Props {
  station: Station | null;
  tracks: Track[];
  currentTrackId: string | null;
  isLoadingTrack: boolean;
  onTracksAdded: (tracks: Track[]) => void;
  onTrackDeleted: (id: string) => void;
  onPlay: (track: Track) => void;
}

export default function TrackPanel({
  station,
  tracks,
  currentTrackId,
  isLoadingTrack,
  onTracksAdded,
  onTrackDeleted,
  onPlay,
}: Props) {
  const inputId = useId();

  /**
   * Read each selected File into an ArrayBuffer on the main thread,
   * then hand them (transferred, zero-copy) to the OPFS worker.
   */
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!station || !e.target.files?.length) return;
    const selected = Array.from(e.target.files);
    try {
      const payloads = await Promise.all(
        selected.map(async (f) => ({
          name: f.name,
          mimeType: f.type || 'audio/mpeg',
          buffer: await f.arrayBuffer(),
        }))
      );
      const { tracks: added } = await opfsClient.importTracks(station.id, payloads);
      onTracksAdded(added);
    } catch (err) {
      console.error('[TrackPanel] import failed', err);
    }
    // Reset so the same file can be re-selected later.
    e.target.value = '';
  };

  const handleDelete = async (t: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!station) return;
    try {
      await opfsClient.deleteTrack(station.id, t.id, t.fileName);
      onTrackDeleted(t.id);
    } catch (err) {
      console.error('[TrackPanel] delete track failed', err);
    }
  };

  return (
    <section style={{ flex: 1 }}>
      <h2>{station ? station.name : 'Select a Station'}</h2>

      {station && (
        /* Use a <label> wrapping the hidden input — most mobile-safe pattern */
        <label htmlFor={inputId} style={{ cursor: 'pointer', display: 'inline-block', marginBottom: 8 }}>
          <span style={{ padding: '4px 8px', border: '1px solid', borderRadius: 4 }}>
            Import Audio Files
          </span>
          <input
            id={inputId}
            type="file"
            multiple
            accept="audio/*"
            style={{ display: 'none' }}
            onChange={handleImport}
          />
        </label>
      )}

      {tracks.length === 0 && station && <p>No tracks. Import some files!</p>}
      {!station && <p>Create or select a station on the left.</p>}

      <ul>
        {tracks.map((t) => {
          const isActive = t.id === currentTrackId;
          return (
            <li
              key={t.id}
              style={{ fontWeight: isActive ? 'bold' : 'normal', marginBottom: 4 }}
            >
              <button
                onClick={() => onPlay(t)}
                disabled={isLoadingTrack && isActive}
                style={{ marginRight: 8 }}
              >
                {isActive && isLoadingTrack ? '…' : '▶'}
              </button>
              <span
                onClick={() => onPlay(t)}
                style={{ cursor: 'pointer' }}
                title={t.name}
              >
                {t.name}
              </span>
              <span style={{ color: '#888', fontSize: '0.8em', marginLeft: 8 }}>
                {(t.size / 1024 / 1024).toFixed(1)} MB
              </span>
              {station && (
                <button
                  onClick={(e) => handleDelete(t, e)}
                  title="Remove track"
                  style={{ marginLeft: 8 }}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
