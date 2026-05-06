/**
 * OPFS Web Worker — all Origin Private File System I/O runs here
 * so the main thread is never blocked by storage operations.
 *
 * OPFS layout:
 *   /stations.json          – array of StationMeta
 *   /{stationId}/           – one directory per station
 *     tracks.json           – array of TrackMeta
 *     {trackId}.{ext}       – raw audio files
 */

interface StationMeta {
  id: string;
  name: string;
  createdAt: number;
}

interface TrackMeta {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  addedAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readJson<T>(dir: FileSystemDirectoryHandle, name: string): Promise<T | null> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

/**
 * Write bytes to an OPFS file using FileSystemSyncAccessHandle.
 *
 * WHY: Safari (iOS 15.2+) workers support ONLY createSyncAccessHandle().
 *      FileSystemWritableFileStream / createWritable() is NOT available in
 *      Safari workers (any version). This single function covers all writes.
 */
async function writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const fh = await dir.getFileHandle(name, { create: true });
  // createSyncAccessHandle is the only write path that works in ALL
  // OPFS-capable browser workers (Chrome 86+, Firefox 111+, Safari 15.2+).
  const access = await (fh as any).createSyncAccessHandle();
  try {
    access.write(bytes, { at: 0 });
    access.truncate(bytes.byteLength); // ensure no stale bytes if file existed
    access.flush();
  } finally {
    access.close(); // always release the exclusive lock
  }
}

async function writeJson(dir: FileSystemDirectoryHandle, name: string, data: unknown): Promise<void> {
  await writeBytes(dir, name, new TextEncoder().encode(JSON.stringify(data)));
}

async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory();
}

// ── Message handler ────────────────────────────────────────────────────────

addEventListener('message', async (e: MessageEvent) => {
  const { id, type, ...payload } = e.data as { id: string; type: string; [key: string]: unknown };

  try {
    const root = await getRoot();

    // ── GET_STATIONS ──────────────────────────────────────────────────────
    if (type === 'GET_STATIONS') {
      const stations = (await readJson<StationMeta[]>(root, 'stations.json')) ?? [];
      postMessage({ id, type: 'RESULT', stations });
      return;
    }

    // ── CREATE_STATION ────────────────────────────────────────────────────
    if (type === 'CREATE_STATION') {
      const stations = (await readJson<StationMeta[]>(root, 'stations.json')) ?? [];
      const station: StationMeta = {
        id: crypto.randomUUID(),
        name: payload.name as string,
        createdAt: Date.now(),
      };
      stations.push(station);
      await writeJson(root, 'stations.json', stations);
      // Create the station sub-directory and an empty tracks file.
      const dir = await root.getDirectoryHandle(station.id, { create: true });
      await writeJson(dir, 'tracks.json', []);
      postMessage({ id, type: 'RESULT', station });
      return;
    }

    // ── GET_TRACKS ────────────────────────────────────────────────────────
    if (type === 'GET_TRACKS') {
      const dir = await root.getDirectoryHandle(payload.stationId as string);
      const tracks = (await readJson<TrackMeta[]>(dir, 'tracks.json')) ?? [];
      postMessage({ id, type: 'RESULT', tracks });
      return;
    }

    // ── IMPORT_TRACKS ─────────────────────────────────────────────────────
    if (type === 'IMPORT_TRACKS') {
      const stationId = payload.stationId as string;
      const files = payload.files as { name: string; mimeType: string; buffer: ArrayBuffer }[];

      const dir = await root.getDirectoryHandle(stationId, { create: true });
      const existing = (await readJson<TrackMeta[]>(dir, 'tracks.json')) ?? [];

      const added: TrackMeta[] = [];
      for (const file of files) {
        const trackId = crypto.randomUUID();
        const ext = file.name.split('.').pop() ?? 'bin';
        const fileName = `${trackId}.${ext}`;

        // Use createSyncAccessHandle — required for Safari worker compatibility
        await writeBytes(dir, fileName, new Uint8Array(file.buffer));

        added.push({
          id: trackId,
          name: file.name.replace(/\.[^/.]+$/, ''), // strip extension for display
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

    // ── READ_TRACK ────────────────────────────────────────────────────────
    if (type === 'READ_TRACK') {
      const dir = await root.getDirectoryHandle(payload.stationId as string);
      const fh = await dir.getFileHandle(payload.fileName as string);
      const file = await fh.getFile();
      const buffer = await file.arrayBuffer();
      // Transfer the buffer — zero-copy path to the main thread.
      postMessage({ id, type: 'RESULT', buffer }, { transfer: [buffer] });
      return;
    }

    // ── DELETE_TRACK ──────────────────────────────────────────────────────
    if (type === 'DELETE_TRACK') {
      const dir = await root.getDirectoryHandle(payload.stationId as string);
      await dir.removeEntry(payload.fileName as string);
      const tracks = (await readJson<TrackMeta[]>(dir, 'tracks.json')) ?? [];
      await writeJson(
        dir,
        'tracks.json',
        tracks.filter((t) => t.id !== payload.trackId)
      );
      postMessage({ id, type: 'RESULT', success: true });
      return;
    }

    // ── DELETE_STATION ────────────────────────────────────────────────────
    if (type === 'DELETE_STATION') {
      await root.removeEntry(payload.stationId as string, { recursive: true });
      const stations = (await readJson<StationMeta[]>(root, 'stations.json')) ?? [];
      await writeJson(
        root,
        'stations.json',
        stations.filter((s) => s.id !== payload.stationId)
      );
      postMessage({ id, type: 'RESULT', success: true });
      return;
    }

    postMessage({ id, type: 'ERROR', message: `Unknown message type: ${type}` });
  } catch (err) {
    postMessage({ id, type: 'ERROR', message: (err as Error).message });
  }
});
