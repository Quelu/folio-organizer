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
 * Cards several decks share with fewer copies owned than they need together.
 * @returns {{ key, name, owned, needed, decks: { deck, qty }[] }[]}
 */
export const getSharedCopyConflicts = (decks, collection) =>
  [...getDeckUsage(decks).entries()]
    .map(([key, uses]) => ({
      key,
      name: uses[0].deck.cards.find((c) => c.key === key)?.name ?? key,
      owned: getOwned(collection, key),
      needed: uses.reduce((s, u) => s + u.qty, 0),
      decks: uses,
    }))
    .filter((c) => c.decks.length > 1 && c.needed > c.owned && c.owned > 0);

/**
 * Where to fetch each card of a deck in the binders, ordered so each binder is browsed once,
 * front to back. Copies already pulled for this deck are skipped; copies pulled for another deck
 * are not available.
 *
 * @returns {{ rows: { key, card, binder, cardNumber, location, take, position }[], short: { key, name, missing }[] }}
 */
export const getPullList = (deck, collection, pulls, binders) => {
  const rows = [];
  const short = [];
  for (const entry of deck.cards) {
    const owned = collection.entries.get(entry.key);
    const alreadyPulled = (owned?.copies ?? []).reduce(
      (s, c) => s + getPulledCount(pulls, c.binder.id, c.cardNumber, deck.id),
      0
    );
    let needed = entry.qty - alreadyPulled;
    if (needed <= 0) continue;
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
    if (needed > 0) short.push({ key: entry.key, name: entry.name, missing: needed });
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
