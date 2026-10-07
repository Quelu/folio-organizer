import { useState, useEffect, useCallback, useRef } from 'react';
import { loadState, saveState } from '../utils/storage';
import { fetchLorcastCard } from '../utils/lorcastApi';
import { getGame } from '../data/games';

const MAX_HISTORY = 300;

const DEFAULT_STATE = {
  binders: [],
  activeBinderId: null,
  addHistory: [],
  prefs: { viewMode: 'spread' },
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

/** Applies a quantity change to a card, keeping exportedQuantity consistent. */
const withQuantity = (cards, numStr, quantity) => {
  const next = { ...cards };
  if (quantity <= 0) {
    delete next[numStr];
    return next;
  }
  const existing = cards[numStr];
  next[numStr] = {
    quantity,
    exportedQuantity: Math.min(existing?.exportedQuantity ?? 0, quantity),
    imageUrl: existing?.imageUrl ?? null,
  };
  return next;
};

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
      for (const { cardNumber, qty } of entries) {
        const numStr = String(cardNumber);
        cards = withQuantity(cards, numStr, (cards[numStr]?.quantity ?? 0) + qty);
      }
      const history = [
        ...prev.addHistory,
        ...entries.map(({ cardNumber, qty }) => ({ binderId, cardNumber, qty, at: Date.now() })),
      ].slice(-MAX_HISTORY);
      return { ...mapBinder(prev, binderId, (x) => ({ ...x, cards })), addHistory: history };
    });
  }, []);

  const setCardQuantity = useCallback((binderId, cardNumber, quantity) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => ({
        ...b,
        cards: withQuantity(b.cards, String(cardNumber), quantity),
      }))
    );
  }, []);

  const removeCard = useCallback((binderId, cardNumber) => {
    setState((prev) =>
      mapBinder(prev, binderId, (b) => {
        const numStr = String(cardNumber);
        const existing = b.cards[numStr];
        if (!existing) return b;
        return { ...b, cards: withQuantity(b.cards, numStr, existing.quantity - 1) };
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
          const existing = b.cards[numStr];
          if (!existing) return b;
          return { ...b, cards: withQuantity(b.cards, numStr, existing.quantity - entry.qty) };
        }),
        addHistory,
      };
    });
    return entry;
  }, []);

  /** Fetches missing Lorcana images for the given card numbers. */
  const hydrateImages = useCallback(async (binderId, cardNumbers) => {
    const binder = stateRef.current.binders.find((b) => b.id === binderId);
    if (!binder || binder.gameType !== 'lorcana' || !binder.setCode) return;
    const missing = cardNumbers.filter((n) => binder.cards[String(n)] && !binder.cards[String(n)].imageUrl);
    await Promise.all(
      missing.map(async (cardNumber) => {
        const imageUrl = await fetchLorcastCard(binder.setCode, cardNumber);
        if (!imageUrl) return;
        setState((prev) =>
          mapBinder(prev, binderId, (b) => {
            const numStr = String(cardNumber);
            const card = b.cards[numStr];
            if (!card || card.imageUrl || b.setCode !== binder.setCode) return b;
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
          Object.entries(b.cards).map(([num, data]) => [num, { ...data, exportedQuantity: data.quantity }])
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
          Object.entries(b.cards).map(([num, data]) => [num, { ...data, exportedQuantity: 0 }])
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
    setCardQuantity,
    removeCard,
    removeLastAdded,
    hydrateImages,
    bulkMarkExported,
    resetExports,
    setPref,
    importState,
  };
};
