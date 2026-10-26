import { useEffect, useState } from 'react';
import { LORCANA_SETS, withFrenchNames, setKnownLorcanaSets } from '../data/games';

const CACHE_KEY = 'folio-lorcana-sets';
const MAX_AGE = 24 * 60 * 60 * 1000;

const readCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    return cached?.sets?.length ? cached : null;
  } catch {
    return null;
  }
};

/**
 * Numbered Lorcana chapters, kept up to date from the Lorcast API (cached for a day).
 * Falls back to the built-in list when offline. A new refreshKey fetches the list again at once.
 */
export const useLorcanaSets = (refreshKey = 0) => {
  const [sets, setSets] = useState(() => readCache()?.sets ?? LORCANA_SETS);

  useEffect(() => {
    const cached = readCache();
    if (!refreshKey && cached && Date.now() - cached.at < MAX_AGE) {
      setKnownLorcanaSets(cached.sets);
      return;
    }
    let cancelled = false;
    fetch('https://api.lorcast.com/v0/sets')
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data) => {
        const numbered = withFrenchNames(
          (data.results ?? [])
            .filter((s) => /^\d+$/.test(s.code))
            .map((s) => ({ code: s.code, name: s.name, releasedAt: s.released_at }))
            .sort((a, b) => Number(a.code) - Number(b.code))
        );
        if (numbered.length === 0 || cancelled) return;
        setKnownLorcanaSets(numbered);
        setSets(numbered);
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sets: numbered }));
        } catch {
          // Cache is optional
        }
      })
      .catch(() => {
        // Offline or API down: keep the built-in list
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return sets;
};
