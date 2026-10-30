import { createContext, useContext } from 'react';

/** Where the price history is backed up (usePriceHistorySync), for the screens showing it. */
export const PriceHistoryContext = createContext(null);

export const usePriceHistoryBackup = () => useContext(PriceHistoryContext);
