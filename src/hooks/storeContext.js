import { createContext, useContext } from 'react';

/** The useBinders() store, for the collection-wide screens (decks, stats, trades, assistant). */
export const StoreContext = createContext(null);

export const useStore = () => useContext(StoreContext);
