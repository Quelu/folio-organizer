import { useCallback } from 'react';
import { useStore } from './storeContext';
import { EMPTY_FILTERS } from '../utils/collectionFilters';

/** Opens the collection's want list on one binder or deck: { binders: [id] } or { decks: [id] }. */
export const useOpenWantList = () => {
  const { setPref, setView } = useStore();
  return useCallback(
    (filters) => {
      setPref('collectionFilters', { ...EMPTY_FILTERS, ...filters });
      setView({ kind: 'stats', tab: 'wants' });
    },
    [setPref, setView]
  );
};
