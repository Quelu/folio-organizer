import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardPreviewContext } from './cardPreviewContext';
import CardPreview from './CardPreview';
import { useCatalog } from '../../hooks/catalogContext';
import { useStore } from '../../hooks/storeContext';

/**
 * Lets any card thumbnail open the full card view. The thumbnails sharing the clicked one's
 * [data-preview-group] container (a deck list, search results…) can then be browsed with ← →.
 */
const CardPreviewProvider = ({ children, onLocate }) => {
  const { index } = useCatalog();
  const { setView } = useStore();
  const [state, setState] = useState(null); // { cards, index, dir, foilIds }

  const open = useCallback(
    (card, { foil = false, origin = null } = {}) => {
      const group = origin?.closest('[data-preview-group]');
      const elements = group ? [...group.querySelectorAll('[data-preview-id]')] : [];
      const ids = [...new Set(elements.map((el) => el.dataset.previewId))];
      const cards = ids.map((id) => index?.byId.get(id)).filter(Boolean);
      const foilIds = new Set(elements.filter((el) => el.dataset.previewFoil).map((el) => el.dataset.previewId));
      if (foil) foilIds.add(card.id);
      const position = cards.findIndex((c) => c.id === card.id);
      setState(
        position === -1
          ? { cards: [card], index: 0, dir: 0, foilIds }
          : { cards, index: position, dir: 0, foilIds }
      );
    },
    [index]
  );

  const close = useCallback(() => setState(null), []);

  const navigate = useCallback((delta) => {
    setState((s) => {
      if (!s) return s;
      const next = s.index + delta;
      return next < 0 || next >= s.cards.length ? s : { ...s, index: next, dir: delta };
    });
  }, []);

  // Captured before the other modals' listeners, so Esc and arrows only act on the preview
  const isOpen = Boolean(state);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'ArrowRight') navigate(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, close, navigate]);

  const value = useMemo(() => ({ open }), [open]);

  return (
    <CardPreviewContext.Provider value={value}>
      {children}
      <CardPreview
        state={state}
        onClose={close}
        onNavigate={navigate}
        onLocate={(binderId, cardNumber) => {
          close();
          onLocate(binderId, cardNumber);
        }}
        onOpenDeck={(deckId) => {
          close();
          setView({ kind: 'decks', deckId });
        }}
      />
    </CardPreviewContext.Provider>
  );
};

export default CardPreviewProvider;
