import { useMemo } from 'react';
import { useStore } from './storeContext';
import { useCatalog } from './catalogContext';
import { useCollection } from './useCollection';
import { usePrices } from './usePrices';
import { getOwnedPrintings } from '../utils/collectionFilters';
import { getTradeableSurplus } from '../utils/trades';
import { getWants } from '../utils/tradeMatch';

export const DEFAULT_TRADE_WANTS = { specials: false, decks: true };

/**
 * The user's side of a trade with another player, from the given binders (all by default):
 * the copies owned there, the surplus copies they can give (kept copies and decks counted on the
 * whole collection) and the cards they look for, as the trade preferences say.
 * @param {string[]|null} binderIds
 * @returns {{ owned: object[], haves: object[], wants: object[] } | null} null until the catalog is loaded
 */
export const useTradeSide = (binderIds = null) => {
  const { binders, decks, deckGroups, allocations, listings, sellFoil, prefs } = useStore();
  const { index } = useCatalog();
  const collection = useCollection();
  const scoped = useCollection(binderIds);
  const { getPrice } = usePrices();
  const keep = prefs.tradeKeep ?? 1;
  const { specials, decks: withDecks } = { ...DEFAULT_TRADE_WANTS, ...prefs.tradeWants };
  const scopeKey = binderIds?.join(',') ?? '*';

  return useMemo(() => {
    if (!index) return null;
    const ids = scopeKey === '*' ? null : new Set(scopeKey.split(','));
    const printings = getOwnedPrintings(scoped);
    return {
      owned: [...printings.values()],
      haves: getTradeableSurplus(collection, decks, keep, getPrice, { groups: deckGroups, listings, sellFoil }).filter((h) => printings.has(h.card.id)),
      wants: getWants({
        binders: ids ? binders.filter((b) => ids.has(b.id)) : binders,
        decks: withDecks ? decks : [],
        index,
        collection,
        groups: deckGroups,
        allocations,
        specials,
      }),
    };
  }, [index, scopeKey, scoped, collection, binders, decks, keep, getPrice, deckGroups, allocations, listings, sellFoil, specials, withDecks]);
};
