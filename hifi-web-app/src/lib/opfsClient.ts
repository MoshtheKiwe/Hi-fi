/**
 * OPFSClient — promise-based bridge to the OPFS Web Worker.
 * Uses a message-ID correlation map so every call returns a typed Promise.
 */

import type { Station, Track } from './types';

type Resolver = { resolve: (v: unknown) => void; reject: (e: Error) => void };

class OPFSClient {
  private worker: Worker;
  private pending = new Map<string, Resolver>();

  constructor() {
    this.worker = new Worker(
      new URL('../workers/opfsWorker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = ({ data }) => {
      const { id, type, ...rest } = data as { id: string; type: string; [k: string]: unknown };
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      type === 'ERROR'
        ? p.reject(new Error(rest.message as string))
        : p.resolve(rest);
    };

    this.worker.onerror = (e) =>
      console.error('[OPFSWorker] Uncaught error:', e.message);
  }

  private send<T>(
    type: string,
    payload?: Record<string, unknown>,
    transfer?: Transferable[]
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage(
        { id, type, ...(payload ?? {}) },
        { transfer: transfer ?? [] }
      );
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  getStations() {
    return this.send<{ stations: Station[] }>('GET_STATIONS');
  }

  createStation(name: string) {
    return this.send<{ station: Station }>('CREATE_STATION', { name });
  }

  getTracks(stationId: string) {
    return this.send<{ tracks: Track[] }>('GET_TRACKS', { stationId });
  }

  /**
   * Imports audio files into a station.
   * ArrayBuffers are *transferred* (zero-copy) to the worker.
   */
  importTracks(
    stationId: string,
    files: { name: string; mimeType: string; buffer: ArrayBuffer }[]
  ) {
    const transfers = files.map((f) => f.buffer);
    return this.send<{ tracks: Track[] }>(
      'IMPORT_TRACKS',
      { stationId, files },
      transfers
    );
  }

  /**
   * Reads raw audio bytes for a track back from OPFS.
   * The returned ArrayBuffer is transferred (zero-copy) to the main thread.
   */
  readTrack(stationId: string, fileName: string) {
    return this.send<{ buffer: ArrayBuffer }>('READ_TRACK', { stationId, fileName });
  }

  deleteTrack(stationId: string, trackId: string, fileName: string) {
    return this.send<{ success: boolean }>('DELETE_TRACK', {
      stationId,
      trackId,
      fileName,
    });
  }

  deleteStation(stationId: string) {
    return this.send<{ success: boolean }>('DELETE_STATION', { stationId });
  }
}

// Singleton — one worker shared across the whole app.
export const opfsClient = new OPFSClient();
