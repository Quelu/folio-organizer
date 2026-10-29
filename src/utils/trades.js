import { getDeckNeeds } from './wantList.js';
import { getListedQty } from './cardmarketSync.js';
import { getLocation, getPositionInPage } from './calculations.js';
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

/** Takes up to n copies out of a pocket's counts, foils first unless normalFirst. Returns how many were taken. */
const reserve = (pocket, n, normalFirst = false) => {
  const first = normalFirst ? 'normal' : 'foil';
  const second = normalFirst ? 'foil' : 'normal';
  const a = Math.min(pocket[first], n);
  pocket[first] -= a;
  const b = Math.min(pocket[second], n - a);
  pocket[second] -= b;
  return a + b;
};

/** Id of a binder pocket, for the pockets whose foil is sold rather than kept. */
export const getPocketId = (binderId, cardNumber) => `${binderId}:${cardNumber}`;

/**
 * Copies of a card kept: one in each binder pocket holding it (a playset of 4 with keep 4), or the
 * copies the decks need when they need more, since the decks take their cards from the binders
 * (the want list counts the same way, see getDeckNeeds).
 * @param {{ copies: object[] }} entry the card's collection entry
 * @param {number} deckNeed copies the decks need (getDeckNeeds)
 */
export const getKeptCount = (entry, deckNeed, keep) =>
  Math.max(keep >= MAX_COPIES ? keep : 1, entry.copies.length, deckNeed);

/** Id of a pocket's normal or foil copies: listings (copies put on sale) refer to it. */
export const getPocketCopyId = (binderId, cardNumber, foil) => `${binderId}:${cardNumber}:${foil ? 'foil' : 'normal'}`;

/**
 * Copies the user has in surplus, pocket by pocket: still in their binder (never the copies a deck
 * took out), beyond the kept ones (getKeptCount). One copy always stays in each pocket, the foil
 * first: a collection keeps its shiny copy and sells the normals, unless the user chose to sell
 * that pocket's foil (sellFoil). The other kept copies come from
 * the cheapest pockets, so the valuable extras are the ones offered.
 *
 * @param {object} collection from buildCollection
 * @param {object[]} decks
 * @param {{ keep?: number, groups?: object[], getPrice?: Function, listings?: object, sellFoil?: object }} [options]
 *   groups: deck groups (see wantList.js); listings: { [pocketCopyId]: { qty, at } } copies on sale;
 *   sellFoil: { [pocketId]: true } pockets keeping a normal copy, their foil sold
 * @returns {{ id, key, card, foil: boolean, qty: number, listed: number, binder, cardNumber, location, price: number|null }[]}
 *   listed: copies of qty already put on sale
 */
export const getSurplusCopies = (
  collection,
  decks,
  { keep = 1, groups = [], getPrice = () => null, listings = {}, sellFoil = {} } = {}
) => {
  const needs = getDeckNeeds(decks, groups);
  const items = [];
  for (const entry of collection.entries.values()) {
    // Copies a deck took out are taken from the normals first
    const pockets = entry.copies
      .map((copy) => {
        const pulledNormal = Math.min(copy.pulled, copy.normal);
        return { copy, normal: copy.normal - pulledNormal, foil: copy.foil - (copy.pulled - pulledNormal) };
      })
      .sort((a, b) => (getPrice(a.copy.card, false) ?? 0) - (getPrice(b.copy.card, false) ?? 0));

    let rest = getKeptCount(entry, needs.get(entry.key) ?? 0, keep) - entry.pulled;
    const normalFirst = ({ copy }) => Boolean(sellFoil[getPocketId(copy.binder.id, copy.cardNumber)]);
    for (const pocket of pockets) rest -= reserve(pocket, Math.min(1, pocket.normal + pocket.foil), normalFirst(pocket));
    for (const pocket of pockets) rest -= reserve(pocket, Math.max(0, rest), normalFirst(pocket));

    for (const { copy, normal, foil: foils } of pockets) {
      for (const foil of [false, true]) {
        const qty = foil ? foils : normal;
        if (qty <= 0) continue;
        const id = getPocketCopyId(copy.binder.id, copy.cardNumber, foil);
        items.push({
          id,
          key: entry.key,
          card: copy.card,
          foil,
          qty,
          listed: Math.min(qty, getListedQty(listings[id])),
          // The pocket holds both variants: the user can choose which one stays
          canSwap: copy.normal > 0 && copy.foil > 0,
          sellsFoil: normalFirst({ copy }),
          binder: copy.binder,
          cardNumber: copy.cardNumber,
          location: copy.location,
          price: getPrice(copy.card, foil),
        });
      }
    }
  }
  return items;
};

