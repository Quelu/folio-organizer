import { getMainPrinting, baseNumber } from './catalog.js';
import { getDeckUsage, getOwned } from './collection.js';
import { getBinderMissing } from './trades.js';

/**
 * Deck groups: decks the user builds one at a time (variants of the same deck), { id, deckIds }.
 * A group needs, for each card, the most copies one of its decks plays, not the sum. Locked decks
 * keep their own copies, so they never join a group.
 */

/** Share of a deck's cards another deck plays too, on the smaller of the two. */
const OVERLAP_THRESHOLD = 0.6;

/** Order-independent id of a set of decks, to remember a dismissed suggestion. */
export const getDeckSetSignature = (deckIds) => [...deckIds].sort().join('+');

/**
 * The units the decks need copies for: each locked deck alone, each group of the user's decks
 * built one at a time, and every other deck alone. Reference decks and empty decks are left out.
 * @returns {{ id: string, decks: object[], locked: boolean, grouped: boolean }[]} in deck list order
 */
export const getDeckUnits = (decks, groups = []) => {
  const playable = decks.filter((d) => d.kind !== 'reference' && d.cards.length > 0);
  const byId = new Map(playable.map((d) => [d.id, d]));
  const groupOf = new Map();
  for (const group of groups) {
    const members = group.deckIds.map((id) => byId.get(id)).filter((d) => d && !d.locked && !groupOf.has(d.id));
    // A group left with one deck (the others deleted or locked) is that deck alone
    if (members.length < 2) continue;
    const unit = { id: group.id, decks: members, locked: false, grouped: true };
    for (const d of members) groupOf.set(d.id, unit);
  }
  const units = [];
  const seen = new Set();
  for (const deck of playable) {
    const unit = groupOf.get(deck.id) ?? { id: deck.id, decks: [deck], locked: Boolean(deck.locked), grouped: false };
    if (seen.has(unit.id)) continue;
    seen.add(unit.id);
    units.push(unit);
  }
  return units;
};

/**
 * Decks that look like variants of one another (most of their cards in common) and are not
 * grouped yet: clusters Folio suggests counting as one deck built at a time.
 * @param {string[]} dismissed signatures of the suggestions the user turned down
 * @returns {{ deckIds: string[], decks: object[], overlap: number }[]} overlap: the lowest between two of them
 */
export const suggestDeckGroups = (decks, groups = [], dismissed = []) => {
  const units = getDeckUnits(decks, groups);
  const candidates = units.filter((u) => !u.locked);
  const qtyOf = (unit) => {
    const map = new Map();
    for (const deck of unit.decks) for (const c of deck.cards) map.set(c.key, Math.max(map.get(c.key) ?? 0, c.qty));
    return map;
  };
  const cards = new Map(candidates.map((u) => [u.id, qtyOf(u)]));
  const size = (map) => [...map.values()].reduce((s, q) => s + q, 0);

  // Clusters of units linked by a strong overlap (union-find)
  const parent = new Map(candidates.map((u) => [u.id, u.id]));
  const find = (id) => (parent.get(id) === id ? id : find(parent.get(id)));
  const overlapOf = new Map();
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = cards.get(candidates[i].id);
      const b = cards.get(candidates[j].id);
      let common = 0;
      for (const [key, qty] of a) common += Math.min(qty, b.get(key) ?? 0);
      const overlap = common / Math.max(1, Math.min(size(a), size(b)));
      if (overlap < OVERLAP_THRESHOLD) continue;
      const root = find(candidates[i].id);
      parent.set(find(candidates[j].id), root);
      overlapOf.set(`${candidates[i].id}|${candidates[j].id}`, overlap);
    }
  }
  const clusters = new Map();
  for (const unit of candidates) clusters.set(find(unit.id), [...(clusters.get(find(unit.id)) ?? []), unit]);

  return [...clusters.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const deckList = list.flatMap((u) => u.decks);
      const ids = new Set(list.map((u) => u.id));
      const overlaps = [...overlapOf].filter(([pair]) => pair.split('|').every((id) => ids.has(id))).map(([, o]) => o);
      return { deckIds: deckList.map((d) => d.id), decks: deckList, overlap: Math.min(...overlaps) };
    })
    .filter((s) => !dismissed.includes(getDeckSetSignature(s.deckIds)));
};

