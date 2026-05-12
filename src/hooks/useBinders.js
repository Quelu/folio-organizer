import { useState, useEffect, useCallback, useRef } from 'react';
import { loadState, saveState } from '../utils/storage';
import { fetchLorcastCard } from '../utils/lorcastApi';

const DEFAULT_STATE = {
  binders: [],
  activeBinderId: null,
  addHistory: [],
};

export const useBinders = () => {
  const [state, setState] = useState(() => loadState() ?? DEFAULT_STATE);

  // Keep a ref to current binders for use in async callbacks
  const bindersRef = useRef(state.binders);
  useEffect(() => {
    bindersRef.current = state.binders;
  }, [state.binders]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const activeBinder = state.binders.find((b) => b.id === state.activeBinderId) ?? null;

  const createBinder = useCallback((binderData) => {
    const newBinder = {
      id: crypto.randomUUID(),
      name: binderData.name,
      gameType: binderData.gameType,
      setCode: binderData.setCode ?? '',
      gridCols: binderData.gridCols ?? 3,
      gridRows: binderData.gridRows ?? 3,
      cards: {},
    };
    setState((prev) => ({
      ...prev,
      binders: [...prev.binders, newBinder],
      activeBinderId: newBinder.id,
    }));
  }, []);

  const deleteBinder = useCallback((binderId) => {
    setState((prev) => ({
      ...prev,
      binders: prev.binders.filter((b) => b.id !== binderId),
      activeBinderId:
        prev.activeBinderId === binderId
          ? (prev.binders.find((b) => b.id !== binderId)?.id ?? null)
          : prev.activeBinderId,
    }));
  }, []);

  const setActiveBinder = useCallback((binderId) => {
    setState((prev) => ({ ...prev, activeBinderId: binderId }));
  }, []);

  const addCard = useCallback(async (binderId, cardNumber) => {
    const numStr = String(cardNumber);

    // Read current binder info before async fetch
    const binder = bindersRef.current.find((b) => b.id === binderId);
    const isLorcana = binder?.gameType === 'lorcana' && binder.setCode;
    const alreadyHasImage = Boolean(binder?.cards[numStr]?.imageUrl);

    // Synchronous: increment quantity
    setState((prev) => {
      const b = prev.binders.find((b) => b.id === binderId);
      if (!b) return prev;
      const existing = b.cards[numStr];
      return {
        ...prev,
        binders: prev.binders.map((x) =>
          x.id !== binderId
            ? x
            : {
                ...x,
                cards: {
                  ...x.cards,
                  [numStr]: {
                    quantity: (existing?.quantity ?? 0) + 1,
                    exportedQuantity: existing?.exportedQuantity ?? 0,
                    imageUrl: existing?.imageUrl ?? null,
                  },
                },
              }
        ),
        addHistory: [...prev.addHistory, { cardNumber, binderId }],
      };
    });

    // Async: fetch image for Lorcana cards not yet cached
    if (isLorcana && !alreadyHasImage) {
      const imageUrl = await fetchLorcastCard(binder.setCode, cardNumber);
      if (imageUrl) {
        setState((prev) => ({
          ...prev,
          binders: prev.binders.map((x) => {
            if (x.id !== binderId) return x;
            const card = x.cards[numStr];
            if (!card) return x;
            return { ...x, cards: { ...x.cards, [numStr]: { ...card, imageUrl } } };
          }),
        }));
      }
    }
  }, []);

  const removeCard = useCallback((binderId, cardNumber) => {
    const numStr = String(cardNumber);
    setState((prev) => {
      const b = prev.binders.find((x) => x.id === binderId);
      if (!b) return prev;
      const existing = b.cards[numStr];
      if (!existing || existing.quantity <= 0) return prev;
      const newCards = { ...b.cards };
      if (existing.quantity === 1) {
        delete newCards[numStr];
      } else {
        newCards[numStr] = { ...existing, quantity: existing.quantity - 1 };
      }
      return {
        ...prev,
        binders: prev.binders.map((x) => (x.id === binderId ? { ...x, cards: newCards } : x)),
      };
    });
  }, []);

  const removeLastAdded = useCallback(() => {
    setState((prev) => {
      if (prev.addHistory.length === 0) return prev;
      const last = prev.addHistory[prev.addHistory.length - 1];
      const newHistory = prev.addHistory.slice(0, -1);
      const { binderId, cardNumber } = last;
      const numStr = String(cardNumber);
      const b = prev.binders.find((x) => x.id === binderId);
      if (!b) return { ...prev, addHistory: newHistory };
      const existing = b.cards[numStr];
      if (!existing) return { ...prev, addHistory: newHistory };
      const newCards = { ...b.cards };
      if (existing.quantity === 1) {
        delete newCards[numStr];
      } else {
        newCards[numStr] = { ...existing, quantity: existing.quantity - 1 };
      }
      return {
        ...prev,
        addHistory: newHistory,
        binders: prev.binders.map((x) => (x.id === binderId ? { ...x, cards: newCards } : x)),
      };
    });
  }, []);

  const markExported = useCallback((binderId, cardNumber, qty) => {
    const numStr = String(cardNumber);
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => {
        if (b.id !== binderId) return b;
        const card = b.cards[numStr];
        if (!card) return b;
        const newExported = Math.min(card.quantity, (card.exportedQuantity ?? 0) + qty);
        return { ...b, cards: { ...b.cards, [numStr]: { ...card, exportedQuantity: newExported } } };
      }),
    }));
  }, []);

  const unmarkExported = useCallback((binderId, cardNumber, qty) => {
    const numStr = String(cardNumber);
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => {
        if (b.id !== binderId) return b;
        const card = b.cards[numStr];
        if (!card) return b;
        const newExported = Math.max(0, (card.exportedQuantity ?? 0) - qty);
        return { ...b, cards: { ...b.cards, [numStr]: { ...card, exportedQuantity: newExported } } };
      }),
    }));
  }, []);

  /** Marks all pending quantities as exported — called automatically after CSV download. */
  const bulkMarkExported = useCallback((binderId) => {
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => {
        if (b.id !== binderId) return b;
        const newCards = Object.fromEntries(
          Object.entries(b.cards).map(([num, data]) => [
            num,
            { ...data, exportedQuantity: data.quantity },
          ])
        );
        return { ...b, cards: newCards };
      }),
    }));
  }, []);

  /** Resets all export marks to 0 for a binder. */
  const resetExports = useCallback((binderId) => {
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => {
        if (b.id !== binderId) return b;
        const newCards = Object.fromEntries(
          Object.entries(b.cards).map(([num, data]) => [
            num,
            { ...data, exportedQuantity: 0 },
          ])
        );
        return { ...b, cards: newCards };
      }),
    }));
  }, []);

  return {
    binders: state.binders,
    activeBinder,
    activeBinderId: state.activeBinderId,
    addHistory: state.addHistory,
    createBinder,
    deleteBinder,
    setActiveBinder,
    addCard,
    removeCard,
    removeLastAdded,
    markExported,
    unmarkExported,
    bulkMarkExported,
    resetExports,
  };
};
