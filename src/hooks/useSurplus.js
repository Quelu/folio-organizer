import { useMemo } from 'react';
import { useStore } from './storeContext';
import { useCollection } from './useCollection';
import { usePrices } from './usePrices';
import { getSurplusCopies, getListedCopies } from '../utils/trades';

/**
 * The surplus copies in the binders (getSurplusCopies) and the copies put on sale, the ones a
 * deck now needs flagged (getListedCopies).
 * @returns {{ surplus: object[], listed: object[] }}
 */
export const useSurplus = () => {
  const { decks, deckGroups, listings, sellFoil, prefs } = useStore();
  const collection = useCollection();
  const { getPrice } = usePrices();
  const keep = prefs.tradeKeep ?? 1;
  return useMemo(() => {
    const surplus = getSurplusCopies(collection, decks, { keep, groups: deckGroups, getPrice, listings, sellFoil });
    return { surplus, listed: getListedCopies(collection, listings, surplus) };
  }, [collection, decks, keep, deckGroups, getPrice, listings, sellFoil]);
};
