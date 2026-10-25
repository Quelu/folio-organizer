import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogContext } from './catalogContext';
import { useLorcanaSets } from './useLorcanaSets';
import { idbGetAll, idbSet } from '../utils/db';
import { fetchLorcastSetCards } from '../utils/lorcastApi';
import { buildCatalogIndex, slimLorcastCard } from '../utils/catalog';

// Prices and legalities change: refetch a set after two days
const MAX_AGE = 2 * 24 * 60 * 60 * 1000;

/**
 * Loads the full Lorcana catalog: from IndexedDB at once, then the missing or stale sets from
 * Lorcast in the background, one at a time to stay polite with the API.
 */
const CatalogProvider = ({ children }) => {
  const sets = useLorcanaSets();
  const [cardsBySet, setCardsBySet] = useState({});
  const [status, setStatus] = useState('loading');
  const [attempt, setAttempt] = useState(0);
  const setCodes = sets.map((s) => s.code).join(',');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await idbGetAll('catalog');
      const fresh = {};
      const cached = {};
      for (const entry of stored) {
        cached[entry.set] = entry.cards;
        if (Date.now() - entry.at < MAX_AGE) fresh[entry.set] = true;
      }
      if (!cancelled && Object.keys(cached).length) setCardsBySet(cached);

      const toFetch = setCodes.split(',').filter((code) => code && !fresh[code]);
      let failed = 0;
      for (const code of toFetch) {
        if (cancelled) break;
        try {
          const cards = (await fetchLorcastSetCards(code)).map(slimLorcastCard);
          if (cards.length === 0) continue; // announced chapter without cards yet
          await idbSet('catalog', code, { set: code, at: Date.now(), cards });
          if (!cancelled) setCardsBySet((prev) => ({ ...prev, [code]: cards }));
        } catch {
          failed++;
        }
      }
      if (!cancelled) setStatus(failed && !Object.keys(cached).length ? 'error' : 'ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [setCodes, attempt]);

  const refresh = useCallback(() => {
    setStatus('loading');
    setAttempt((a) => a + 1);
  }, []);

  const index = useMemo(() => (Object.keys(cardsBySet).length ? buildCatalogIndex(cardsBySet) : null), [cardsBySet]);

  const value = useMemo(
    () => ({ index, status, loaded: Object.keys(cardsBySet).length, total: sets.length, refresh }),
    [index, status, cardsBySet, sets.length, refresh]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
};

export default CatalogProvider;
