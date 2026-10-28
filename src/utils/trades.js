import { getDeckUsage } from './collection.js';
import { MAX_COPIES } from './deckRules.js';
import { SPECIAL_RARITIES, baseNumber, findPocketCard } from './catalog.js';

/** Cards worth less than this are bulk: nobody trades them one by one. */
export const BULK_PRICE = 0.1;

/**
 * Printings of a Lorcana binder's empty pockets: the regular cards up to the set size, and the
 * Epic / Enchanted / Iconic ones numbered after them with withSpecials.
 */
export const getBinderMissing = (binder, index, withSpecials = false) => {
  const setCards = index.bySet.get(binder.setCode);
  if (!setCards) return [];
  const lastRegular = Math.max(
    0,
    ...setCards.filter((c) => !SPECIAL_RARITIES.includes(c.rarity)).map((c) => baseNumber(c.number))
  );
  const lastNumber = withSpecials
    ? Math.max(binder.setSize ?? 0, ...setCards.map((c) => baseNumber(c.number)))
    : (binder.setSize ?? lastRegular);
  const cards = [];
  for (let n = 1; n <= lastNumber; n++) {
    if (binder.cards[String(n)]) continue;
    const card = findPocketCard(index, binder.setCode, n);
    if (!card || (!withSpecials && SPECIAL_RARITIES.includes(card.rarity))) continue;
    cards.push(card);
  }
  return cards;
};

/** Takes up to n copies out of a pocket's counts, foils first. Returns how many were taken. */
const reserve = (pocket, n) => {
  const foil = Math.min(pocket.foil, n);
  pocket.foil -= foil;
  const normal = Math.min(pocket.normal, n - foil);
  pocket.normal -= normal;
  return foil + normal;
};

/**
 * Copies of a card kept out of trades:
 * - keep 1 (collection): 1 + the copies the user's decks play, the decks come on top of the binder copy;
 * - keep 4 (playset): max(4, the copies the decks play), since the decks play with the playset;
 * plus, either way, the copies of the locked decks, which never join the collection's copies.
 * @param {{ deck, qty }[]} uses the card's line of getDeckUsage
 */
export const getKeptCopies = (uses, keep) => {
  let locked = 0;
  let used = 0;
  for (const { deck, qty } of uses) {
    if (deck.locked) locked += qty;
    else used += qty;
  }
  return locked + (keep >= MAX_COPIES ? Math.max(keep, used) : keep + used);
};

/**
 * Copies the user can trade away, one item per printing and variant.
 *
 * Copies kept per card (full name, see getKeptCopies), the rest is tradeable (never negative).
 * The same rule drives the surplus of the collection stats. Reserved copies are taken from the
 * cheapest printings first, so the valuable extras stay tradeable, and foils first within a pocket:
 * a collection keeps its shiny copies, normals are traded first.
 *
 * @param {object} collection from buildCollection
 * @param {object[]} decks
 * @param {number} keep copies kept per card
 * @param {(card: object, foil: boolean) => number|null} getPrice
 * @returns {{ id, key, card, foil: boolean, qty: number, price: number|null }[]}
 */
export const getTradeableSurplus = (collection, decks, keep, getPrice) => {
  const usage = getDeckUsage(decks);
  const items = new Map();
  for (const entry of collection.entries.values()) {
    const pockets = entry.copies
      .map((c) => ({ card: c.card, normal: c.normal, foil: c.foil }))
      .sort((a, b) => (getPrice(a.card, false) ?? 0) - (getPrice(b.card, false) ?? 0));

    let rest = getKeptCopies(usage.get(entry.key) ?? [], keep);
    for (const pocket of pockets) rest -= reserve(pocket, rest);

    for (const pocket of pockets) {
      for (const foil of [false, true]) {
        const qty = foil ? pocket.foil : pocket.normal;
        if (qty <= 0) continue;
        // Two binders of the same chapter hold the same printing: one item for both
        const id = `${pocket.card.id}${foil ? '-foil' : ''}`;
        const existing = items.get(id);
        if (existing) existing.qty += qty;
        else items.set(id, { id, key: entry.key, card: pocket.card, foil, qty, price: getPrice(pocket.card, foil) });
      }
    }
  }
  return [...items.values()].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
};

