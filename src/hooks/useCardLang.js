import { useMemo } from 'react';
import { useStore } from './storeContext';
import { useCatalog } from './catalogContext';
import { localizeCard, getCardImage, getFoilMask, getMainPrinting } from '../utils/catalog';

/**
 * Card texts and pictures in the language chosen in the sidebar (French by default).
 * fullName(card, fallback) also covers deck entries whose card is unknown (catalog not loaded);
 * keyName(key, fallback) names a card from its full-name key (deck entries, conflicts, diffs).
 */
export const useCardLang = () => {
  const { prefs } = useStore();
  const { index } = useCatalog();
  const lang = prefs.cardLanguage ?? 'fr';
  return useMemo(
    () => ({
      lang,
      localize: (card) => localizeCard(card, lang),
      fullName: (card, fallback = '?') => (card ? localizeCard(card, lang).fullName : fallback),
      keyName: (key, fallback = key) => {
        const card = index ? getMainPrinting(index, key) : null;
        return card ? localizeCard(card, lang).fullName : fallback;
      },
      image: (card, size) => getCardImage(card, lang, size),
      foilMask: (card) => getFoilMask(card, lang),
    }),
    [lang, index]
  );
};