/**
 * Everything missing from the binders and the decks, counted once.
 *
 * Binders: one copy per empty pocket, in that chapter's printing (a reprint from another chapter
 * does not fill it); a pocket owned in another binder of the chapter is not wanted.
 * Decks: copies by full name, any printing. Each unit (see getDeckUnits) needs the most copies one
 * of its decks plays; units add up. Owned copies serve the locked decks first, then the units the
 * user assigned copies to (allocations), then the deck list order.
 * A copy filling a pocket also counts for the decks, which take their cards from the binders: a
 * card wanted for both is bought max(pockets, deck copies) times, not the sum.
 *
 * @param {{ binders: object[], decks: object[], index: object, collection: object,
 *   groups?: object[], allocations?: object, specials?: boolean }} options
 *   specials: Epic / Enchanted / Iconic pockets too
 * @returns {{
 *   binders: { binder, wanted: { card, key, cardNumber, alsoDeck: boolean }[], owned: number, total: number }[],
 *   units: { id, decks, locked, grouped, cards: { key, card, need, owned, missing, decks: { deck, qty, missing }[], alsoBinder: boolean, sharedWith: object[] }[], missing: number, need: number }[],
 *   cards: { key, card, pockets: object[], deckMissing: number, copies: number, both: number }[],
 *   totals: { copies: number, binderOnly: number, deckOnly: number, both: number }
 * }}
 */
export const getWantList = ({ binders, decks, index, collection, groups = [], allocations = {}, specials = false }) => {
  // Pockets held somewhere: two binders of the same chapter wait for the same card once
  const ownedPockets = new Set();
  for (const entry of collection.entries.values()) {
    for (const copy of entry.copies) ownedPockets.add(`${copy.card.set}-${baseNumber(copy.card.number)}`);
  }

  const binderLists = [];
  const pocketsByKey = new Map();
  for (const binder of binders) {
    if (binder.gameType !== 'lorcana' || !binder.setCode) continue;
    const wanted = [];
    const missing = getBinderMissing(binder, index, specials);
    for (const card of missing) {
      const pocket = `${card.set}-${baseNumber(card.number)}`;
      if (ownedPockets.has(pocket)) continue;
      ownedPockets.add(pocket);
      const want = { card, key: card.key, cardNumber: String(baseNumber(card.number)), binder, alsoDeck: false };
      wanted.push(want);
      pocketsByKey.set(card.key, [...(pocketsByKey.get(card.key) ?? []), want]);
    }
    const total = getBinderMissing({ ...binder, cards: {} }, index, specials).length;
    binderLists.push({ binder, wanted, owned: total - missing.length, total });
  }

  // Deck needs per card and unit
  const units = getDeckUnits(decks, groups).map((u) => ({ ...u, cards: [], missing: 0, need: 0 }));
  const unitOfDeck = new Map(units.flatMap((u) => u.decks.map((d) => [d.id, u])));
  const deckMissingByKey = new Map();
  const usage = getDeckUsage(units.flatMap((u) => u.decks));
  for (const [key, uses] of usage) {
    const byUnit = new Map();
    for (const use of uses) {
      const unit = unitOfDeck.get(use.deck.id);
      byUnit.set(unit, [...(byUnit.get(unit) ?? []), use]);
    }
    const priority = (unit) =>
      unit.locked ? Infinity : unit.decks.reduce((s, d) => s + (allocations[key]?.[d.id] ?? 0), 0);
    const ordered = [...byUnit.keys()].sort((a, b) => priority(b) - priority(a) || units.indexOf(a) - units.indexOf(b));
    let free = getOwned(collection, key);
    let keyMissing = 0;
    const lines = [];
    for (const unit of ordered) {
      const unitUses = byUnit.get(unit);
      const need = Math.max(...unitUses.map((u) => u.qty));
      const owned = Math.min(need, free);
      free -= owned;
      const missing = need - owned;
      keyMissing += missing;
      lines.push({
        unit,
        line: {
          key,
          card: index ? getMainPrinting(index, key) : null,
          name: unitUses[0].deck.cards.find((c) => c.key === key)?.name ?? key,
          need,
          owned,
          missing,
          decks: unitUses.map((u) => ({ deck: u.deck, qty: u.qty, missing: Math.max(0, u.qty - owned) })),
          alsoBinder: false,
          sharedWith: [],
        },
      });
    }
    for (const { unit, line } of lines) {
      line.sharedWith = ordered.filter((u) => u !== unit);
      unit.cards.push(line);
      unit.need += line.need;
      unit.missing += line.missing;
    }
    if (keyMissing > 0) deckMissingByKey.set(key, keyMissing);
  }

  for (const [key, pockets] of pocketsByKey) if (deckMissingByKey.has(key)) for (const p of pockets) p.alsoDeck = true;
  for (const unit of units) for (const line of unit.cards) line.alsoBinder = pocketsByKey.has(line.key) && line.missing > 0;

  const pockets = binderLists.flatMap((b) => b.wanted);
  const lines = units.flatMap((u) => u.cards);
  return { binders: binderLists, units, ...summarizeWants(pockets, lines, index) };
};

