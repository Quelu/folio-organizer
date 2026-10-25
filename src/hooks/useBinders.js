import { useState, useEffect, useCallback, useRef } from 'react';
import { loadState, saveState } from '../utils/storage';
import { fetchLorcastCard } from '../utils/lorcastApi';
import { getGame } from '../data/games';
import { withCounts, changeCopies } from '../utils/cards';

const MAX_HISTORY = 300;

const DEFAULT_STATE = {
  binders: [],
  activeBinderId: null,
  addHistory: [],
  // Rarities left out of Cardmarket wants: the alternate-art printings cost far more than the set's cards
  prefs: { viewMode: 'spread', cardmarketExcludedRarities: ['Epic', 'Enchanted', 'Iconic', 'Bonus'] },
};

/** Fills in fields added after the first version so older saved states keep working. */
const migrate = (state) => ({
  ...DEFAULT_STATE,
  ...state,
  prefs: { ...DEFAULT_STATE.prefs, ...state.prefs },
  binders: (state.binders ?? []).map((b) => ({
    setSize: getGame(b.gameType).defaultSetSize,
    createdAt: Date.now(),
    ...b,
  })),
});

const mapBinder = (prev, binderId, fn) => ({
  ...prev,
  binders: prev.binders.map((b) => (b.id === binderId ? fn(b) : b)),
});