/**
 * The copies put on sale, with the ones no longer in surplus: a deck now plays them, or they left
 * the binder. The user takes those off sale (on Cardmarket too).
 * @param {object} collection from buildCollection
 * @param {object} listings { [pocketCopyId]: { qty, at } }
 * @param {object[]} surplus from getSurplusCopies
 * @returns {{ id, key, card, binder, binderId, cardNumber, foil, qty: number, needed: number, at: number,
 *   online: number, onlinePrice: number|null, sold: number }[]} needed: listed copies that are no longer surplus;
 *   card null when the pocket is gone; online, onlinePrice: on Cardmarket at the last sync (see cardmarketSync.js);
 *   sold: sold on Cardmarket, to take out; qty 0 while copies taken off sale are still on Cardmarket
 */
export const getListedCopies = (collection, listings, surplus) => {
  const pockets = new Map();
  for (const entry of collection.entries.values()) {
    for (const copy of entry.copies) pockets.set(getPocketId(copy.binder.id, copy.cardNumber), copy);
  }
  const surplusOf = new Map(surplus.map((s) => [s.id, s.qty]));
  return Object.entries(listings).map(([id, { qty, at, cardmarket, sold = 0 }]) => {
    const [binderId, cardNumber, variant] = id.split(':');
    const copy = pockets.get(getPocketId(binderId, cardNumber));
    return {
      id,
      key: copy?.card.key ?? null,
      card: copy?.card ?? null,
      binder: copy?.binder ?? null,
      binderId,
      cardNumber,
      foil: variant === 'foil',
      qty,
      needed: Math.max(0, qty - (surplusOf.get(id) ?? 0)),
      at,
      online: cardmarket?.qty ?? 0,
      onlinePrice: cardmarket?.price ?? null,
      sold,
    };
  });
};

/**
 * Copies the user can trade away, one item per printing and variant: the surplus copies
 * (getSurplusCopies) not put on sale.
 *
 * @param {object} collection from buildCollection
 * @param {object[]} decks
 * @param {number} keep copies kept per card
 * @param {(card: object, foil: boolean) => number|null} getPrice
 * @param {{ groups?: object[], listings?: object, sellFoil?: object }} [options]
 * @returns {{ id, key, card, foil: boolean, qty: number, price: number|null }[]}
 */
export const getTradeableSurplus = (collection, decks, keep, getPrice, { groups = [], listings = {}, sellFoil = {} } = {}) => {
  const items = new Map();
  for (const copy of getSurplusCopies(collection, decks, { keep, groups, getPrice, listings, sellFoil })) {
    const qty = copy.qty - copy.listed;
    if (qty <= 0) continue;
    // Two binders of the same chapter hold the same printing: one item for both
    const id = `${copy.card.id}${copy.foil ? '-foil' : ''}`;
    const existing = items.get(id);
    if (existing) existing.qty += qty;
    else items.set(id, { id, key: copy.key, card: copy.card, foil: copy.foil, qty, price: copy.price });
  }
  return [...items.values()].sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
};

/**
 * Where to fetch the copies given in a trade: the pockets holding that printing and variant,
 * binder by binder in page order, so each binder is leafed through once.
 * @param {{ card, foil: boolean, qty: number }[]} give
 * @param {object} collection from buildCollection
 * @param {object[]} binders the user's binders, in sidebar order
 * @returns {{ rows: { id, card, foil, binder, cardNumber, location, take }[], short: { card, foil, missing }[] }}
 *   short: copies no longer in the binders (changed since the trade was validated)
 */
export const getTradePullList = (give, collection, binders) => {
  const rows = [];
  const short = [];
  for (const { card, foil, qty } of give) {
    let needed = qty;
    for (const copy of collection.entries.get(card.key)?.copies ?? []) {
      if (needed <= 0) break;
      if (copy.card.id !== card.id) continue;
      const take = Math.min(foil ? copy.foil : copy.normal, needed);
      if (take <= 0) continue;
      needed -= take;
      rows.push({
        id: `${copy.binder.id}:${copy.cardNumber}${foil ? ':foil' : ''}`,
        card,
        foil,
        binder: copy.binder,
        cardNumber: copy.cardNumber,
        location: copy.location,
        take,
        position: getPositionInPage(parseInt(copy.cardNumber, 10), copy.binder),
      });
    }
    if (needed > 0) short.push({ card, foil, missing: needed });
  }
  const binderOrder = new Map(binders.map((b, i) => [b.id, i]));
  rows.sort(
    (a, b) =>
      binderOrder.get(a.binder.id) - binderOrder.get(b.binder.id) || a.location.page - b.location.page || a.position - b.position
  );
  return { rows, short };
};

/**
 * The binder pocket a received card goes in: a binder of its chapter, one where the pocket is
 * still empty first.
 * @returns {{ binder, cardNumber: string, location } | null} null without a binder of that chapter
 */
export const getTradeDestination = (card, binders) => {
  const cardNumber = String(baseNumber(card.number));
  const chapter = binders.filter((b) => b.gameType === 'lorcana' && String(b.setCode) === String(card.set));
  const binder = chapter.find((b) => !(b.cards[cardNumber]?.quantity > 0)) ?? chapter[0];
  return binder ? { binder, cardNumber, location: getLocation(baseNumber(card.number), binder) } : null;
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
