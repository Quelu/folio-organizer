import { useEffect } from 'react';
import { CARDMARKET_SYNC_FILE } from '../utils/cardmarketSync';

// The journal changes while Claude works on Cardmarket: read it often, and when the tab comes back
const INTERVAL = 15000;

const ACTION_LABELS = { listed: 'mises en vente', removed: 'retirées', sold: 'vendues', delisted: 'retirées sur Cardmarket' };

/**
 * Reads the Cardmarket journal the MCP server writes next to the auto backup, and applies the
 * events not applied yet (see utils/cardmarketSync.js). Needs the auto backup on.
 * @param {{ status: string, readFile: Function }} autoBackup from useAutoBackup
 * @param {(events: object[]) => number} applyJournal the store's applyCardmarketJournal
 * @param {(toast: object) => void} notify
 */
export const useCardmarketSync = (autoBackup, applyJournal, notify) => {
  const { status, readFile } = autoBackup;
  useEffect(() => {
    if (status !== 'on') return;
    let cancelled = false;
    const read = async () => {
      const text = await readFile(CARDMARKET_SYNC_FILE);
      if (cancelled || !text) return;
      let events;
      try {
        events = JSON.parse(text).events ?? [];
      } catch {
        return; // Being written: next read
      }
      const applied = applyJournal(events);
      if (!applied) return;
      const counts = {};
      for (const e of events.slice(-applied)) counts[e.action] = (counts[e.action] ?? 0) + e.qty;
      notify({
        tone: 'success',
        message: `Cardmarket : ${Object.entries(counts)
          .map(([action, qty]) => `${qty} ${ACTION_LABELS[action] ?? action}`)
          .join(', ')}`,
      });
    };
    read();
    const timer = setInterval(read, INTERVAL);
    const onFocus = () => read();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [status, readFile, applyJournal, notify]);
};
