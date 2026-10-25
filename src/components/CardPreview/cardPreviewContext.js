import { createContext, useContext } from 'react';

/** { open(card, { foil, origin }) } — see CardPreviewProvider. Null outside the provider. */
export const CardPreviewContext = createContext(null);

export const useCardPreview = () => useContext(CardPreviewContext);
