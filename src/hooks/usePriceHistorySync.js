import { useEffect, useMemo, useState } from 'react';
import { ensureCardmarket } from './usePrices';
import {
  HISTORY_FILE,
  addMonths,
  hasDays,
  historyFileName,
  loadMonth,
  loadMonths,
  mergeMonth,
  onHistoryChange,
  parseHistory,
  serializeHistory,
} from '../utils/priceHistory';

// A tab left open overnight records the new day too
const CHECK_INTERVAL = 60 * 60 * 1000;

/**
 * Keeps the price history (utils/priceHistory.js): records a day each day Folio is open, whatever
 * the screen, and mirrors it with monthly files of the auto backup folder. Both ways: days the
 * browser lacks come back from the files (cleared browser data, another computer), days the files
 * lack are written to them. Nothing is ever removed from either side.
 * @param {object} autoBackup from useAutoBackup
 * @returns {{ supported: boolean, status: 'off'|'on'|'paused'|'error', folderName: string|null,
 *   syncedAt: number|null, choose: Function, resume: Function }} where the history is backed up
 */
export const usePriceHistorySync = (autoBackup) => {
  const { supported, status, folderName, choose, resume, readFile, writeFile, listFiles } = autoBackup;
  const [syncedAt, setSyncedAt] = useState(null);

  useEffect(() => {
    // Asks the browser not to evict Folio's data when the disk runs low
    navigator.storage?.persist?.().catch(() => {});
    ensureCardmarket();
    const timer = setInterval(ensureCardmarket, CHECK_INTERVAL);
    window.addEventListener('focus', ensureCardmarket);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', ensureCardmarket);
    };
  }, []);

  useEffect(() => {
    if (status !== 'on') return;
    let cancelled = false;
    let queue = Promise.resolve();
    const run = (task) => {
      queue = queue.then(task).catch(() => {});
    };

    const readMonthFile = async (month) => {
      const text = await readFile(historyFileName(month));
      try {
        return parseHistory(JSON.parse(text))?.find((m) => m.month === month) ?? null;
      } catch {
        return null;
      }
    };

    // The file keeps its own days too: written back with the union, never with less
    const saveMonth = async (month) => {
      const stored = await loadMonth(month);
      if (!stored) return;
      const file = await readMonthFile(month);
      if (hasDays(file, stored)) return;
      if ((await writeFile(historyFileName(month), serializeHistory([mergeMonth(stored, file)]))) && !cancelled) {
        setSyncedAt(Date.now());
      }
    };

    run(async () => {
      const months = (await listFiles()).map((name) => name.match(HISTORY_FILE)?.[1]).filter(Boolean);
      const files = (await Promise.all(months.map(readMonthFile))).filter(Boolean);
      await addMonths(files);
      for (const { month } of await loadMonths()) await saveMonth(month);
      if (!cancelled) setSyncedAt(Date.now());
    });
    const unsubscribe = onHistoryChange((month) => run(() => saveMonth(month)));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [status, readFile, writeFile, listFiles]);

  return useMemo(
    () => ({ supported, status, folderName, syncedAt, choose, resume }),
    [supported, status, folderName, syncedAt, choose, resume]
  );
};
