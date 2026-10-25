import { findPocketCard } from './catalog.js';
import { getCounts } from './cards.js';
import { getLocation, getPockets, getPositionInPage } from './calculations.js';

/**
 * Cards pulled out of a binder for a deck: { id, deckId, binderId, cardNumber, qty }.
 * The copies stay owned (counted in the binder), they are only physically elsewhere.
 */
export const getPulledCount = (pulls, binderId, cardNumber, deckId = null) =>
  pulls
    .filter((p) => p.binderId === binderId && p.cardNumber === String(cardNumber) && (!deckId || p.deckId === deckId))
    .reduce((s, p) => s + p.qty, 0);

/**
 * Owned Lorcana cards across the given binders, grouped by full name (deck rules count copies by
 * full name, and the same card can be reprinted in several chapters or sit in two binders).
 *
 * @returns {{ entries: Map<string, { key, card, normal, foil, total, pulled, copies: object[] }>, unknown: object[] }}
 *   copies: one per binder pocket { card, binder, cardNumber, normal, foil, pulled, location };
 *   unknown: pockets with no matching catalog card (catalog not loaded yet, or unknown number)
 */
export const buildCollection = (binders, index, pulls = []) => {
  const entries = new Map();
  const unknown = [];
  for (const binder of binders) {
    if (binder.gameType !== 'lorcana' || !binder.setCode) continue;
    for (const [cardNumber, data] of Object.entries(binder.cards)) {
      const { normal, foil } = getCounts(data);
      if (normal + foil === 0) continue;
      const card = index ? findPocketCard(index, binder.setCode, cardNumber) : null;
      if (!card) {
        unknown.push({ binder, cardNumber, normal, foil });
        continue;
      }
      const pulled = getPulledCount(pulls, binder.id, cardNumber);
      const copy = {
        card,
        binder,
        cardNumber,
        normal,
        foil,
        pulled,
        location: getLocation(parseInt(cardNumber, 10), binder),
      };
      const entry = entries.get(card.key) ?? { key: card.key, card, normal: 0, foil: 0, total: 0, pulled: 0, copies: [] };
      entry.normal += normal;
      entry.foil += foil;
      entry.total += normal + foil;
      entry.pulled += pulled;
      entry.copies.push(copy);
      entries.set(card.key, entry);
    }
  }
  return { entries, unknown };
};

export const getOwned = (collection, key) => collection.entries.get(key)?.total ?? 0;

/** Copies of a card that each deck of the user uses: { [key]: [{ deck, qty }] }. */
export const getDeckUsage = (decks) => {
  const usage = new Map();
  for (const deck of decks) {
    if (deck.kind === 'reference') continue;
    for (const entry of deck.cards) {
      usage.set(entry.key, [...(usage.get(entry.key) ?? []), { deck, qty: entry.qty }]);
    }
  }
  return usage;
};

/**
 * How the owned copies of each card are split between the user's decks.
 *
 * allocations: { [key]: { [deckId]: qty } }, the copies the user assigned to a deck. They are
 * capped by what the deck plays and by the copies owned (decks in list order). Unassigned copies
 * stay shared: every deck playing the card counts them. So a deck can use its assigned copies
 * plus the shared ones: owned minus the copies assigned to the other decks.
 *
 * @returns {{
 *   availableFor: (deckId: string|null, key: string) => number,
 *   shared: { key, name, owned, needed, free, contested, decks: { deck, qty, assigned, available, missing }[] }[]
 * }} shared: cards several decks play with fewer copies owned than they need together;
 *   contested while shared copies are still disputed (the user has not split them yet)
 */
