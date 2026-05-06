import { useState } from 'react';
import type { Station } from '@/lib/types';
import { opfsClient } from '@/lib/opfsClient';

interface Props {
  stations: Station[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (station: Station) => void;
  onDeleted: (id: string) => void;
}

export default function StationPanel({
  stations,
  selectedId,
  onSelect,
  onCreated,
  onDeleted,
}: Props) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const { station } = await opfsClient.createStation(trimmed);
      onCreated(station);
      setName('');
    } catch (e) {
      console.error('[StationPanel] create failed', e);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await opfsClient.deleteStation(id);
      onDeleted(id);
    } catch (err) {
      console.error('[StationPanel] delete failed', err);
    }
  };

  return (
    <aside>
      <h2>Stations</h2>

      {/* New-station form */}
      <div>
        <input
          type="text"
          value={name}
          placeholder="New station name…"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
        />
        <button onClick={handleCreate} disabled={busy || !name.trim()}>
          {busy ? '…' : 'Add'}
        </button>
      </div>

      {/* Station list */}
      {stations.length === 0 && <p>No stations yet.</p>}
      <ul>
        {stations.map((s) => (
          <li
            key={s.id}
            onClick={() => onSelect(s.id)}
            aria-selected={selectedId === s.id}
            style={{ fontWeight: selectedId === s.id ? 'bold' : 'normal', cursor: 'pointer' }}
          >
            {s.name}
            <button
              onClick={(e) => handleDelete(s.id, e)}
              title="Delete station"
              style={{ marginLeft: 8 }}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
