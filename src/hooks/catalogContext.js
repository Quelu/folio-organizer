import { createContext, useContext } from 'react';

/** { index, status: 'idle'|'loading'|'ready'|'error', loaded, total, updatedAt, update } — see CatalogProvider. */
export const CatalogContext = createContext({
  index: null,
  status: 'idle',
  loaded: 0,
  total: 0,
  updatedAt: null,
  refresh: () => {},
  update: () => {},
});

export const useCatalog = () => useContext(CatalogContext);