export const getCopyAllocation = (decks, collection, allocations = {}) => {
  const assigned = new Map();
  const shared = [];
  for (const [key, uses] of getDeckUsage(decks)) {
    const owned = getOwned(collection, key);
    let free = owned;
    const byDeck = new Map();
    for (const { deck, qty } of uses) {
      const copies = Math.max(0, Math.min(allocations[key]?.[deck.id] ?? 0, qty, free));
      if (copies) byDeck.set(deck.id, copies);
      free -= copies;
    }
    if (byDeck.size) assigned.set(key, byDeck);

    const needed = uses.reduce((s, u) => s + u.qty, 0);
    if (uses.length < 2 || needed <= owned || owned === 0) continue;
    const split = uses.map(({ deck, qty }) => {
      const mine = byDeck.get(deck.id) ?? 0;
      return { deck, qty, assigned: mine, available: mine + free, missing: Math.max(0, qty - mine - free) };
    });
    shared.push({
      key,
      name: uses[0].deck.cards.find((c) => c.key === key)?.name ?? key,
      owned,
      needed,
      free,
      contested: free > 0 && split.filter((d) => d.qty > d.assigned).length > 1,
      decks: split,
    });
  }

  const availableFor = (deckId, key) => {
    let others = 0;
    for (const [id, copies] of assigned.get(key) ?? []) if (id !== deckId) others += copies;
    return getOwned(collection, key) - others;
  };
  return { availableFor, shared };
};

/** Cards several decks still dispute: fewer copies owned than needed, not split by the user yet. */
export const getSharedCopyConflicts = (decks, collection, allocations = {}) =>
  getCopyAllocation(decks, collection, allocations).shared.filter((c) => c.contested);

/**
 * Where to fetch each card of a deck in the binders, ordered so each binder is browsed once,
 * front to back. Copies already pulled for this deck are skipped; copies pulled for another deck
 * are not available, nor the copies assigned to another deck (availableFor, see getCopyAllocation).
 *
 * @returns {{ rows: { key, card, binder, cardNumber, location, take, position }[], short: { key, name, missing }[] }}
 */
export const getPullList = (deck, collection, pulls, binders, availableFor = null) => {
  const rows = [];
  const short = [];
  for (const entry of deck.cards) {
    const owned = collection.entries.get(entry.key);
    const alreadyPulled = (owned?.copies ?? []).reduce(
      (s, c) => s + getPulledCount(pulls, c.binder.id, c.cardNumber, deck.id),
      0
    );
    const wanted = availableFor ? Math.min(entry.qty, Math.max(0, availableFor(deck.id, entry.key))) : entry.qty;
    let needed = wanted - alreadyPulled;
    if (needed <= 0) {
      if (wanted < entry.qty) short.push({ key: entry.key, name: entry.name, missing: entry.qty - Math.max(wanted, alreadyPulled) });
      continue;
    }
    // The printing chosen in the deck first, then the others
    const copies = [...(owned?.copies ?? [])].sort((a, b) => (b.card.id === entry.id) - (a.card.id === entry.id));
    for (const copy of copies) {
      if (needed <= 0) break;
      const available = copy.normal + copy.foil - copy.pulled;
      const take = Math.min(available, needed);
      if (take <= 0) continue;
      needed -= take;
      rows.push({
        key: entry.key,
        card: copy.card,
        binder: copy.binder,
        cardNumber: copy.cardNumber,
        location: copy.location,
        take,
        position: getPositionInPage(parseInt(copy.cardNumber, 10), getPockets(copy.binder.gridRows, copy.binder.gridCols)),
      });
    }
    const missing = needed + entry.qty - wanted;
    if (missing > 0) short.push({ key: entry.key, name: entry.name, missing });
  }
  const binderOrder = new Map(binders.map((b, i) => [b.id, i]));
  rows.sort(
    (a, b) =>
      binderOrder.get(a.binder.id) - binderOrder.get(b.binder.id) ||
      a.location.page - b.location.page ||
      a.position - b.position
  );
  return { rows, short };
};

/** Pockets of a binder holding cards pulled for decks: { [cardNumber]: [{ deckId, qty }] }. */
export const getBinderPulls = (pulls, binderId) => {
  const map = {};
  for (const p of pulls) {
    if (p.binderId !== binderId) continue;
    (map[p.cardNumber] ??= []).push(p);
  }
  return map;
};
