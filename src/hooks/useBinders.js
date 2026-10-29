import { useState, useEffect, useCallback, useRef } from 'react';
import { loadState, saveState } from '../utils/storage';
import { fetchLorcastCard } from '../utils/lorcastApi';
import { getGame } from '../data/games';
import { withCounts, changeCopies } from '../utils/cards';
import { MAX_VERSIONS } from '../utils/deckRules';
import { findTagByName, nextTagColor } from '../utils/deckTags';
import { applyCardmarketEvents, applyPurchaseEvents, unlist } from '../utils/cardmarketSync';

const MAX_HISTORY = 300;

const DEFAULT_STATE = {
  binders: [],
  activeBinderId: null,
  addHistory: [],
  decks: [],
  // Tags to sort the decks, in the user's order: { id, name, color } (see utils/deckTags.js)
  deckTags: [],
  // Copies taken out of a binder for a deck: { id, deckId, binderId, cardNumber, qty }
  pulls: [],
  // Copies of a card several decks share, assigned to one of them: { [cardKey]: { [deckId]: qty } }
  allocations: {},
  // Decks built one at a time (variants of one deck), counted once in the want list: { id, deckIds }
  deckGroups: [],
  // Surplus copies put on sale, until sold and taken out: { [pocketCopyId]: { qty, at, cardmarket?, sold? } }
  // (see getPocketCopyId and utils/cardmarketSync.js)
  listings: {},
  // Copies bought, waiting for delivery (see utils/cardmarketSync.js): { [id]: { cardId, key, qty, at, status, orderId?, source } }
  purchases: {},
  // Last Cardmarket journal event applied (see utils/cardmarketSync.js): { seq, at }
  cardmarketSync: { seq: 0, at: null },
  // Pockets holding a foil and a normal copy where the foil is sold and the normal kept: { [pocketId]: true }
  sellFoil: {},
  // Collections other players shared to trade with them (see utils/tradeShare.js), plus importedAt
  // and the trade validated with them, if any: { rule, validatedAt, receive, give, found }
  partners: [],
  // Main screen: { kind: 'binder' } shows the active binder, other kinds are the collection-wide views
  view: { kind: 'binder' },
  prefs: {
    viewMode: 'spread',
    // Rarities left out of Cardmarket wants: the alternate-art printings cost far more than the set's cards
    cardmarketExcludedRarities: ['Epic', 'Enchanted', 'Iconic', 'Bonus'],
    // Copies of each card kept out of trades: 1 for a collection, 4 for a playset
    tradeKeep: 1,
    // Cards looked for in trades: the alternate arts missing from the binders, the decks' missing copies
    tradeWants: { specials: false, decks: true },
    // Name shown to the players the collection is shared with
    traderName: '',
    // Language of card names, texts and pictures: 'fr' or 'en'
    cardLanguage: 'fr',
    // Want list: the Epic / Enchanted / Iconic pockets of the binders too
    // Want list: the special rarities whose pockets are wanted too ('Epic', 'Enchanted', 'Iconic')
    wantSpecialRarities: [],
    // Deck group suggestions turned down, by signature (see getDeckSetSignature)
    dismissedDeckGroups: [],
    // Resale: surplus copies worth less than this go to the bulk lots, not sold one by one
    resaleThreshold: 0.5,
    // Resale: what a shop pays for 1,000 bulk cards, to estimate a lot
    bulkRatePerThousand: 15,
  },
};

