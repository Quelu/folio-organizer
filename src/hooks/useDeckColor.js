import { useStore } from './storeContext';

const DECK_COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c'];

/** Color of a deck in the copy split views, stable as long as the deck list order is. */
export const useDeckColor = () => {
  const { decks } = useStore();
  return (deckId) => DECK_COLORS[Math.max(0, decks.findIndex((d) => d.id === deckId)) % DECK_COLORS.length];
};