/**
 * One buy list from wanted pockets and deck lines (all of them, or the ones a view shows):
 * a pocket's copy also serves the decks, so a card is bought max(pockets, deck copies) times.
 * @returns {{ cards: { key, card, pockets: object[], deckMissing: number, copies: number, both: number }[],
 *   totals: { copies: number, binderOnly: number, deckOnly: number, both: number } }}
 */
export const summarizeWants = (pockets, lines, index) => {
  const pocketsByKey = new Map();
  for (const p of pockets) pocketsByKey.set(p.key, [...(pocketsByKey.get(p.key) ?? []), p]);
  const deckMissingByKey = new Map();
  for (const l of lines) if (l.missing > 0) deckMissingByKey.set(l.key, (deckMissingByKey.get(l.key) ?? 0) + l.missing);

  const cards = [];
  const totals = { copies: 0, binderOnly: 0, deckOnly: 0, both: 0 };
  for (const key of new Set([...pocketsByKey.keys(), ...deckMissingByKey.keys()])) {
    const keyPockets = pocketsByKey.get(key) ?? [];
    const deckMissing = deckMissingByKey.get(key) ?? 0;
    const both = Math.min(keyPockets.length, deckMissing);
    const copies = Math.max(keyPockets.length, deckMissing);
    const card = keyPockets[0]?.card ?? (index ? getMainPrinting(index, key) : null);
    cards.push({ key, card, pockets: keyPockets, deckMissing, copies, both });
    totals.copies += copies;
    totals.both += both;
    totals.binderOnly += keyPockets.length - both;
    totals.deckOnly += deckMissing - both;
  }
  return { cards, totals };
};

/**
 * Estimated cost of a buy list (summarizeWants cards): each pocket in its printing, the decks'
 * extra copies as the regular printing.
 * @param {(card: object) => number|null} getPrice
 */
export const getWantCost = (cards, index, getPrice) =>
  cards.reduce(
    (sum, c) =>
      sum +
      c.pockets.reduce((s, w) => s + (getPrice(w.card) ?? 0), 0) +
      (c.copies - c.pockets.length) * ((index && getPrice(getMainPrinting(index, c.key))) ?? 0),
    0
  );

/**
 * Copies the decks need of each card: the most one deck of a unit plays, units added up (see
 * getDeckUnits). The same count as the want list, so a card is never both wanted and in surplus.
 * @returns {Map<string, number>} by full-name key
 */
export const getDeckNeeds = (decks, groups = []) => {
  const needs = new Map();
  for (const unit of getDeckUnits(decks, groups)) {
    const unitNeeds = new Map();
    for (const deck of unit.decks) for (const c of deck.cards) unitNeeds.set(c.key, Math.max(unitNeeds.get(c.key) ?? 0, c.qty));
    for (const [key, qty] of unitNeeds) needs.set(key, (needs.get(key) ?? 0) + qty);
  }
  return needs;
};
