import { useEffect, useState } from 'react';

// Loaded once, on the first visit to the simulation: about 800 kB of card rules
let loaded = null;
let loading = null;

/**
 * The card abilities the simulation plays (src/data/cardAbilities.json, by catalog key), or
 * null while they load.
 */
export const useCardAbilities = () => {
  const [abilities, setAbilities] = useState(loaded);
  useEffect(() => {
    if (loaded) return undefined;
    let alive = true;
    loading ??= import('../data/cardAbilities.json').then((m) => (loaded = m.default.cards));
    loading.then((cards) => alive && setAbilities(cards));
    return () => {
      alive = false;
    };
  }, []);
  return abilities;
};
