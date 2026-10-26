import { useMemo } from 'react';
import { useCatalog } from './catalogContext';
import { useStore } from './storeContext';
import { buildCollection } from '../utils/collection';

/**
 * Owned Lorcana cards of the given binders (all binders by default), grouped by full name.
 * @param {string[]|null} binderIds
 */
export const useCollection = (binderIds = null) => {
  const { index } = useCatalog();
  const { binders, pulls } = useStore();
  const key = binderIds?.join(',') ?? '*';
  return useMemo(() => {
    const ids = key === '*' ? null : new Set(key.split(','));
    return buildCollection(ids ? binders.filter((b) => ids.has(b.id)) : binders, index, pulls);
  }, [binders, index, pulls, key]);
};
