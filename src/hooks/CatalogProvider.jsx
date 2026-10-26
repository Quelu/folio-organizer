import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CatalogContext } from './catalogContext';
import { useLorcanaSets } from './useLorcanaSets';
import { idbGet, idbGetAll, idbSet } from '../utils/db';
import { fetchLorcastSetCards } from '../utils/lorcastApi';
import { buildCatalogIndex, slimLorcastCard } from '../utils/catalog';
import { buildLocalizedCards, getLorcanaJsonPath } from '../utils/lorcanaJson';
import { addFrenchSetNames, getLorcanaSetName } from '../data/games';
import { useToast } from '../components/ui/toastContext';

// Prices and legalities change, and a new chapter must show up quickly: refetch after two days
const MAX_AGE = 2 * 24 * 60 * 60 * 1000;
// Bumped when buildLocalizedCards changes, so cached data is rebuilt
const LOCALIZED_VERSION = 3;
// Chapters seen so far, to announce the new ones
const SEEN_KEY = 'folio-seen-chapters';

/**
 * LorcanaJSON data of one language, from IndexedDB or the site (through the dev proxy).
 * force: skip the cache. Resolves to { cards, sets, at } or null when unavailable: the app then
 * shows Lorcast's English data.
 */
const loadLocalized = async (lang, force) => {
  const key = `lorcanajson-${lang}`;
  const cached = await idbGet('kv', key);
  const usable = cached?.version === LOCALIZED_VERSION;
  if (usable && !force && Date.now() - cached.at < MAX_AGE) return cached;
  try {
    const res = await fetch(getLorcanaJsonPath(lang));
    if (!res.ok) throw new Error(`LorcanaJSON ${res.status}`);
    const fresh = { ...buildLocalizedCards(await res.json()), at: Date.now(), version: LOCALIZED_VERSION };
    await idbSet('kv', key, fresh);
    return fresh;
  } catch {
    // Static deploy without the proxy, or offline: older data beats none
    return usable ? cached : null;
  }
};

const readSeen = () => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY));
  } catch {
    return null;
  }
};

/**
 * Loads the full Lorcana catalog: from IndexedDB at once, then the missing or stale sets from
 * Lorcast in the background, one at a time to stay polite with the API. French texts, official
 * pictures, legalities and rotation come from LorcanaJSON (French always: it is searched).
 *
 * Future chapters need no code change: the chapter list is checked daily, the data every two
 * days, update() fetches everything again at once, and a toast announces each new chapter.
 */
const CatalogProvider = ({ lang = 'fr', children }) => {
  const notify = useToast();
  const [forcedAt, setForcedAt] = useState(0);
  const sets = useLorcanaSets(forcedAt);
  const [cardsBySet, setCardsBySet] = useState({});
  const [fetchedAt, setFetchedAt] = useState({});
  const [localized, setLocalized] = useState({});
  // When the last LorcanaJSON load finished (fetched, cached or failed)
  const [localizedDoneAt, setLocalizedDoneAt] = useState(0);
  const [status, setStatus] = useState('loading');
  const setCodes = sets.map((s) => s.code).join(',');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await idbGetAll('catalog');
      const fresh = {};
      const cached = {};
      const dates = {};
      for (const entry of stored) {
        cached[entry.set] = entry.cards;
        dates[entry.set] = entry.at;
        // After update(), only what was fetched since counts as fresh
        if (Date.now() - entry.at < MAX_AGE && entry.at > forcedAt) fresh[entry.set] = true;
      }
      if (!cancelled && Object.keys(cached).length) {
        setCardsBySet(cached);
        setFetchedAt(dates);
      }

      const toFetch = setCodes.split(',').filter((code) => code && !fresh[code]);
      let failed = 0;
      for (const code of toFetch) {
        if (cancelled) break;
        try {
          const cards = (await fetchLorcastSetCards(code)).map(slimLorcastCard);
          if (cards.length === 0) continue; // announced chapter without cards yet
          const at = Date.now();
          await idbSet('catalog', code, { set: code, at, cards });
          if (!cancelled) {
            setCardsBySet((prev) => ({ ...prev, [code]: cards }));
            setFetchedAt((prev) => ({ ...prev, [code]: at }));
          }
        } catch {
          failed++;
        }
      }
      if (!cancelled) setStatus(failed && !Object.keys(cached).length ? 'error' : 'ready');
    })();

    return () => {
      cancelled = true;
    };
  }, [setCodes, forcedAt]);

  const languages = lang === 'fr' ? 'fr' : `fr,${lang}`;
  useEffect(() => {
    let cancelled = false;
    for (const l of languages.split(',')) {
      loadLocalized(l, forcedAt > 0).then((data) => {
        if (cancelled) return;
        if (l === 'fr') setLocalizedDoneAt(Date.now());
        if (!data) return;
        if (l === 'fr') addFrenchSetNames(Object.fromEntries(Object.values(data.sets).map((s) => [s.code, s.name])));
        setLocalized((prev) => (prev[l]?.at === data.at ? prev : { ...prev, [l]: data }));
      });
    }
    return () => {
      cancelled = true;
    };
  }, [languages, forcedAt]);

  /** Fetches the chapter list, every chapter and the translations again, ignoring the caches. */
  const update = useCallback(() => {
    setStatus('loading');
    setForcedAt(Date.now());
  }, []);

  const index = useMemo(
    () => (Object.keys(cardsBySet).length ? buildCatalogIndex(cardsBySet, localized) : null),
    [cardsBySet, localized]
  );

  // Announce chapters that were not in the catalog before (not on the very first load)
  const announcedRef = useRef(new Set());
  useEffect(() => {
    if (!index || status !== 'ready') return;
    const seen = readSeen();
    const added = seen ? index.sets.filter((code) => !seen.includes(code) && !announcedRef.current.has(code)) : [];
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(index.sets));
    } catch {
      // Announcements are optional
    }
    if (added.length === 0) return;
    added.forEach((code) => announcedRef.current.add(code));
    const count = added.reduce((s, code) => s + index.bySet.get(code).length, 0);
    notify({
      tone: 'success',
      message: `Nouveau chapitre : ${added.map((code) => `${code} · ${getLorcanaSetName(code)}`).join(', ')} (${count} cartes)`,
      duration: 8000,
    });
  }, [index, status, notify]);

  const value = useMemo(() => {
    const dates = Object.values(fetchedAt);
    return {
      index,
      // An update is over once the translations are fetched again too
      status: status === 'ready' && forcedAt > localizedDoneAt ? 'loading' : status,
      loaded: Object.keys(cardsBySet).length,
      total: sets.length,
      // Oldest chapter fetch: every chapter is at least this fresh
      updatedAt: dates.length ? Math.min(...dates) : null,
      refresh: update,
      update,
    };
  }, [index, status, forcedAt, localizedDoneAt, cardsBySet, sets.length, fetchedAt, update]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
};

export default CatalogProvider;
