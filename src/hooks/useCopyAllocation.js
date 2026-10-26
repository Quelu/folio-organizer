import { useMemo } from 'react';
import { useStore } from './storeContext';
import { useCollection } from './useCollection';
import { getCopyAllocation } from '../utils/collection';

/** Split of the owned copies between the user's decks (see getCopyAllocation). */
export const useCopyAllocation = () => {
  const { decks, allocations } = useStore();
  const collection = useCollection();
  return useMemo(() => getCopyAllocation(decks, collection, allocations), [decks, collection, allocations]);
};