/** Fills in fields added after the first version so older saved states keep working. */
const migrate = (state) => ({
  ...DEFAULT_STATE,
  ...state,
  prefs: {
    ...DEFAULT_STATE.prefs,
    // One switch for the three special rarities before they could be chosen one by one
    ...(state.prefs?.wantSpecials && { wantSpecialRarities: ['Epic', 'Enchanted', 'Iconic'] }),
    ...state.prefs,
  },
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

const mapDeck = (prev, deckId, fn) => ({
  ...prev,
  decks: prev.decks.map((d) => (d.id === deckId ? fn(d) : d)),
});

/** Keeps the deck's current cards as a version, oldest versions dropped past MAX_VERSIONS. */
const withVersion = (deck, label) => ({
  ...deck,
  versions: [...(deck.versions ?? []), { id: crypto.randomUUID(), at: Date.now(), label, cards: deck.cards }].slice(
    -MAX_VERSIONS
  ),
});

/** A partner without its validated trade. */
const withoutTrade = (partner) => {
  const next = { ...partner };
  delete next.trade;
  return next;
};

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
      // Ink dividers: each ink starts a new page (see getInkSections), null without them
      sections: binderData.sections ?? null,
      createdAt: Date.now(),
      cards: {},
    };
    setState((prev) => ({
      ...prev,
      binders: [...prev.binders, newBinder],
      activeBinderId: newBinder.id,
      view: { kind: 'binder' },
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
      return { ...prev, binders, activeBinderId: copy.id, view: { kind: 'binder' } };
    });
  }, []);

  /** Puts the binders in the given order of ids; binders left out of it keep their place at the end. */
  const reorderBinders = useCallback((binderIds) => {
    setState((prev) => {
      const byId = new Map(prev.binders.map((b) => [b.id, b]));
      const ordered = binderIds.map((id) => byId.get(id)).filter(Boolean);
      return { ...prev, binders: [...ordered, ...prev.binders.filter((b) => !binderIds.includes(b.id))] };
    });
  }, []);

  const setActiveBinder = useCallback((binderId) => {
    setState((prev) => ({ ...prev, activeBinderId: binderId, view: { kind: 'binder' } }));
  }, []);

  const setView = useCallback((view) => {
    setState((prev) => ({ ...prev, view }));
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

  /** Creates a deck and returns its id. data: { name, kind, format, cards, notes, source, sourceUrl } */
  const createDeck = useCallback((data) => {
    const deck = {
      id: crypto.randomUUID(),
      name: data.name?.trim() || 'Nouveau deck',
      kind: data.kind ?? 'mine',
      format: data.format ?? 'core',
      cards: data.cards ?? [],
      notes: data.notes ?? '',
      source: data.source ?? 'manual',
      sourceUrl: data.sourceUrl ?? '',
      locked: false,
      tags: data.tags ?? [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      versions: [],
    };
    setState((prev) => ({ ...prev, decks: [...prev.decks, deck] }));
    return deck.id;
  }, []);

  /** Updates a deck. With versionLabel, its current cards are kept as a version first. */
  const updateDeck = useCallback((deckId, changes, versionLabel = null) => {
    setState((prev) =>
      mapDeck(prev, deckId, (d) => ({ ...(versionLabel ? withVersion(d, versionLabel) : d), ...changes, updatedAt: Date.now() }))
    );
  }, []);

  /** Deletes a deck (its pulled cards go back to the binders) and returns what restores it. */
  const deleteDeck = useCallback((deckId) => {
    const prev = stateRef.current;
    const index = prev.decks.findIndex((d) => d.id === deckId);
    if (index === -1) return null;
    const allocations = Object.fromEntries(
      Object.entries(prev.allocations)
        .filter(([, byDeck]) => byDeck[deckId])
        .map(([key, byDeck]) => [key, byDeck[deckId]])
    );
    const snapshot = { deck: prev.decks[index], index, pulls: prev.pulls.filter((p) => p.deckId === deckId), allocations };
    setState((p) => ({
      ...p,
      decks: p.decks.filter((d) => d.id !== deckId),
      pulls: p.pulls.filter((x) => x.deckId !== deckId),
      allocations: Object.fromEntries(
        Object.entries(p.allocations).map(([key, byDeck]) => [
          key,
          Object.fromEntries(Object.entries(byDeck).filter(([id]) => id !== deckId)),
        ])
      ),
      view: p.view.deckId === deckId ? { kind: 'decks' } : p.view,
    }));
    return snapshot;
  }, []);

  const restoreDeck = useCallback(({ deck, index, pulls, allocations = {} }) => {
    setState((prev) => {
      if (prev.decks.some((d) => d.id === deck.id)) return prev;
      const decks = [...prev.decks];
      decks.splice(index, 0, deck);
      const restored = { ...prev.allocations };
      for (const [key, qty] of Object.entries(allocations)) restored[key] = { ...restored[key], [deck.id]: qty };
      return { ...prev, decks, pulls: [...prev.pulls, ...pulls], allocations: restored };
    });
  }, []);

  /**
   * Assigns copies of a card to decks: { [deckId]: qty } replaces the card's split (0 removes a
   * deck). Copies left unassigned stay shared by every deck playing the card.
   */
  const setAllocation = useCallback((key, split) => {
    setState((prev) => {
      const byDeck = Object.fromEntries(
        Object.entries({ ...prev.allocations[key], ...split }).filter(([, qty]) => qty > 0)
      );
      const allocations = { ...prev.allocations, [key]: byDeck };
      if (Object.keys(byDeck).length === 0) delete allocations[key];
      return { ...prev, allocations };
    });
  }, []);

  /** Counts decks as one built at a time: they leave their other groups for this one. Returns its id. */
  const groupDecks = useCallback((deckIds) => {
    const id = crypto.randomUUID();
    setState((prev) => ({
      ...prev,
      deckGroups: [
        ...prev.deckGroups
          .map((g) => ({ ...g, deckIds: g.deckIds.filter((d) => !deckIds.includes(d)) }))
          .filter((g) => g.deckIds.length > 1),
        { id, deckIds },
      ],
    }));
    return id;
  }, []);

  /** Splits a deck group: its decks are counted separately again. */
  const ungroupDecks = useCallback((groupId) => {
    setState((prev) => ({ ...prev, deckGroups: prev.deckGroups.filter((g) => g.id !== groupId) }));
  }, []);

  const duplicateDeck = useCallback((deckId) => {
    const source = stateRef.current.decks.find((d) => d.id === deckId);
    if (!source) return null;
    const copy = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} (copie)`,
      kind: 'mine',
      // A copy to try changes on borrows the cards, it does not lock more copies
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      versions: [],
    };
    setState((prev) => ({ ...prev, decks: [...prev.decks, copy] }));
    return copy.id;
  }, []);

  const saveDeckVersion = useCallback((deckId, label) => {
    setState((prev) => mapDeck(prev, deckId, (d) => withVersion(d, label)));
  }, []);

  /** Puts a version's cards back, keeping the current cards as a version so it can be undone. */
  const restoreDeckVersion = useCallback((deckId, versionId) => {
    setState((prev) =>
      mapDeck(prev, deckId, (d) => {
        const version = d.versions.find((v) => v.id === versionId);
        if (!version) return d;
        return { ...withVersion(d, 'Avant restauration'), cards: version.cards, updatedAt: Date.now() };
      })
    );
  }, []);

  /** Marks copies as taken out of their binder for a deck. rows: [{ binderId, cardNumber, qty }] */
  const pullCards = useCallback((deckId, rows) => {
    setState((prev) => ({
      ...prev,
      pulls: [
        ...prev.pulls,
        ...rows
          .filter((r) => r.qty > 0)
          .map((r) => ({ id: crypto.randomUUID(), deckId, binderId: r.binderId, cardNumber: String(r.cardNumber), qty: r.qty })),
      ],
    }));
  }, []);

  /** Puts a deck's cards back in their binders: all of them, or one pocket's. */
  const returnCards = useCallback((deckId, pocket = null) => {
    setState((prev) => ({
      ...prev,
      pulls: prev.pulls.filter(
        (p) =>
          p.deckId !== deckId ||
          (pocket && (p.binderId !== pocket.binderId || p.cardNumber !== String(pocket.cardNumber)))
      ),
    }));
  }, []);

  /** Creates a deck tag and returns its id, or the id of the tag already named so. */
  const createDeckTag = useCallback((name) => {
    const tags = stateRef.current.deckTags;
    const existing = findTagByName(tags, name);
    if (existing) return existing.id;
    const tag = { id: crypto.randomUUID(), name: name.trim(), color: nextTagColor(tags) };
    setState((prev) => ({ ...prev, deckTags: [...prev.deckTags, tag] }));
    return tag.id;
  }, []);

  /** Renames or recolors a tag. changes: { name?, color? } */
  const updateDeckTag = useCallback((tagId, changes) => {
    setState((prev) => ({ ...prev, deckTags: prev.deckTags.map((t) => (t.id === tagId ? { ...t, ...changes } : t)) }));
  }, []);

  /** Deletes a tag, taken off every deck, and returns what restores it. */
  const deleteDeckTag = useCallback((tagId) => {
    const prev = stateRef.current;
    const index = prev.deckTags.findIndex((t) => t.id === tagId);
    if (index === -1) return null;
    const snapshot = { tag: prev.deckTags[index], index, deckIds: prev.decks.filter((d) => d.tags?.includes(tagId)).map((d) => d.id) };
    setState((p) => ({
      ...p,
      deckTags: p.deckTags.filter((t) => t.id !== tagId),
      decks: p.decks.map((d) => (d.tags?.includes(tagId) ? { ...d, tags: d.tags.filter((id) => id !== tagId) } : d)),
    }));
    return snapshot;
  }, []);

  const restoreDeckTag = useCallback(({ tag, index, deckIds }) => {
    setState((prev) => {
      if (prev.deckTags.some((t) => t.id === tag.id)) return prev;
      const deckTags = [...prev.deckTags];
      deckTags.splice(index, 0, tag);
      return {
        ...prev,
        deckTags,
        decks: prev.decks.map((d) => (deckIds.includes(d.id) ? { ...d, tags: [...(d.tags ?? []), tag.id] } : d)),
      };
    });
  }, []);

  /** Moves a tag one place up (-1) or down (1) in the tag list, the order of the filters. */
  const moveDeckTag = useCallback((tagId, direction) => {
    setState((prev) => {
      const index = prev.deckTags.findIndex((t) => t.id === tagId);
      const target = index + direction;
      if (index === -1 || target < 0 || target >= prev.deckTags.length) return prev;
      const deckTags = [...prev.deckTags];
      [deckTags[index], deckTags[target]] = [deckTags[target], deckTags[index]];
      return { ...prev, deckTags };
    });
  }, []);

  /** Stores a collection another player shared, replacing the previous one of the same player. Returns its id. */
  const savePartner = useCallback((share) => {
    const same = (p) => p.owner.toLowerCase() === share.owner.toLowerCase();
    const existing = stateRef.current.partners.find(same);
    const id = existing?.id ?? crypto.randomUUID();
    // A newer file of the same player keeps the trade validated with them
    const partner = { ...share, id, importedAt: Date.now(), ...(existing?.trade && { trade: existing.trade }) };
    setState((prev) => ({
      ...prev,
      partners: prev.partners.some(same) ? prev.partners.map((p) => (same(p) ? partner : p)) : [...prev.partners, partner],
    }));
    return id;
  }, []);

  /** Forgets a player's collection and returns what restores it. */
  const deletePartner = useCallback((partnerId) => {
    const index = stateRef.current.partners.findIndex((p) => p.id === partnerId);
    if (index === -1) return null;
    const snapshot = { partner: stateRef.current.partners[index], index };
    setState((prev) => ({ ...prev, partners: prev.partners.filter((p) => p.id !== partnerId) }));
    return snapshot;
  }, []);

  const restorePartner = useCallback(({ partner, index }) => {
    setState((prev) => {
      if (prev.partners.some((p) => p.id === partner.id)) return prev;
      const partners = [...prev.partners];
      partners.splice(index, 0, partner);
      return { ...prev, partners };
    });
  }, []);

  /** Validates (or with null, drops) the trade with a player. changes merge into the validated trade. */
  const setPartnerTrade = useCallback((partnerId, trade, merge = false) => {
    setState((prev) => ({
      ...prev,
      partners: prev.partners.map((p) => {
        if (p.id !== partnerId) return p;
        if (!trade) return withoutTrade(p);
        return { ...p, trade: merge ? { ...p.trade, ...trade } : { validatedAt: Date.now(), ...trade } };
      }),
    }));
  }, []);

  /**
   * Applies a done trade to the binders: removes the given copies, adds the received ones, and
   * drops the validated trade. Returns what undoes it.
   * @param {{ remove: { binderId, cardNumber, foil, qty }[], add: { binderId, cardNumber, foil, qty }[] }} moves
   */
  const completePartnerTrade = useCallback((partnerId, { remove, add }) => {
    const prev = stateRef.current;
    const touched = new Set([...remove, ...add].map((m) => m.binderId));
    const snapshot = {
      binders: prev.binders.filter((b) => touched.has(b.id)).map((b) => ({ id: b.id, cards: b.cards })),
      partner: prev.partners.find((p) => p.id === partnerId) ?? null,
    };
    setState((state) => {
      const binders = state.binders.map((b) => {
        if (!touched.has(b.id)) return b;
        let cards = b.cards;
        for (const m of remove) if (m.binderId === b.id) cards = changeCopies(cards, String(m.cardNumber), -m.qty, m.foil);
        for (const m of add) if (m.binderId === b.id) cards = changeCopies(cards, String(m.cardNumber), m.qty, m.foil);
        return { ...b, cards };
      });
      const partners = state.partners.map((p) => (p.id === partnerId ? withoutTrade(p) : p));
      return { ...state, binders, partners };
    });
    return snapshot;
  }, []);

  const undoPartnerTrade = useCallback(({ binders: saved, partner }) => {
    const cardsOf = new Map(saved.map((b) => [b.id, b.cards]));
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => (cardsOf.has(b.id) ? { ...b, cards: cardsOf.get(b.id) } : b)),
      partners: partner ? prev.partners.map((p) => (p.id === partner.id ? partner : p)) : prev.partners,
    }));
  }, []);

  /** Puts surplus copies on sale. items: [{ id, qty }] with pocket copy ids, qty added to what is listed. */
  const listForSale = useCallback((items) => {
    setState((prev) => {
      const listings = { ...prev.listings };
      for (const { id, qty } of items) if (qty > 0) listings[id] = { ...listings[id], qty: (listings[id]?.qty ?? 0) + qty, at: Date.now() };
      return { ...prev, listings };
    });
  }, []);

  /** Chooses which copy stays in a pocket holding both: the normal one (foil sold) or the foil. */
  const setSellFoil = useCallback((pocketId, sell) => {
    setState((prev) => {
      const sellFoil = { ...prev.sellFoil };
      if (sell) sellFoil[pocketId] = true;
      else delete sellFoil[pocketId];
      return { ...prev, sellFoil };
    });
  }, []);

  /** Takes copies off sale: all the copies of the given pocket copy ids (kept until removed from Cardmarket). */
  const unlistForSale = useCallback((ids) => {
    setState((prev) => ({ ...prev, listings: unlist(prev.listings, ids) }));
  }, []);

  /** Notes copies as bought, waiting for delivery. items: [{ cardId, key, qty }]. Returns the purchase ids. */
  const markBought = useCallback((items) => {
    const added = Object.fromEntries(
      items
        .filter((i) => i.qty > 0)
        .map(({ cardId, key, qty }) => [crypto.randomUUID(), { cardId, key, qty, at: Date.now(), status: 'ordered', orderId: null, source: 'manual' }])
    );
    setState((prev) => ({ ...prev, purchases: { ...prev.purchases, ...added } }));
    return Object.keys(added);
  }, []);

  /** Forgets purchases (cancelled, or bought by mistake). Returns what restores them. */
  const cancelPurchases = useCallback((ids) => {
    const removed = Object.fromEntries(ids.filter((id) => stateRef.current.purchases[id]).map((id) => [id, stateRef.current.purchases[id]]));
    setState((prev) => ({ ...prev, purchases: Object.fromEntries(Object.entries(prev.purchases).filter(([id]) => !ids.includes(id))) }));
    return removed;
  }, []);

  /**
   * Puts received copies in their pockets and closes their purchases. Returns what undoes it.
   * @param {{ id: string, binderId: string|null, cardNumber: string, qty: number }[]} items binderId null
   *   when no binder holds the card's chapter: the purchase is closed, the copies kept aside
   */
  const receivePurchases = useCallback((items) => {
    const prev = stateRef.current;
    const touched = new Set(items.map((i) => i.binderId).filter(Boolean));
    const snapshot = {
      binders: prev.binders.filter((b) => touched.has(b.id)).map((b) => ({ id: b.id, cards: b.cards })),
      purchases: prev.purchases,
    };
    setState((state) => {
      const ids = new Set(items.map((i) => i.id));
      const binders = state.binders.map((b) => {
        if (!touched.has(b.id)) return b;
        let cards = b.cards;
        for (const i of items) if (i.binderId === b.id) cards = changeCopies(cards, String(i.cardNumber), i.qty, false);
        return { ...b, cards };
      });
      return { ...state, binders, purchases: Object.fromEntries(Object.entries(state.purchases).filter(([id]) => !ids.has(id))) };
    });
    return snapshot;
  }, []);

  const undoReceive = useCallback(({ binders: saved, purchases }) => {
    const cardsOf = new Map(saved.map((b) => [b.id, b.cards]));
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => (cardsOf.has(b.id) ? { ...b, cards: cardsOf.get(b.id) } : b)),
      purchases,
    }));
  }, []);

  const restorePurchases = useCallback((removed) => {
    setState((prev) => ({ ...prev, purchases: { ...prev.purchases, ...removed } }));
  }, []);

  /** Applies the Cardmarket journal events not applied yet. Returns how many were. */
  const applyCardmarketJournal = useCallback((events) => {
    const fresh = events.filter((e) => e.seq > (stateRef.current.cardmarketSync?.seq ?? 0));
    if (fresh.length === 0) return 0;
    setState((prev) => {
      const pending = fresh.filter((e) => e.seq > (prev.cardmarketSync?.seq ?? 0));
      if (pending.length === 0) return prev;
      return {
        ...prev,
        listings: applyCardmarketEvents(prev.listings, pending),
        purchases: applyPurchaseEvents(prev.purchases, pending),
        cardmarketSync: { seq: Math.max(...pending.map((e) => e.seq)), at: Math.max(...pending.map((e) => e.at)) },
      };
    });
    return fresh.length;
  }, []);

  /**
   * Takes sold or lotted copies out of the binders, and off sale. Returns what undoes it.
   * @param {{ id, binderId, cardNumber, foil, qty }[]} moves id: pocket copy id
   */
  const removeCopies = useCallback((moves) => {
    const prev = stateRef.current;
    const touched = new Set(moves.map((m) => m.binderId));
    const snapshot = {
      binders: prev.binders.filter((b) => touched.has(b.id)).map((b) => ({ id: b.id, cards: b.cards })),
      listings: prev.listings,
    };
    setState((state) => {
      const listings = { ...state.listings };
      for (const m of moves) {
        const listing = listings[m.id];
        if (!listing) continue;
        // Sold copies leave first; what Cardmarket still shows stays to remove there
        const qty = Math.max(0, listing.qty - m.qty);
        const sold = Math.max(0, (listing.sold ?? 0) - m.qty);
        if (qty > 0 || sold > 0 || (listing.cardmarket?.qty ?? 0) > 0) listings[m.id] = { ...listing, qty, sold };
        else delete listings[m.id];
      }
      const binders = state.binders.map((b) => {
        if (!touched.has(b.id)) return b;
        let cards = b.cards;
        for (const m of moves) if (m.binderId === b.id) cards = changeCopies(cards, String(m.cardNumber), -m.qty, m.foil);
        return { ...b, cards };
      });
      return { ...state, binders, listings };
    });
    return snapshot;
  }, []);

  const restoreCopies = useCallback(({ binders: saved, listings }) => {
    const cardsOf = new Map(saved.map((b) => [b.id, b.cards]));
    setState((prev) => ({
      ...prev,
      binders: prev.binders.map((b) => (cardsOf.has(b.id) ? { ...b, cards: cardsOf.get(b.id) } : b)),
      listings,
    }));
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
    decks: state.decks,
    deckTags: state.deckTags,
    pulls: state.pulls,
    allocations: state.allocations,
    deckGroups: state.deckGroups,
    listings: state.listings,
    sellFoil: state.sellFoil,
    cardmarketSync: state.cardmarketSync,
    purchases: state.purchases,
    partners: state.partners,
    setPartnerTrade,
    completePartnerTrade,
    undoPartnerTrade,
    view: state.view,
    state,
    createBinder,
    updateBinder,
    deleteBinder,
    restoreBinder,
    duplicateBinder,
    reorderBinders,
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
    setView,
    createDeck,
    updateDeck,
    deleteDeck,
    restoreDeck,
    duplicateDeck,
    saveDeckVersion,
    restoreDeckVersion,
    pullCards,
    returnCards,
    setAllocation,
    groupDecks,
    ungroupDecks,
    listForSale,
    unlistForSale,
    setSellFoil,
    applyCardmarketJournal,
    markBought,
    cancelPurchases,
    restorePurchases,
    receivePurchases,
    undoReceive,
    removeCopies,
    restoreCopies,
    createDeckTag,
    updateDeckTag,
    deleteDeckTag,
    restoreDeckTag,
    moveDeckTag,
    savePartner,
    deletePartner,
    restorePartner,
  };
};
