import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogContext } from './catalogContext';
import { useLorcanaSets } from './useLorcanaSets';
import { idbGet, idbGetAll, idbSet } from '../utils/db';
import { fetchLorcastSetCards } from '../utils/lorcastApi';
import { buildCatalogIndex, slimLorcastCard } from '../utils/catalog';
import { buildLocalizedCards, getLorcanaJsonPath } from '../utils/lorcanaJson';

// Prices and legalities change: refetch a set after two days
const MAX_AGE = 2 * 24 * 60 * 60 * 1000;
// Translations and pictures only change with a new chapter
const LOCALIZED_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
// Bumped when buildLocalizedCards changes, so cached cards are rebuilt
const LOCALIZED_VERSION = 2;

/**
 * LorcanaJSON cards of one language, from IndexedDB or the site (through the dev proxy).
 * Resolves to null when unavailable: the app then shows Lorcast's English data.
 */
const loadLocalized = async (lang) => {
  const key = `lorcanajson-${lang}`;
  const cached = await idbGet('kv', key);
  const usable = cached?.version === LOCALIZED_VERSION;
  if (usable && Date.now() - cached.at < LOCALIZED_MAX_AGE) return cached.cards;
  try {
    const res = await fetch(getLorcanaJsonPath(lang));
    if (!res.ok) throw new Error(`LorcanaJSON ${res.status}`);
    const cards = buildLocalizedCards(await res.json());
    await idbSet('kv', key, { at: Date.now(), version: LOCALIZED_VERSION, cards });
    return cards;
  } catch {
    // Static deploy without the proxy, or offline: older translations beat none
    return usable ? cached.cards : null;
  }
};

/**
 * Loads the full Lorcana catalog: from IndexedDB at once, then the missing or stale sets from
 * Lorcast in the background, one at a time to stay polite with the API. French texts and the
 * official pictures of the card language come from LorcanaJSON (French always: it is searched).
 */
const CatalogProvider = ({ lang = 'fr', children }) => {
  const sets = useLorcanaSets();
  const [cardsBySet, setCardsBySet] = useState({});
  const [localized, setLocalized] = useState({});
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

  const languages = lang === 'fr' ? 'fr' : `fr,${lang}`;
  useEffect(() => {
    let cancelled = false;
    for (const l of languages.split(',')) {
      loadLocalized(l).then((cards) => {
        if (!cancelled && cards) setLocalized((prev) => (prev[l] ? prev : { ...prev, [l]: cards }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [languages]);

  const refresh = useCallback(() => {
    setStatus('loading');
    setAttempt((a) => a + 1);
  }, []);

  const index = useMemo(
    () => (Object.keys(cardsBySet).length ? buildCatalogIndex(cardsBySet, localized) : null),
    [cardsBySet, localized]
  );

  const value = useMemo(
    () => ({ index, status, loaded: Object.keys(cardsBySet).length, total: sets.length, refresh }),
    [index, status, cardsBySet, sets.length, refresh]
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
};

export default CatalogProvider;
