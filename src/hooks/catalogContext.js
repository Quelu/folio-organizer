import { createContext, useContext } from 'react';

/** { index, status: 'idle'|'loading'|'ready'|'error', loaded, total, refresh } — see CatalogProvider. */
export const CatalogContext = createContext({ index: null, status: 'idle', loaded: 0, total: 0, refresh: () => {} });

export const useCatalog = () => useContext(CatalogContext);
