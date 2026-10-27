import { useCallback, useEffect, useRef, useState } from 'react';
import { idbDelete, idbGet, idbSet } from '../utils/db';
import { serializeBackup } from '../utils/storage';

const FOLDER_KEY = 'backup-folder';
// Changes are written once the user pauses, and when the tab is hidden
const DELAY = 2000;

/** Whether the browser can write into a folder the user picks (Chrome, Edge; not Safari or Firefox). */
const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** One file a day: the latest backup is always the newest file, and older days stay as history. */
const fileName = () => `folio-sauvegarde-auto-${new Date().toISOString().slice(0, 10)}.json`;

/**
 * Writes a backup into a folder the user picked each time the state changes, so the MCP server
 * (which reads the newest folio-sauvegarde-*.json of a folder) always sees the current collection.
 * The folder handle is kept in IndexedDB; after a reload the browser may ask again for the right
 * to write, which needs a click (resume).
 * @returns {{ supported: boolean, status: 'off'|'on'|'paused'|'error', folderName: string|null,
 *   savedAt: number|null, choose: () => Promise<boolean>, resume: () => Promise<void>, stop: () => Promise<void> }}
 */
export const useAutoBackup = (state) => {
  const [folder, setFolder] = useState(null);
  const [status, setStatus] = useState('off');
  const [savedAt, setSavedAt] = useState(null);
  const pendingRef = useRef(null);

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    idbGet('kv', FOLDER_KEY).then(async (handle) => {
      if (!handle || cancelled) return;
      const permission = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
      if (cancelled) return;
      setFolder(handle);
      setStatus(permission === 'granted' ? 'on' : 'paused');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const write = useCallback(
    async (data) => {
      try {
        const file = await folder.getFileHandle(fileName(), { create: true });
        const writable = await file.createWritable();
        await writable.write(serializeBackup(data));
        await writable.close();
        setSavedAt(Date.now());
      } catch (error) {
        // Permission withdrawn, folder deleted or moved
        setStatus(error?.name === 'NotAllowedError' ? 'paused' : 'error');
      }
    },
    [folder]
  );

  useEffect(() => {
    if (status !== 'on' || !folder) return;
    pendingRef.current = () => write(state);
    const timer = setTimeout(() => {
      pendingRef.current = null;
      write(state);
    }, DELAY);
    return () => {
      clearTimeout(timer);
      pendingRef.current = null;
    };
  }, [state, folder, status, write]);

  // Closing or leaving the tab: write the last changes now
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== 'hidden' || !pendingRef.current) return;
      pendingRef.current();
      pendingRef.current = null;
    };
    document.addEventListener('visibilitychange', flush);
    return () => document.removeEventListener('visibilitychange', flush);
  }, []);

  /** Asks for a folder and starts writing to it; false when the user cancels. */
  const choose = useCallback(async () => {
    try {
      const handle = await window.showDirectoryPicker({ id: 'folio-backup', mode: 'readwrite', startIn: 'downloads' });
      await idbSet('kv', FOLDER_KEY, handle);
      setFolder(handle);
      setStatus('on');
      return true;
    } catch {
      return false;
    }
  }, []);

  const resume = useCallback(async () => {
    const permission = await folder?.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    setStatus(permission === 'granted' ? 'on' : 'paused');
  }, [folder]);

  const stop = useCallback(async () => {
    await idbDelete('kv', FOLDER_KEY);
    setFolder(null);
    setStatus('off');
    setSavedAt(null);
  }, []);

  return { supported, status, folderName: folder?.name ?? null, savedAt, choose, resume, stop };
};