/** Index of the first price >= value in an ascending list. */
const lowerBound = (prices, value, from = 0) => {
  let lo = from;
  let hi = prices.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

/** Positions (>= from) around the price closest to value: neighbours cover a card owned once. */
const nearest = (prices, value, from) => {
  const i = lowerBound(prices, value, from);
  return [i - 2, i - 1, i, i + 1].filter((k) => k >= from && k < prices.length);
};

/**
 * Sets of 1 to 3 surplus cards worth about a target value, for an equal-value trade.
 * Each pair or triple start only tries the completions closest in price, so the search stays O(n² log n).
 *
 * @param {number} targetValue
 * @param {object[]} haves from getTradeableSurplus
 * @returns {{ items: { have: object, qty: number }[], total: number, diff: number }[]}
 *   fewest cards first, then the closest totals; diff = total - target
 */
export const suggestTrades = (targetValue, haves, { tolerance = 0.15, maxCards = 3, limit = 5 } = {}) => {
  if (!targetValue || targetValue < BULK_PRICE) return [];
  const pool = haves.filter((h) => h.price != null && h.price >= BULK_PRICE).sort((a, b) => a.price - b.price);
  const prices = pool.map((h) => h.price);
  const lo = targetValue * (1 - tolerance);
  const hi = targetValue * (1 + tolerance);
  const found = new Map();

  const add = (indexes) => {
    const counts = new Map();
    for (const i of indexes) counts.set(i, (counts.get(i) ?? 0) + 1);
    if ([...counts].some(([i, n]) => n > pool[i].qty)) return;
    const total = indexes.reduce((s, i) => s + prices[i], 0);
    if (total < lo || total > hi) return;
    const signature = [...counts.keys()].sort((a, b) => a - b).map((i) => `${i}x${counts.get(i)}`).join(',');
    if (found.has(signature)) return;
    found.set(signature, {
      items: [...counts].map(([i, qty]) => ({ have: pool[i], qty })).sort((a, b) => b.have.price - a.have.price),
      cards: indexes.length,
      total,
      diff: total - targetValue,
    });
  };

  for (let i = lowerBound(prices, lo); i < pool.length && prices[i] <= hi; i++) add([i]);

  if (maxCards >= 2) {
    for (let i = 0; i < pool.length && prices[i] * 2 <= hi; i++) {
      for (const j of nearest(prices, targetValue - prices[i], i)) add([i, j]);
    }
  }

  if (maxCards >= 3) {
    for (let i = 0; i < pool.length && prices[i] * 3 <= hi; i++) {
      for (let j = i; j < pool.length && prices[i] + prices[j] * 2 <= hi; j++) {
        for (const k of nearest(prices, targetValue - prices[i] - prices[j], j)) add([i, j, k]);
      }
    }
  }

  // An extra card only earns its place by getting closer to the target than fewer cards do
  let bestDiff = Infinity;
  let bestBelow = Infinity;
  let cards = 0;
  return [...found.values()]
    .sort((a, b) => a.cards - b.cards || Math.abs(a.diff) - Math.abs(b.diff))
    .filter((combo) => {
      if (combo.cards !== cards) {
        cards = combo.cards;
        bestBelow = bestDiff;
      }
      bestDiff = Math.min(bestDiff, Math.abs(combo.diff));
      return Math.abs(combo.diff) < bestBelow;
    })
    .slice(0, limit)
    .map(({ items, total, diff }) => ({ items, total, diff }));
};

const describe = ({ card, foil, qty }, nameOf) =>
  `${qty}× ${nameOf(card)}${foil ? ' (foil)' : ''} · chapitre ${card.set} n° ${card.number}`;

/**
 * Trade proposal to paste in a message.
 * @param {{ card, foil, qty, price }[]} wants
 * @param {{ card, foil, qty, price }[]} offers
 * @param {(value: number|null) => string} format
 */
export const buildTradeText = (wants, offers, format, nameOf = (card) => card.fullName) => {
  const line = (item) => `- ${describe(item, nameOf)} — ${format(item.price == null ? null : item.price * item.qty)}`;
  const total = (items) => items.reduce((s, i) => s + (i.price ?? 0) * i.qty, 0);
  return [
    'Je cherche :',
    ...wants.map(line),
    '',
    'Je propose :',
    ...offers.map(line),
    '',
    `Total : ${format(total(wants))} contre ${format(total(offers))}`,
  ].join('\n');
};