export const useBinders = () => {
  const [state, setState] = useState(() => {
    const saved = loadState();
    return saved ? migrate(saved) : DEFAULT_STATE;
  });

  // Keep a ref to the current state for async callbacks and synchronous reads
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    saveState(state);
  }, [state]);

  const activeBinder = state.binders.find((b) => b.id === state.activeBinderId) ?? null;

  const createBinder = useCallback((binderData) => {
    const newBinder = {
      id: crypto.randomUUID(),
      name: binderData.name.trim(),
      gameType: binderData.gameType,
      setCode: binderData.setCode ?? '',
      setSize: binderData.setSize ?? null,
      gridCols: binderData.gridCols ?? 3,
      gridRows: binderData.gridRows ?? 3,
      createdAt: Date.now(),
      cards: {},
    };
    setState((prev) => ({
      ...prev,
      binders: [...prev.binders, newBinder],
      activeBinderId: newBinder.id,
    }));
  }, []);

  const updateBinder = useCallback((binderId, changes) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => {
        const next = { ...b, ...changes, name: (changes.name ?? b.name).trim() };
        // Images depend on the set: drop them so they are re-fetched for the new set
        if (next.setCode !== b.setCode || next.gameType !== b.gameType) {
          next.cards = Object.fromEntries(
            Object.entries(b.cards).map(([num, c]) => [num, { ...c, imageUrl: null }])
          );
        }
        return next;
      })
    );
  }, []);

  /** Deletes a binder and returns what is needed to restore it. */
  const deleteBinder = useCallback((binderId) => {
    const prev = stateRef.current;
    const index = prev.binders.findIndex((b) => b.id === binderId);
    if (index === -1) return null;
    const snapshot = { binder: prev.binders[index], index, wasActive: prev.activeBinderId === binderId };
    setState((p) => {
      const binders = p.binders.filter((b) => b.id !== binderId);
      return {
        ...p,
        binders,
        activeBinderId:
          p.activeBinderId === binderId
            ? (binders[Math.min(index, binders.length - 1)]?.id ?? null)
            : p.activeBinderId,
      };
    });
    return snapshot;
  }, []);

  const restoreBinder = useCallback(({ binder, index, wasActive }) => {
    setState((prev) => {
      if (prev.binders.some((b) => b.id === binder.id)) return prev;
      const binders = [...prev.binders];
      binders.splice(index, 0, binder);
      return { ...prev, binders, activeBinderId: wasActive ? binder.id : prev.activeBinderId };
    });
  }, []);

  const duplicateBinder = useCallback((binderId) => {
    setState((prev) => {
      const source = prev.binders.find((b) => b.id === binderId);
      if (!source) return prev;
      const copy = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} (copie)`,
        createdAt: Date.now(),
        cards: {},
      };
      const index = prev.binders.indexOf(source) + 1;
      const binders = [...prev.binders];
      binders.splice(index, 0, copy);
      return { ...prev, binders, activeBinderId: copy.id };
    });
  }, []);

  const setActiveBinder = useCallback((binderId) => {
    setState((prev) => ({ ...prev, activeBinderId: binderId }));
  }, []);

  /** Adds one or several cards at once. entries: [{ cardNumber, qty }] */
  const addCards = useCallback((binderId, entries) => {
    setState((prev) => {
      const b = prev.binders.find((x) => x.id === binderId);
      if (!b) return prev;
      let cards = b.cards;
      for (const { cardNumber, qty, foil } of entries) {
        cards = changeCopies(cards, String(cardNumber), qty, foil);
      }
      const history = [
        ...prev.addHistory,
        ...entries.map(({ cardNumber, qty, foil }) => ({
          binderId,
          cardNumber,
          qty,
          foil: Boolean(foil),
          at: Date.now(),
        })),
      ].slice(-MAX_HISTORY);
      return { ...mapBinder(prev, binderId, (x) => ({ ...x, cards })), addHistory: history };
    });
  }, []);

  /** Sets the exact number of normal and foil copies of a card. */
  const setCardCounts = useCallback((binderId, cardNumber, { normal, foil }) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => ({
        ...b,
        cards: withCounts(b.cards, String(cardNumber), normal, foil),
      }))
    );
  }, []);

  /** Removes one copy, foil first when preferFoil is set, normal first otherwise. */
  const removeCard = useCallback((binderId, cardNumber, preferFoil = false) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => {
        const numStr = String(cardNumber);
        if (!b.cards[numStr]) return b;
        return { ...b, cards: changeCopies(b.cards, numStr, -1, preferFoil) };
      })
    );
  }, []);

  /** Undoes the last addition made in the given binder. Returns the undone entry (or null). */
  const removeLastAdded = useCallback((binderId) => {
    const history = stateRef.current.addHistory;
    let idx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].binderId === binderId) {
        idx = i;
        break;
      }
    }
    if (idx === -1) return null;
    const entry = { qty: 1, ...history[idx] };
    setState((prev) => {
      const addHistory = prev.addHistory.filter((_, i) => i !== idx);
      return {
        ...mapBinder(prev, binderId, (b) => {
          const numStr = String(entry.cardNumber);
          if (!b.cards[numStr]) return b;
          return { ...b, cards: changeCopies(b.cards, numStr, -entry.qty, entry.foil) };
        }),
        addHistory,
      };
    });
    return entry;
  }, []);

  /**
   * Fetches missing Lorcana images for the given card numbers. The caller passes the set it is
   * rendering: stateRef is only synced after render, so it can still miss a card just added.
   */
  const hydrateImages = useCallback(async (binderId, setCode, cardNumbers) => {
    if (!setCode) return;
    await Promise.all(
      cardNumbers.map(async (cardNumber) => {
        const imageUrl = await fetchLorcastCard(setCode, cardNumber);
        if (!imageUrl) return;
        setState((prev) =>
          mapBinder(prev, binderId, (b) => {
            const numStr = String(cardNumber);
            const card = b.cards[numStr];
            if (!card || card.imageUrl || b.gameType !== 'lorcana' || b.setCode !== setCode) return b;
            return { ...b, cards: { ...b.cards, [numStr]: { ...card, imageUrl } } };
          })
        );
      })
    );
  }, []);

  /** Marks all pending quantities as exported — called automatically after CSV download. */
  const bulkMarkExported = useCallback((binderId) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => ({
        ...b,
        cards: Object.fromEntries(
          Object.entries(b.cards).map(([num, data]) => [
            num,
            { ...data, exportedQuantity: data.quantity, exportedFoil: data.foil ?? 0 },
          ])
        ),
      }))
    );
  }, []);

  /** Resets all export marks to 0 for a binder. */
  const resetExports = useCallback((binderId) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => ({
        ...b,
        cards: Object.fromEntries(
          Object.entries(b.cards).map(([num, data]) => [num, { ...data, exportedQuantity: 0, exportedFoil: 0 }])
        ),
      }))
    );
  }, []);

  const setPref = useCallback((key, value) => {
    setState((prev) => ({ ...prev, prefs: { ...prev.prefs, [key]: value } }));
  }, []);

  /** Replaces the whole state with an imported backup. Throws if the file is not a backup. */
  const importState = useCallback((data) => {
    if (!data || !Array.isArray(data.binders)) throw new Error('Fichier de sauvegarde invalide');
    setState(migrate(data));
  }, []);

  return {
    binders: state.binders,
    activeBinder,
    addHistory: state.addHistory,
    prefs: state.prefs,
    state,
    createBinder,
    updateBinder,
    deleteBinder,
    restoreBinder,
    duplicateBinder,
    setActiveBinder,
    addCards,
    setCardCounts,
    removeCard,
    removeLastAdded,
    hydrateImages,
    bulkMarkExported,
    resetExports,
    setPref,
    importState,
  };
};
